import { ensureConnected } from "./query"
import { ENGINE_VERSION } from "./payload"

export interface EngineRequest {
  operation: string
  [key: string]: string | number | undefined
}
export interface EngineResponse {
  STATUS?: string
  VERSION?: string
  DATA_JSON?: string
  EXTRAS_JSON?: string
  MESSAGES?: string[]
  RUN_ID?: string
  [key: string]: unknown
}
export interface ImgIndexHit {
  TEXT: string
  NODE_ID: string
  EXTENSION: string
  STRUCTURE_ID: string
  PATH: string
}
export interface ImgSearchHit {
  ACTIVITY: string
  TEXT: string
  OBJECTTYPE: string
  OBJECTNAME: string
  TCODE: string
}

/** Use the existing authenticated HTTP client: supports SSO, OAuth, certificates and proxies. */
export async function callEngine(
  connectionId: string | undefined,
  request: EngineRequest,
  service = "/sap/bc/zabapfs_cust"
): Promise<EngineResponse> {
  const client = await ensureConnected(connectionId)
  // Never retry a mutation: a lost response does not mean SAP rolled the operation back.
  const response = await client.statelessClone.httpClient.request(service, {
    method: "POST",
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json", Accept: "application/json" }
  })
  const raw: unknown = response.body
  let result: unknown
  try {
    result = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch {
    throw new Error(
      "Customizing service returned non-JSON. Check SICF activation and authentication."
    )
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Customizing service returned an invalid response")
  const parsed = result as EngineResponse
  if (typeof parsed.STATUS !== "string")
    throw new Error("Customizing service response has no status")
  return parsed
}

/** Read-only, uncached per-system probe. Installation is deliberately view-only. */
export async function requireCustomizingBackend(connectionId: string): Promise<void> {
  try {
    const result = await callEngine(connectionId, { operation: "ping" })
    if (result.STATUS !== "ok")
      throw new Error(`Service ping failed: ${(result.MESSAGES ?? []).join("; ") || result.STATUS}`)
    if (result.VERSION !== ENGINE_VERSION)
      throw new Error(
        `Incompatible SAP Customizing service version: ${result.VERSION ?? "not reported"}`
      )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `SAP Customizing tools are not ready on system "${connectionId}". ` +
        "Ask the user to check the ABAP FS Customizing Setup view for this SAP connection. " +
        "Setup is handled by the user; do not attempt installation with AI tools. " +
        `No configuration change was submitted. Details: ${detail}`
    )
  }
}

function dataRows<T>(response: EngineResponse): T[] {
  if (!response.DATA_JSON) return []
  const data: unknown = JSON.parse(response.DATA_JSON)
  if (!Array.isArray(data)) throw new Error("Customizing service returned invalid row data")
  return data as T[]
}

export async function imgSearchViaEngine(
  connectionId: string | undefined,
  args: { keyword: string; language?: string; maxRows?: number }
) {
  const result = await callEngine(connectionId, {
    operation: "img_search",
    keyword: args.keyword,
    language: args.language,
    max_rows: args.maxRows
  })
  if (result.STATUS !== "ok") return null
  const messages = result.MESSAGES ?? []
  return {
    hits: dataRows<ImgSearchHit>(result),
    messages,
    capped: messages.some(text => /capped/i.test(text))
  }
}

export async function imgIndexRead(
  connectionId: string | undefined,
  args: { structureId: string; language?: string; keyword?: string; maxRows?: number }
) {
  const result = await callEngine(connectionId, {
    operation: "img_index_read",
    structure_id: args.structureId,
    language: args.language,
    keyword: args.keyword,
    max_rows: args.maxRows
  })
  return {
    status: result.STATUS,
    messages: result.MESSAGES ?? [],
    hits: dataRows<ImgIndexHit>(result)
  }
}
