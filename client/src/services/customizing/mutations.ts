import { callEngine, type EngineRequest } from "./engine"
import { ensureConnected, objectName } from "./query"
import { resolveMaint } from "./resolver"
import { ENGINE_VERSION } from "./payload"

export interface ChangeInput {
  connectionId: string
  objectName: string
  keyField?: string
  sourceKey?: string
  targetKey?: string
  onlyMissing?: boolean
  commit?: boolean
  transport?: string
  createTransport?: boolean
  transportText?: string
  recordTransport?: boolean
  recordTableKeys?: boolean
  values?: Record<string, string>
  rows?: Record<string, string>[]
}

export function fieldValues(values: Record<string, string>) {
  return Object.entries(values).map(([field, value]) => {
    if (typeof value !== "string")
      throw new Error("Field values must be strings to preserve SAP formatting and leading zeros")
    return { FIELD: objectName(field), VALUE: value }
  })
}

export async function mutateConfiguration(
  operation: "write" | "create" | "delete",
  input: ChangeInput
) {
  const client = await ensureConnected(input.connectionId)
  const name = objectName(input.objectName)
  const maintenance = await resolveMaint(client, name)
  if (input.recordTableKeys === true && operation !== "create")
    throw new Error("recordTableKeys is supported only for explicit create rows")
  if (input.recordTableKeys === true && input.recordTransport === false)
    throw new Error("recordTableKeys requires transport recording")
  if (input.recordTableKeys === true && maintenance.maintObject)
    throw new Error(
      "recordTableKeys is only for tables without generated maintenance; omit it here"
    )
  const directCreate =
    operation === "create" && (input.recordTableKeys === true || input.recordTransport === false)
  if (!maintenance.maintObject && !directCreate)
    throw new Error(
      "No generated maintenance object exists. Use SPRO/SM30; no direct-table-write fallback is offered."
    )
  if (
    operation === "write" &&
    (!input.keyField || input.sourceKey === undefined || input.targetKey === undefined)
  )
    throw new Error("keyField and sourceKey are required")
  if (operation === "delete" && (!input.keyField || input.targetKey === undefined))
    throw new Error("keyField and targetKey are required for delete")
  if (operation === "write" && input.targetKey === undefined)
    throw new Error("targetKey is required")
  if (operation === "write" && input.sourceKey === input.targetKey) {
    if (input.onlyMissing !== false || !input.values || !Object.keys(input.values).length)
      throw new Error("In-place updates require onlyMissing: false and at least one field override")
    if (input.recordTransport === false)
      throw new Error(
        "In-place updates require the maintenance runtime; omit recordTransport: false"
      )
  }
  if (operation === "create" && (!input.rows?.length || input.rows.length > 1000))
    throw new Error("Provide between 1 and 1000 rows")
  const transport = input.transport?.trim().toUpperCase()
  if (transport && !/^[A-Z0-9]{1,20}$/.test(transport))
    throw new Error("Invalid Customizing request")
  if (input.createTransport === true && transport)
    throw new Error("Choose an existing transport or createTransport: true, not both")
  if (input.createTransport === true && input.recordTransport === false)
    throw new Error("Creating a Customizing request requires transport recording")
  const transportText = input.transportText?.trim()
  if (input.transportText !== undefined && (!transportText || input.createTransport !== true))
    throw new Error("transportText requires createTransport: true and a non-empty description")
  if (transportText && transportText.length > 60)
    throw new Error("Customizing request descriptions must not exceed 60 characters")
  if (
    input.recordTableKeys === true &&
    input.commit === true &&
    !transport &&
    !input.createTransport
  )
    throw new Error(
      "recordTableKeys requires a Customizing request or createTransport: true on commit"
    )
  if (input.recordTransport === false && transport)
    throw new Error("Omit transport when recordTransport is false")
  if (operation === "delete" && input.recordTransport === false)
    throw new Error("Delete requires transport recording")
  // Installation/version checks are read-only. Never auto-install from a configuration call.
  const ping = await callEngine(input.connectionId, { operation: "ping" })
  if (ping.STATUS !== "ok" || ping.VERSION !== ENGINE_VERSION)
    throw new Error(
      "The SAP Customizing service is missing or incompatible. Ask the user to check ABAP FS Customizing Setup."
    )
  const request: EngineRequest = {
    operation,
    table: maintenance.rootTable,
    view_name: input.recordTableKeys === true ? "" : maintenance.maintObject,
    transport_object: input.recordTableKeys === true ? "TABU" : maintenance.recordObject,
    cluster_name: maintenance.cluster,
    key_field: input.keyField ? objectName(input.keyField) : undefined,
    source_key: operation === "delete" ? undefined : input.sourceKey,
    target_key: input.targetKey,
    transport,
    create_transport: input.createTransport === true ? "X" : "",
    transport_text: transportText,
    commit: input.commit === true ? "X" : "",
    only_missing: input.onlyMissing !== false ? "X" : "",
    record_transport: input.recordTransport === false ? "" : "X",
    values_json: input.values ? JSON.stringify(fieldValues(input.values)) : undefined,
    rows_json: input.rows ? JSON.stringify(input.rows.map(fieldValues)) : undefined
  }
  return callEngine(input.connectionId, request)
}

export async function configurationStatus(connectionId: string, runId: string) {
  if (!/^[\w{}+/=-]{1,22}$/.test(runId)) throw new Error("Invalid background run ID")
  return callEngine(connectionId, { operation: "status", run_id: runId })
}
