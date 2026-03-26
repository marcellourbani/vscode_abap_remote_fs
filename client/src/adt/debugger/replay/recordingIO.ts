import { Uri, workspace } from "vscode"
import * as os from "os"
import { DebugRecording } from "./types"
import { log, caughtToString } from "../../../lib"
import { funWindow as window } from "../../../services/funMessenger"

import * as path from "path"

const RECORDING_FILTER = {
  "ABAP Debug Recordings": ["abaprecord"]
}

/**
 * Saves a recording to a user-chosen file location.
 * Returns the saved Uri, or undefined if cancelled.
 */
export async function saveRecording(recording: DebugRecording): Promise<Uri | undefined> {
  const defaultName = buildDefaultFilename(recording)
  const uri = await window.showSaveDialog({
    defaultUri: Uri.file(defaultName),
    filters: RECORDING_FILTER,
    saveLabel: "Save Recording",
    title: "Save ABAP Debug Recording"
  })
  if (!uri) return undefined

  try {
    const json = JSON.stringify(recording)
    await workspace.fs.writeFile(uri, Buffer.from(json, "utf-8"))
    log(`Recording saved to ${uri.fsPath}`)
    return uri
  } catch (error) {
    window.showErrorMessage(`Failed to save recording: ${caughtToString(error)}`)
    return undefined
  }
}

/**
 * Loads a recording from a user-chosen file.
 * Returns the parsed recording, or undefined if cancelled or invalid.
 */
export async function loadRecording(): Promise<DebugRecording | undefined> {
  const uris = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Open Recording",
    title: "Select ABAP Debug Recording (.abaprecord)",
    defaultUri: Uri.file(os.homedir()),
    filters: {
      "ABAP Debug Recordings": ["abaprecord", "ABAPRECORD"]
    }
  })
  if (!uris || uris.length === 0) return undefined
  return loadRecordingFromUri(uris[0])
}

/**
 * Loads a recording from a specific Uri.
 */
export async function loadRecordingFromUri(uri: Uri): Promise<DebugRecording | undefined> {
  try {
    const data = await workspace.fs.readFile(uri)
    const text = Buffer.from(data).toString("utf-8")
    const recording = JSON.parse(text) as DebugRecording
    if (!isValidRecording(recording)) {
      window.showErrorMessage("Invalid recording file format")
      return undefined
    }
    log(`Recording loaded: ${recording.totalSteps} steps from ${recording.recordedAt}`)
    return recording
  } catch (error) {
    window.showErrorMessage(`Failed to load recording: ${caughtToString(error)}`)
    return undefined
  }
}

function isValidRecording(r: any): r is DebugRecording {
  return (
    r &&
    r.version === 1 &&
    typeof r.totalSteps === "number" &&
    Array.isArray(r.snapshots) &&
    r.snapshots.length > 0 &&
    r.snapshots.every((s: any) => Array.isArray(s.stack) && Array.isArray(s.scopes)) &&
    (r.sources === undefined || (typeof r.sources === "object" && r.sources !== null && !Array.isArray(r.sources)))
  )
}

function buildDefaultFilename(recording: DebugRecording): string {
  const date = new Date().toISOString().slice(0, 10)
  const obj = recording.objectName || recording.connectionId
  return path.join(os.homedir(), `${obj}-${date}.abaprecord`)
}
