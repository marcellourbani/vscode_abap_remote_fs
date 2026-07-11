/**
 * ABAP Download Tool
 *
 * Downloads any adt:// resource (package, program, class, function group,
 * folder, or single file) to a local folder.
 *
 * Why we walk the tree ourselves instead of vscode.workspace.fs.copy:
 *   1. Atomicity — fs.copy aborts on the first per-file failure. The abap fs
 *      provider surfaces stale/orphan entries (renamed but still listed by
 *      the tree) whose readFile throws Unavailable; a manual walk skips them
 *      and lets the rest of the package land.
 *   2. Progress — fs.copy is opaque. We need per-file progress and a running
 *      done/total counter in the notification.
 *   3. Cancellation — fs.copy takes no CancellationToken. Manual walk checks
 *      the token between files so cancel is near-instant.
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot } from "../../adt/conections"

export interface IDownloadParameters {
  /**
   * Source. One of:
   *   - Full adt URI: `adt://ged100/System Library/ZFOO`
   *   - ADT path: `/sap/bc/adt/packages/zfoo`
   *   - Bare object name (requires `connectionId` and usually `objectType`)
   */
  source: string
  /** Absolute local folder path (`C:\wiki\raw\ZFOO`) or `file://` URI. */
  target: string
  /** Required if `source` is a bare object name or an ADT path. */
  connectionId?: string
  /** Optional type disambiguator for bare names (e.g. `CLAS/OC`, `PROG/P`). */
  objectType?: string
  /** Overwrite existing files at the target. Default true. */
  overwrite?: boolean
}

async function resolveSource(input: IDownloadParameters): Promise<vscode.Uri> {
  const { source, connectionId, objectType } = input

  if (source.startsWith("adt://") || source.startsWith("file://")) {
    return vscode.Uri.parse(source)
  }

  if (!connectionId) {
    throw new Error("connectionId is required when source is not a full adt:// or file:// URI")
  }
  const root = await getOrCreateRoot(connectionId)

  if (source.startsWith("/sap/bc/adt/")) {
    // main=false so FUGR / CLAS / DEVC resolve to the containing folder
    // (with all FMs / includes / class parts), not just the main include.
    const found = await root.findByAdtUri(source, false)
    if (!found?.path) throw new Error(`Cannot resolve ADT path ${source} on ${connectionId}`)
    return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
  }

  const searcher = getSearchService(connectionId)
  const results = await searcher.searchObjects(source, objectType ? [objectType] : undefined, 5)
  const exact = results?.find(r => r.name?.toUpperCase() === source.toUpperCase()) ?? results?.[0]
  if (!exact?.uri) {
    throw new Error(
      `Object ${source}${objectType ? ` (${objectType})` : ""} not found on ${connectionId}`
    )
  }
  const found = await root.findByAdtUri(exact.uri, false)
  if (!found?.path) throw new Error(`Cannot resolve workspace path for ${source}`)
  return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
}

function resolveTarget(target: string): vscode.Uri {
  if (target.startsWith("file://")) return vscode.Uri.parse(target)
  if (target.startsWith("adt://")) {
    throw new Error("target must be a local path, not an adt:// URI")
  }
  return vscode.Uri.file(target)
}

