import { ADTClient } from "abap-adt-api"
import { log } from "../lib"

const REPL_PATH = "/sap/bc/z_abap_repl"

export interface ReplResponse {
  success: boolean
  output: string
  error: string
  runtime_ms: number
}

export interface ReplHealthCheck {
  status: string
  version: string
  user: string
  system: string
  client: string
  production: boolean
}

let interceptorInstalled = false

/** Install a one-time response interceptor that re-serializes parsed JSON objects
 *  back to strings before AxiosHttpClient's `${data}` stringification loses them. */
function ensureJsonInterceptor(client: ADTClient): void {
  if (interceptorInstalled) return
  try {
    const axios = (client as any).httpClient?.httpclient?.axios
    if (axios?.interceptors?.response) {
      axios.interceptors.response.use((resp: any) => {
        if (resp.data && typeof resp.data === "object" && resp.config?.url?.includes(REPL_PATH)) {
          resp.data = JSON.stringify(resp.data)
        }
        return resp
      })
      interceptorInstalled = true
    }
  } catch {
    // If we can't install interceptor, httpClient.request will still work but body will be mangled
  }
}

/** Strip control characters from JSON body that ABAP may embed in string values */
function sanitizeJsonBody(body: string): string {
  // Replace any real newlines/tabs/control chars inside JSON string values
  // by scanning and replacing only chars inside quoted strings
  let result = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === "\\" && inString) {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && ch.charCodeAt(0) < 0x20) {
      // Replace raw control char with its JSON escape
      if (ch === "\n") result += "\\n"
      else if (ch === "\r") result += "\\r"
      else if (ch === "\t") result += "\\t"
      else result += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
      continue
    }
    result += ch
  }
  return result
}

export async function checkReplAvailability(client: ADTClient): Promise<ReplHealthCheck> {
  ensureJsonInterceptor(client)

  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "GET",
    timeout: 10_000
  })

  log.debug(`ABAP REPL health: status=${response.status}, body="${response.body.substring(0, 300)}"`)
  return JSON.parse(sanitizeJsonBody(response.body)) as ReplHealthCheck
}

export async function executeAbapCode(client: ADTClient, code: string): Promise<ReplResponse> {
  ensureJsonInterceptor(client)

  const reqBody = JSON.stringify({ code })
  log.debug(`ABAP REPL: executing ${code.length} chars, body="${reqBody.substring(0, 200)}"`)

  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: reqBody,
    timeout: 60_000
  })

  log.debug(`ABAP REPL exec: status=${response.status}, body="${response.body.substring(0, 300)}"`)
  return JSON.parse(sanitizeJsonBody(response.body)) as ReplResponse
}
