import * as vscode from "vscode"
import { connectedRoots } from "../config"
import { getClient } from "../adt/conections"
import { ADTClient } from "abap-adt-api"
import { funWindow as window } from "../services/funMessenger"

export interface ResolvedConnection {
  connectionId: string
  client: ADTClient
}

export async function resolveConnection(): Promise<ResolvedConnection> {
  const roots = connectedRoots()
  const connectedIds = Array.from(roots.keys())

  if (connectedIds.length === 0) {
    throw new NotebookConnectionError(
      "No SAP systems connected. Use 'ABAP FS: Connect to an SAP system' first."
    )
  }

  const picked = await window.showQuickPick(
    connectedIds.map(id => ({ label: id })),
    {
      placeHolder: "Pick a SAP system for this Run:",
      ignoreFocusOut: true
    }
  )
  if (!picked) {
    throw new NotebookConnectionError("No system selected. Execution cancelled.")
  }

  const selectedId = picked.label

  const confirm = await window.showWarningMessage(
    `Run workbook on SAP system "${selectedId}"?`,
    { modal: true },
    "Yes, run"
  )
  if (confirm !== "Yes, run") {
    throw new NotebookConnectionError("Execution cancelled by user.")
  }

  try {
    return { connectionId: selectedId, client: getClient(selectedId) }
  } catch (err: any) {
    throw new NotebookConnectionError(
      `System '${selectedId}' connection failed: ${err.message || err}. Reconnect and try again.`
    )
  }
}

export class NotebookConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotebookConnectionError"
  }
}
