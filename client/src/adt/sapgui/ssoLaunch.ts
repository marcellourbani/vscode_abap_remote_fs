/**
 * SAP's SSO redirect service (`/sap/public/myssocntl`) accepts a reentrance ticket only as
 * an HTTP header (on GET) or as a form field (on POST) — never as a URL query parameter.
 * That is deliberate hardening on SAP's side: a ticket in a URL leaks into browser history,
 * proxy logs and server access logs. Passing it as `?sap-mysapsso=` fails with
 * "No ticket was received using header (E 00 001)".
 *
 * A browser cannot be told to send a custom request header, so the only usable path is the
 * POST one. This module serves a single-use page on loopback whose only content is a form
 * that auto-submits the ticket to the SAP host; SAP then sets its session cookie and
 * redirects the browser on to the requested WebGUI transaction.
 *
 * The ticket exists only in memory for the lifetime of one request — never in a URL, never
 * on disk.
 */
import * as http from "http"
import { randomBytes } from "crypto"
import { AddressInfo } from "net"
import { log } from "../../lib"

/** How long to wait for the browser to fetch the page before giving up and freeing the port. */
const DEFAULT_LAUNCH_TIMEOUT_MS = 60_000

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function ssoFormPage(action: string, ssoField: string, redirectUrl?: string): string {
  const redirectField = redirectUrl
    ? `\n  <input type="hidden" name="sap-mysapred" value="${escapeAttribute(redirectUrl)}">`
    : ""
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signing in to SAP…</title></head>
<body style="font-family: sans-serif; padding: 2rem; color: #333;">
<p>Signing in to SAP…</p>
<form id="sso" method="POST" action="${escapeAttribute(action)}">
  <input type="hidden" name="sap-mysapsso" value="${escapeAttribute(ssoField)}">${redirectField}
  <noscript><button type="submit">Continue to SAP</button></noscript>
</form>
<script>document.getElementById("sso").submit();</script>
</body>
</html>`
}

function listeningPort(server: http.Server): number {
  const address = server.address() as AddressInfo | null
  if (!address) throw new Error("SSO launcher failed to bind a port")
  return address.port
}

export type SsoLauncherOptions = {
  timeoutMs?: number
  /**
   * Follow through to `webguiUrl` after logon. Turn OFF when only the session cookie is
   * wanted: the redirect starts a real WebGUI session that nothing ever logs off, and SAP
   * limits how many a user may hold at once.
   */
  redirect?: boolean
}

/** A live launcher: the URL to fetch, and a way to shut it down early. */
export type SsoLauncher = {
  url: string
  /** Idempotent. Frees the port and discards the ticket without waiting for the expiry. */
  dispose: () => void
}

/**
 * Serve a one-shot auto-submitting SSO form on loopback and return its URL. Fetching that URL
 * authenticates the browser and, unless `redirect` is off, lands it on `webguiUrl`.
 *
 * The URL is guessable only with the random token, is bound to 127.0.0.1, and stops being
 * served once it has been fetched once. Callers that may abandon it should `dispose()`, or a
 * usable ticket stays served until the expiry elapses.
 */
export function startSsoFormLauncher(
  webguiUrl: string,
  client: string,
  ticket: string,
  { timeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS, redirect = true }: SsoLauncherOptions = {}
): Promise<SsoLauncher> {
  const target = new URL(webguiUrl)
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`WebGUI URL must be HTTP or HTTPS: ${webguiUrl}`)
  }
  // Not blocked over plain HTTP: the ADT session already sends its credentials over the same
  // transport, and a single-use reentrance ticket is the less sensitive of the two. Users who
  // don't want it on the wire at all can turn off webGuiAutoLogin.
  if (target.protocol !== "https:") {
    log(`Sending a reentrance ticket over plain HTTP to ${target.host}`)
  }
  // The redirect service has to be called on the same origin as the target: the cookie it
  // sets applies to its own host only.
  const action = new URL("/sap/public/myssocntl", target.origin).toString()
  const token = randomBytes(24).toString("hex")

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "GET" || req.url !== `/${token}`) {
        res.writeHead(404)
        res.end("Not found")
        return
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      })
      res.end(ssoFormPage(action, `${client}${ticket}`, redirect ? webguiUrl : undefined))
      res.on("finish", () => {
        log.debug("SSO launcher served the login form, closing")
        shutdown()
      })
    })

    let timer: NodeJS.Timeout
    let closed = false
    const shutdown = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      server.close()
      // Keep-alive sockets would otherwise hold the port until they idle out.
      server.closeAllConnections?.()
    }

    server.on("error", err => {
      shutdown()
      reject(new Error(`SSO launcher failed: ${err.message}`))
    })

    server.listen(0, "127.0.0.1", () => {
      timer = setTimeout(() => {
        log("SSO launcher expired before the browser fetched it")
        shutdown()
      }, timeoutMs)
      // Never hold the event loop open just to wait out an expiry.
      timer.unref?.()
      resolve({ url: `http://127.0.0.1:${listeningPort(server)}/${token}`, dispose: shutdown })
    })
  })
}
