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
import { AbapResourceDownloadService } from "../abapResourceDownloadService"

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

    const result = await vscode.window.withProgress(
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
          progress.report({ message: "Resolving source…" })
          return await new AbapResourceDownloadService().download({
            ...input,
            target: targetUri,
            overwrite,
            token: cts.token,
            onProgress: item => {
              progress.report({
                message: item.total ? `${item.completed}/${item.total} — ${item.name}` : item.name,
                increment: item.total ? 100 / item.total : undefined
              })
            }
          })
        } finally {
          sub1.dispose()
          sub2.dispose()
          cts.dispose()
        }
      }
    )

    if (!result || result.cancelled) throw new vscode.CancellationError()

    const summary =
      `Downloaded ${result.sourceUri} to ${result.targetPath}\n` +
      `Files: ${result.files}, Folders: ${result.folders}, Skipped: ${result.skipped}, Failed: ${result.failures.length}` +
      (result.failures.length ? `\nFailures:\n  ${result.failures.slice(0, 50).join("\n  ")}` : "")
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)])
  }
}

export function registerDownloadTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("abapfs_download_object", new DownloadTool()))
}
