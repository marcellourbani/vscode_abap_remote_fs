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

export async function checkReplAvailability(client: ADTClient): Promise<ReplHealthCheck> {
  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "GET",
    timeout: 10_000
  })

  const data = typeof response.body === "string" ? JSON.parse(response.body) : response.body
  return data as ReplHealthCheck
}

export async function executeAbapCode(
  client: ADTClient,
  code: string
): Promise<ReplResponse> {
  const body = JSON.stringify({ code })

  log(`ABAP REPL: executing ${code.length} chars of ABAP code`)

  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    timeout: 60_000
  })

  const data = typeof response.body === "string" ? JSON.parse(response.body) : response.body
  return data as ReplResponse
}
