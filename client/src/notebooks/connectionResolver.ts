import * as vscode from "vscode"
import { connectedRoots, formatKey } from "../config"
import { getClient } from "../adt/conections"
import { ADTClient } from "abap-adt-api"

export interface ResolvedConnection {
  connectionId: string
  client: ADTClient
}

export async function resolveConnection(
  requestedId: string | undefined
): Promise<ResolvedConnection> {
  const roots = connectedRoots()
  const connectedIds = Array.from(roots.keys())

  if (connectedIds.length === 0) {
    throw new NotebookConnectionError(
      "No SAP systems connected. Use 'ABAP FS: Connect to an SAP system' first."
    )
  }

  const normalizedRequest = requestedId ? formatKey(requestedId) : undefined

  if (normalizedRequest && connectedIds.includes(normalizedRequest)) {
    try {
      return { connectionId: normalizedRequest, client: getClient(normalizedRequest) }
    } catch (err: any) {
      throw new NotebookConnectionError(
        `System '${requestedId}' connection failed: ${err.message || err}. Reconnect and try again.`
      )
    }
  }

  if (connectedIds.length === 1) {
    const onlyId = connectedIds[0]
    if (normalizedRequest && normalizedRequest !== onlyId) {
      const use = await vscode.window.showInformationMessage(
        `Notebook targets '${requestedId}' which isn't connected. Run on '${onlyId}'?`,
        "Yes",
        "Cancel"
      )
      if (use !== "Yes") {
        throw new NotebookConnectionError("Execution cancelled by user.")
      }
    }
    try {
      return { connectionId: onlyId, client: getClient(onlyId) }
    } catch (err: any) {
      throw new NotebookConnectionError(
        `System '${onlyId}' connection failed: ${err.message || err}. Reconnect and try again.`
      )
    }
  }

  const picked = await vscode.window.showQuickPick(
    connectedIds.map(id => ({
      label: id,
      description: id === normalizedRequest ? "(requested)" : ""
    })),
    {
      placeHolder: normalizedRequest
        ? `'${requestedId}' not connected. Pick a system:`
        : "Pick a SAP system for this notebook:",
      ignoreFocusOut: true
    }
  )

  if (!picked) {
    throw new NotebookConnectionError("No system selected. Execution cancelled.")
  }

  try {
    return { connectionId: picked.label, client: getClient(picked.label) }
  } catch (err: any) {
    throw new NotebookConnectionError(
      `System '${picked.label}' connection failed: ${err.message || err}. Reconnect and try again.`
    )
  }
}

export class NotebookConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotebookConnectionError"
  }
}
