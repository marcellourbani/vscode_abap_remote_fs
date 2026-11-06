import type { UsageAnalysis, UsageIssue, UsageRow } from "./types"
import type { ExportColumn } from "../structuredDataExportService"

export const usageColumns: ExportColumn[] = [
  { name: "key", header: "Repository Key" },
  { name: "objectName", header: "Object Name" },
  { name: "objectType", header: "Object Type" },
  { name: "packageName", header: "Package" },
  { name: "functionGroup", header: "Function Group" },
  { name: "status", header: "Status" },
  { name: "reasons", header: "Reasons" },
  { name: "lastObserved", header: "Latest Observed Date" },
  { name: "periods", header: "Observation Periods" }
]
export const exportRows = (rows: UsageRow[]) =>
  rows.map(row => ({
    ...row,
    status: row.status === "used" ? "Used" : "Unclear",
    reasons: row.reasons.join("\n"),
    periods: row.periods.join("\n")
  }))

export const issueColumns: ExportColumn[] = [
  { name: "stage", header: "Stage" },
  { name: "source", header: "Source" },
  { name: "objectName", header: "Object Name" },
  { name: "objectType", header: "Object Type" },
  { name: "packageName", header: "Package" },
  { name: "file", header: "Input File" },
  { name: "message", header: "Issue" }
]

export function usageIssueRows(state: UsageAnalysis): UsageIssue[] {
  const rows: UsageIssue[] = []
  const messages = new Set<string>()
  const observations = new Map(state.observations.map(item => [item.reason, item]))
  const inventory = new Map<string, UsageAnalysis["inventory"]>()
  for (const item of state.inventory)
    inventory.set(item.objectName, [...(inventory.get(item.objectName) || []), item])
  const add = (
    stage: string,
    source: string,
    message: string,
    objectName = "",
    objectType = "",
    file = "",
    key = ""
  ) => {
    const objects = inventory.get(objectName) || []
    rows.push({
      id: JSON.stringify([stage, source, key, file, message]),
      stage,
      source,
      objectName,
      objectType: objectType || [...new Set(objects.map(item => item.objectType))].join(", "),
      packageName: [...new Set(objects.map(item => item.packageName))].join(", "),
      file,
      message
    })
    messages.add(message)
  }
  for (const input of state.inputs) {
    const stage = ["tadir", "enlfdir"].includes(input.kind)
      ? "Discovery"
      : ["tbtco", "tbtcp"].includes(input.kind)
        ? "Jobs"
        : "ST03N"
    for (const message of new Set(input.issues)) {
      const item = observations.get(message)
      const prefix = item ? `${input.id}:${item.source}:` : ""
      const objectName = item?.id.startsWith(prefix) ? item.id.slice(prefix.length) : ""
      add(stage, input.kind, message, objectName, "", input.name)
    }
  }
  for (const [stage, issues] of Object.entries(state.stageIssues || {}))
    for (const message of issues || [])
      if (!messages.has(message)) add(stage === "st03n" ? "ST03N" : stage, "Collection", message)
  for (const message of state.issues)
    if (!messages.has(message)) add("Collection", "Collection", message)
  for (const [key, check] of Object.entries(state.checks)) {
    if (check.status !== "error") continue
    const [direction, , objectType, ...name] = key.split(":")
    add(
      "Dependencies",
      direction === "WUL" ? "Where-used" : "Relations",
      check.error || "Lookup failed",
      name.join(":"),
      objectType,
      "",
      key
    )
  }
  return rows
}

export function usageExportName(
  state: UsageAnalysis,
  view: string,
  type: "xlsx" | "csv",
  now = new Date()
) {
  const safe = (value: string) =>
    value
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 100)
  return `${safe(state.name) || "Repository_Usage"}_usage-${safe(view)}_${safe(state.connectionId).toUpperCase() || "OFFLINE"}_${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}.${type}`
}
