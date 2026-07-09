import {
  CancellationToken,
  Disposable,
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  ProviderResult,
  Uri,
  window,
  workspace
} from "vscode"
import { isAbapStat } from "abapfs"
import { AbapObject } from "abapobject"
import { abapUri, uriRoot } from "../adt/conections"

const NAMESPACE = /^[a-z][a-z0-9]*:/i
const TIMESTAMP_KEY = /At$/

// Fields already shown in the curated header, duplicative, or just noise
const SKIP_META = new Set([
  "adtcore:type",
  "adtcore:name",
  "adtcore:description",
  "adtcore:descriptionTextLimit",
  "abapsource:sourceUri",
  "abapsource:fixPointArithmetic",
  "abapsource:activeUnicodeCheck",
  "abapsource:abapLanguageVersion"
])

const humanize = (key: string) =>
  key
    .replace(NAMESPACE, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, c => c.toUpperCase())

const formatValue = (key: string, value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    if (TIMESTAMP_KEY.test(key) && value > 0) return new Date(value).toLocaleString()
    return String(value)
  }
  if (typeof value === "string") return value
  return
}

const push = (lines: string[], label: string, value: string | undefined) => {
  if (value !== undefined && value !== "") lines.push(`${label}: ${value}`)
}

export const buildTooltip = (obj: AbapObject): string | undefined => {
  // Leading empty line separates our block from VS Code's default path tooltip
  const lines: string[] = [""]
  const meta = obj.structure?.metaData as Record<string, unknown> | undefined

  // Curated lead-in
  push(lines, "Name", obj.name)
  const desc = meta?.["adtcore:description"]
  if (typeof desc === "string") push(lines, "Description", desc)

  // Dump metaData (loaded once the object is opened) — new per-type fields
  // (class:*, program:*, abapoo:*, fmodule:*, …) appear automatically.
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (SKIP_META.has(key)) continue
      const val = formatValue(key, meta[key])
      if (val !== undefined) push(lines, humanize(key), val)
    }
  }

  // > 1 because index 0 is always the leading blank
  return lines.length > 1 ? lines.join("\n") : undefined
}

export class AbapFileDecorationProvider implements FileDecorationProvider, Disposable {
  private readonly emitter = new EventEmitter<Uri | Uri[] | undefined>()
  readonly onDidChangeFileDecorations = this.emitter.event
  private readonly subs: Disposable[]

  constructor() {
    // Structure is loaded lazily (FsProvider.stat → node.stat → loadStructure).
    // Once a file becomes the active editor, structure is populated: refresh
    // the decoration so the fuller tooltip appears.
    const refresh = (uri: Uri | undefined) => {
      if (uri && abapUri(uri)) this.emitter.fire(uri)
    }
    this.subs = [
      window.onDidChangeActiveTextEditor(e => refresh(e?.document.uri)),
      // Save updates changedAt/changedBy server-side; re-fire just this URI.
      workspace.onDidSaveTextDocument(d => refresh(d.uri))
    ]
  }

  dispose() {
    for (const s of this.subs) s.dispose()
    this.emitter.dispose()
  }

  provideFileDecoration(uri: Uri, _token: CancellationToken): ProviderResult<FileDecoration> {
    if (!abapUri(uri)) return
    try {
      const root = uriRoot(uri)
      // sync lookup — no network. Structure is whatever was already loaded.
      const node = root.getNode(uri.path)
      if (!isAbapStat(node)) return
      const tooltip = buildTooltip(node.object)
      return tooltip ? { tooltip } : undefined
    } catch {
      return
    }
  }
}
