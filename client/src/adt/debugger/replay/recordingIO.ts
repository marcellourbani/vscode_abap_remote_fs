import { ProgressLocation, Uri, workspace } from "vscode"
import * as os from "os"
import * as zlib from "zlib"
import { promisify } from "util"
import { DebugRecording } from "./types"
import { log, caughtToString } from "../../../lib"
import { funWindow as window } from "../../../services/funMessenger"

import * as path from "path"

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

/** Gzip magic bytes: 0x1f 0x8b */
const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

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
    title: "Select ABAP Debug Recording",
    defaultUri: Uri.file(os.homedir()),
    filters: {
      "ABAP Debug Recordings": ["abaprecord.gz", "abaprecord", "ABAPRECORD", "ABAPRECORD.GZ"]
    }
  })
  if (!uris || uris.length === 0) return undefined
  return loadRecordingFromUri(uris[0])
}

/**
 * Loads a recording from a specific Uri.
 * Supports both plain JSON (.abaprecord) and gzip-compressed files.
 */
export async function loadRecordingFromUri(uri: Uri): Promise<DebugRecording | undefined> {
  try {
    const data = await workspace.fs.readFile(uri)
    const bytes = Buffer.from(data)

    let text: string
    if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) {
      const decompressed = await gunzip(bytes)
      text = decompressed.toString("utf-8")
    } else {
      text = bytes.toString("utf-8")
    }

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

/**
 * Core: gzip-compress raw bytes, write to targetUri, show result.
 * Used by both saveRecordingCompressed and compressRecording.
 */
async function gzipAndSave(raw: Buffer, targetUri: Uri): Promise<void> {
  await window.withProgress(
    { location: ProgressLocation.Notification, title: "Compressing debug recording…", cancellable: false },
    async (progress) => {
      progress.report({ message: "Compressing…" })
      const compressed = await gzip(raw, { level: zlib.constants.Z_BEST_COMPRESSION })
      progress.report({ message: "Writing file…" })
      await workspace.fs.writeFile(targetUri, compressed)
      const ratio = raw.length > 0 ? ((1 - compressed.length / raw.length) * 100).toFixed(1) : "0"
      log(`Compressed recording saved to ${targetUri.fsPath} (${formatBytes(compressed.length)}, ${ratio}% smaller than ${formatBytes(raw.length)})`)
      window.showInformationMessage(
        `Compressed: ${formatBytes(raw.length)} → ${formatBytes(compressed.length)} (${ratio}% smaller)`
      )
    }
  )
}

/**
 * Saves a recording directly as a gzip-compressed .abaprecord.gz file.
 * Used by the "Compress & Save" button in the stop-recording notification.
 */
export async function saveRecordingCompressed(recording: DebugRecording): Promise<Uri | undefined> {
  const defaultName = buildDefaultFilename(recording).replace(/\.abaprecord$/, ".abaprecord.gz")
  const uri = await window.showSaveDialog({
    defaultUri: Uri.file(defaultName),
    filters: { "Compressed ABAP Debug Recordings": ["abaprecord.gz"] },
    saveLabel: "Save Compressed Recording",
    title: "Save Compressed ABAP Debug Recording"
  })
  if (!uri) return undefined

  try {
    const raw = Buffer.from(JSON.stringify(recording), "utf-8")
    await gzipAndSave(raw, uri)
    return uri
  } catch (error) {
    window.showErrorMessage(`Failed to save compressed recording: ${caughtToString(error)}`)
    return undefined
  }
}

/**
 * Compresses an existing .abaprecord file using gzip.
 * Prompts user to select input file, compresses, then shows save-as dialog.
 */
export async function compressRecording(): Promise<void> {
  const uris = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select .abaprecord file to Compress",
    title: "Select ABAP Debug Recording (.abaprecord)",
    defaultUri: Uri.file(os.homedir()),
    filters: { "ABAP Debug Recordings": ["abaprecord", "ABAPRECORD"] }
  })
  if (!uris || uris.length === 0) return

  const sourceUri = uris[0]
  try {
    const data = await workspace.fs.readFile(sourceUri)
    const bytes = Buffer.from(data)

    if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) {
      window.showInformationMessage("This file is already compressed.")
      return
    }

    const text = bytes.toString("utf-8")
    const recording = JSON.parse(text) as DebugRecording
    if (!isValidRecording(recording)) {
      window.showErrorMessage("Invalid recording file format")
      return
    }

    const defaultSave = Uri.file(sourceUri.fsPath.replace(/\.abaprecord$/i, ".abaprecord.gz"))
    const saveUri = await window.showSaveDialog({
      defaultUri: defaultSave,
      filters: { "Compressed ABAP Debug Recordings": ["abaprecord.gz"] },
      saveLabel: "Save Compressed Recording",
      title: "Save Compressed ABAP Debug Recording"
    })
    if (!saveUri) return

    await gzipAndSave(bytes, saveUri)
  } catch (error) {
    window.showErrorMessage(`Failed to compress recording: ${caughtToString(error)}`)
  }
}

/**
 * Decompresses an existing .abaprecord.gz file back to plain JSON .abaprecord.
 * Prompts user to select input file, decompresses, then shows save-as dialog.
 */
export async function decompressRecording(): Promise<void> {
  const uris = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select .abaprecord.gz file to Decompress",
    title: "Select Compressed ABAP Debug Recording",
    defaultUri: Uri.file(os.homedir()),
    filters: { "Compressed ABAP Debug Recordings": ["abaprecord.gz", "gz"] }
  })
  if (!uris || uris.length === 0) return

  const sourceUri = uris[0]
  try {
    const data = await workspace.fs.readFile(sourceUri)
    const bytes = Buffer.from(data)

    if (bytes.length < 2 || bytes[0] !== GZIP_MAGIC_0 || bytes[1] !== GZIP_MAGIC_1) {
      window.showInformationMessage("This file is not gzip-compressed. It may already be a plain .abaprecord file.")
      return
    }

    // Suggest .abaprecord next to the original
    const defaultSave = Uri.file(sourceUri.fsPath.replace(/\.abaprecord\.gz$/i, ".abaprecord"))
    const saveUri = await window.showSaveDialog({
      defaultUri: defaultSave,
      filters: { "ABAP Debug Recordings": ["abaprecord"] },
      saveLabel: "Save Decompressed Recording",
      title: "Save Decompressed ABAP Debug Recording"
    })
    if (!saveUri) return

    await window.withProgress(
      { location: ProgressLocation.Notification, title: "Decompressing debug recording…", cancellable: false },
      async (progress) => {
        progress.report({ message: "Decompressing…" })
        const decompressed = await gunzip(bytes)
        const text = decompressed.toString("utf-8")
        const recording = JSON.parse(text) as DebugRecording
        if (!isValidRecording(recording)) {
          window.showErrorMessage("Invalid recording file format")
          return
        }
        progress.report({ message: "Writing file…" })
        await workspace.fs.writeFile(saveUri, decompressed)
        window.showInformationMessage(
          `Decompressed: ${formatBytes(bytes.length)} → ${formatBytes(decompressed.length)}`
        )
        log(`Recording decompressed: ${sourceUri.fsPath} → ${saveUri.fsPath} (${formatBytes(bytes.length)} → ${formatBytes(decompressed.length)})`)
      }
    )
  } catch (error) {
    window.showErrorMessage(`Failed to decompress recording: ${caughtToString(error)}`)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