export class DownloadTool implements vscode.LanguageModelTool<IDownloadParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDownloadParameters>,
    _token: vscode.CancellationToken
  ) {
    const { source, target } = options.input
    return {
      invocationMessage: `Downloading ${source} to ${target}`,
      confirmationMessages: {
        title: "Download ABAP Resource",
        message: new vscode.MarkdownString(
          `Download to local folder:\n\n` +
            `**Source:** \`${source}\`\n` +
            `**Target:** \`${target}\``
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDownloadParameters>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const input: IDownloadParameters = {
      ...options.input,
      connectionId: options.input.connectionId?.toLowerCase()
    }
    logTelemetry("tool_download_called", { connectionId: input.connectionId ?? "" })

    const targetUri = resolveTarget(input.target)
    const overwrite = input.overwrite ?? false
    const label =
      input.source
        .split(/[\/\\]/)
        .filter(Boolean)
        .pop() ?? "resource"

    const stats = { files: 0, folders: 0, skipped: 0, failed: [] as string[] }
    let cancelled = false
    let sourceUri: vscode.Uri | undefined
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${label}`,
        cancellable: true
      },
      async (progress, progressToken) => {
        // Compose the LM tool token with the progress notification's own cancel button
        const cts = new vscode.CancellationTokenSource()
        const sub1 = token.onCancellationRequested(() => cts.cancel())
        const sub2 = progressToken.onCancellationRequested(() => cts.cancel())
        try {
          // Resolution can be slow on first hit (tree hydration, findByAdtUri);
          // keep it inside the progress so the user sees "Resolving…" immediately.
          progress.report({ message: "Resolving source…" })
          const resolved = await race(resolveSource(input), cts.token)
          if (cts.token.isCancellationRequested || !resolved) return
          sourceUri = resolved
          progress.report({ message: "Scanning…" })
          const total = (await race(countFiles(resolved, cts.token), cts.token)) ?? 0
          if (cts.token.isCancellationRequested) return
          let done = 0
          await copyTree(resolved, targetUri, overwrite, stats, cts.token, name => {
            done++
            progress.report({
              message: total ? `${done}/${total} — ${name}` : name,
              increment: total ? 100 / total : undefined
            })
          })
        } finally {
          cancelled = cts.token.isCancellationRequested
          sub1.dispose()
          sub2.dispose()
          cts.dispose()
        }
      }
    )

    if (cancelled) {
      // Propagate to Copilot so the model sees a real cancellation rather than
      // a partial "downloaded" result it might treat as success.
      throw new vscode.CancellationError()
    }

    const summary =
      `Downloaded ${sourceUri?.toString() ?? input.source} to ${targetUri.fsPath}\n` +
      `Files: ${stats.files}, Folders: ${stats.folders}, Skipped: ${stats.skipped}, Failed: ${stats.failed.length}` +
      (stats.failed.length ? `\nFailures:\n  ${stats.failed.slice(0, 50).join("\n  ")}` : "")
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)])
  }
}

/**
 * Recursively copy `source` (adt:// or file://) to `target` (file://), tolerating
 * per-file failures — the abap fs provider surfaces stale/orphan entries that fail
 * on readFile; skipping them lets the rest of the package land.
 */
async function copyTree(
  source: vscode.Uri,
  target: vscode.Uri,
  overwrite: boolean,
  stats: { files: number; folders: number; skipped: number; failed: string[] },
  token: vscode.CancellationToken,
  onFile: (name: string) => void
): Promise<void> {
  if (token.isCancellationRequested) return
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(source)
  } catch (e) {
    stats.failed.push(`${source.toString()} (stat: ${errMsg(e)})`)
    return
  }

  if (stat.type === vscode.FileType.Directory) {
    stats.folders++
    try {
      await vscode.workspace.fs.createDirectory(target)
    } catch (e) {
      stats.failed.push(`${target.fsPath} (mkdir: ${errMsg(e)})`)
      return
    }
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(source)
    } catch (e) {
      stats.failed.push(`${source.toString()} (readDirectory: ${errMsg(e)})`)
      return
    }
    await runPool(entries, DL_CONCURRENCY, ([name]) =>
      copyTree(
        vscode.Uri.joinPath(source, name),
        vscode.Uri.joinPath(target, name),
        overwrite,
        stats,
        token,
        onFile
      )
    )
    return
  }

  // File
  const leaf = source.path.split("/").pop() ?? ""
  onFile(leaf)
  if (!overwrite) {
    try {
      await vscode.workspace.fs.stat(target)
      stats.skipped++
      return
    } catch {
      // target absent — proceed
    }
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(source)
    if (token.isCancellationRequested) return
    await vscode.workspace.fs.writeFile(target, bytes)
    stats.files++
  } catch (e) {
    stats.failed.push(`${source.toString()} (${errMsg(e)})`)
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * Race a promise against a cancellation token. If the token fires first, the
 * returned promise resolves to `undefined` (the original promise keeps running
 * but nobody is waiting for it). Use only when the underlying op has no native
 * cancellation.
 */
function race<T>(p: Promise<T>, token: vscode.CancellationToken): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const sub = token.onCancellationRequested(() => {
      sub.dispose()
      resolve(undefined)
    })
    p.then(
      v => {
        sub.dispose()
        resolve(v)
      },
      e => {
        sub.dispose()
        if (token.isCancellationRequested) resolve(undefined)
        else reject(e)
      }
    )
  })
}

/**
 * Fast recursive count of files under `source`. Uses only readDirectory
 * (no readFile). Returns 0 on any error; the copy will fall back to
 * indeterminate progress.
 */
async function countFiles(source: vscode.Uri, token: vscode.CancellationToken): Promise<number> {
  if (token.isCancellationRequested) return 0
  try {
    const stat = await vscode.workspace.fs.stat(source)
    if (stat.type !== vscode.FileType.Directory) return 1
    const entries = await vscode.workspace.fs.readDirectory(source)
    const counts = await Promise.all(
      entries.map(([name]) => countFiles(vscode.Uri.joinPath(source, name), token))
    )
    return counts.reduce((a, b) => a + b, 0)
  } catch {
    return 0
  }
}

/**
 * Parallel worker pool: run at most `limit` promises at a time over `items`.
 * ADT tolerates a handful of parallel reads on one HTTP session; pushing beyond
 * ~8 tends to hit backend serialisation or lock contention.
 */
const DL_CONCURRENCY = 5
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx])
    }
  })
  await Promise.all(runners)
}

export function registerDownloadTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("abap_download", new DownloadTool()))
}
