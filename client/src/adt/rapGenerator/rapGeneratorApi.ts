/**
 * RAP Generator ADT API — HTTP functions
 *
 * Stateless functions that call ADT endpoints via ADTClient.
 * No VS Code dependencies — only uses ADTClient from abap-adt-api.
 */

import { ADTClient } from "abap-adt-api"
import type {
  RapGeneratorContent,
  RapGeneratorId,
  RapGeneratorPreviewObject,
  RapGeneratorValidationResult
} from "./types"

import { decode } from "html-entities"

const BASE = "/sap/bc/adt/businessservices/generators"

const CT_CONTENT = "application/vnd.sap.adt.repository.generator.content.v1+json"
const CT_SCHEMA = "application/vnd.sap.adt.repository.generator.schema.v1+json"
const CT_UICONFIG = "application/vnd.sap.adt.repository.generator.uiconfig.v1+json"
const CT_PREVIEW = "application/vnd.sap.adt.repository.generator.preview.v1+xml"
const CT_GENERATOR = "application/vnd.sap.adt.repository.generator.v1+json"

function url(genId: RapGeneratorId, suffix?: string): string {
  const base = `${BASE}/${genId}`
  return suffix ? `${base}/${suffix}` : base
}

function qs(params: Record<string, string | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join("&")}` : ""
}

// ── Axios JSON workaround ────────────────────────────────────────────
// Axios auto-parses JSON when content-type contains "+json".
// The ADT HTTP layer then does `${data}` which produces "[object Object]".
// We install a one-time response interceptor that re-serializes parsed
// objects back to JSON strings for our endpoints.

const patched = new WeakSet<ADTClient>()

function ensureJsonInterceptor(client: ADTClient): void {
  if (patched.has(client)) return
  patched.add(client)
  try {
    const axios = (client as any).httpClient?.httpclient?.axios
    if (!axios?.interceptors?.response) return
    axios.interceptors.response.use((resp: any) => {
      if (resp.data && typeof resp.data === "object" && resp.config?.url?.includes("/businessservices/generators")) {
        resp.data = JSON.stringify(resp.data)
      }
      return resp
    })
  } catch { /* best effort */ }
}

// ── XML Helpers ──────────────────────────────────────────────────────

function parseValidation(body: string | undefined): RapGeneratorValidationResult {
  if (!body) return { severity: "error", shortText: "Empty response from server" }
  const sev = body.match(/<SEVERITY>([\s\S]*?)<\/SEVERITY>/i)?.[1]?.trim().toLowerCase() || "ok"
  const txt = decode(body.match(/<SHORT_TEXT>([\s\S]*?)<\/SHORT_TEXT>/i)?.[1]?.trim() || "")
  const lng = decode(body.match(/<LONG_TEXT>([\s\S]*?)<\/LONG_TEXT>/i)?.[1]?.trim() || "")
  return { severity: sev as RapGeneratorValidationResult["severity"], shortText: txt, longText: lng || undefined }
}

function parseObjectRefs(body: string | undefined): RapGeneratorPreviewObject[] {
  if (!body) return []
  const out: RapGeneratorPreviewObject[] = []
  // Attributes may be namespaced (adtcore:uri) or plain (uri)
  const re = /<(?:\w+:)?objectReference\s+([^>]*)\s*\/>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const attrs = m[1]
    // Match both "adtcore:name" and plain "name"
    const attr = (n: string) => {
      const match = attrs.match(new RegExp(`(?:\\w+:)?${n}\\s*=\\s*"([^"]*)"`))
      return match?.[1] || ""
    }
    out.push({ uri: attr("uri"), type: attr("type"), name: attr("name"), description: attr("description") })
  }
  return out
}

// ── Public API ───────────────────────────────────────────────────────

/** Initial checks: does the package exist? Is the table valid? */
export async function rapGenValidateInitial(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  packageName: string,
  checks = ["PACKAGE", "REFERENCEDOBJECT", "AUTHORIZATION"]
): Promise<RapGeneratorValidationResult> {
  const q = qs({ referencedObject: refObjectUri, package: packageName, checks: checks.join(",") })
  const resp = await client.httpClient.request(`${url(genId, "validation")}${q}`, { method: "GET" })
  return parseValidation(resp.body)
}

/** JSON schema describing the generator form fields. */
export async function rapGenGetSchema(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  packageName: string
): Promise<string> {
  const q = qs({ referencedObject: refObjectUri, package: packageName })
  const resp = await client.httpClient.request(`${url(genId, "schema")}${q}`, {
    method: "GET",
    headers: { Accept: CT_SCHEMA }
  })
  return resp.body
}

/** Pre-filled default values (auto-generated artifact names). */
export async function rapGenGetContent(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  packageName: string
): Promise<RapGeneratorContent> {
  ensureJsonInterceptor(client)
  const q = qs({ referencedObject: refObjectUri, package: packageName })
  const resp = await client.httpClient.request(`${url(genId, "content")}${q}`, {
    method: "GET",
    headers: { Accept: CT_CONTENT }
  })
  return JSON.parse(resp.body)
}

/** Field-level UI config (readonly, hidden, dropdowns). */
export async function rapGenGetUiConfig(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  packageName: string
): Promise<string> {
  const q = qs({ referencedObject: refObjectUri, package: packageName })
  const resp = await client.httpClient.request(`${url(genId, "uiconfig")}${q}`, {
    method: "GET",
    headers: { Accept: CT_UICONFIG }
  })
  return resp.body
}

/** Full validation of user-edited content (name collisions, etc.). */
export async function rapGenValidateContent(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  content: RapGeneratorContent
): Promise<RapGeneratorValidationResult> {
  const q = qs({ referencedObject: refObjectUri })
  const resp = await client.httpClient.request(`${url(genId, "validation")}${q}`, {
    method: "POST",
    headers: { "Content-Type": CT_CONTENT },
    body: JSON.stringify(content)
  })
  return parseValidation(resp.body)
}

/** Preview: list of objects that would be created (dry run). */
export async function rapGenPreview(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  content: RapGeneratorContent
): Promise<RapGeneratorPreviewObject[]> {
  const q = qs({ referencedObject: refObjectUri })
  const resp = await client.httpClient.request(`${url(genId, "preview")}${q}`, {
    method: "POST",
    headers: { "Content-Type": CT_CONTENT, Accept: CT_PREVIEW },
    body: JSON.stringify(content)
  })
  return parseObjectRefs(resp.body)
}

/** Execute generation — creates all RAP artifacts on the server. */
export async function rapGenGenerate(
  client: ADTClient,
  genId: RapGeneratorId,
  refObjectUri: string,
  transport: string,
  content: RapGeneratorContent
): Promise<RapGeneratorPreviewObject[]> {
  ensureJsonInterceptor(client)
  // corrNr must always be present in the query, even if empty (for $TMP)
  const q = `?referencedObject=${encodeURIComponent(refObjectUri)}&corrNr=${encodeURIComponent(transport)}`
  const resp = await client.httpClient.request(`${url(genId)}${q}`, {
    method: "POST",
    headers: { "Content-Type": CT_CONTENT, Accept: CT_GENERATOR },
    body: JSON.stringify(content)
  })
  return parseObjectRefs(resp.body)
}

/** Check whether RAP Generator endpoints are available on this system. */
export async function rapGenIsAvailable(
  client: ADTClient,
  genId: RapGeneratorId = "uiservice"
): Promise<boolean> {
  ensureJsonInterceptor(client)
  try {
    const q = qs({ referencedObject: "", package: "", checks: "PACKAGE" })
    await client.httpClient.request(`${url(genId, "validation")}${q}`, { method: "GET" })
    return true
  } catch (e: any) {
    const status = e?.response?.status ?? e?.status ?? 0
    if (status === 404 || status === 501 || status === 0) return false
    // 400, 412, etc. means the endpoint exists but input was invalid
    return true
  }
}

/** Publish a service binding (make it available for consumption). */
export async function rapGenPublishService(
  client: ADTClient,
  srvbName: string
): Promise<RapGeneratorValidationResult> {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
    `<adtcore:objectReference adtcore:type="SCGR" adtcore:name="${srvbName}"/>` +
    `</adtcore:objectReferences>`
  try {
    const resp = await client.httpClient.request("/sap/bc/adt/businessservices/odatav4/publishjobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.StatusMessage"
      },
      body
    })
    return parseValidation(resp.body)
  } catch (e: any) {
    const respBody = e?.response?.body || ""
    const parsed = parseValidation(respBody)
    if (parsed.shortText) return parsed
    const msg = e?.message || String(e)
    return { severity: "error", shortText: msg }
  }
}
