import * as vscode from "vscode"
import * as path from "path"
import { getSearchService } from "./abapSearchService"
import { getOrCreateRoot } from "../adt/conections"

export interface AbapResourceSource {
  source: string
  connectionId?: string
  objectType?: string
}

export interface AbapResourceDownloadOptions extends AbapResourceSource {
  target: vscode.Uri
  overwrite?: boolean
  concurrency?: number
  token?: vscode.CancellationToken
  onProgress?: (progress: { completed: number; total: number; name: string }) => void
}

export interface AbapResourceDownloadResult {
  sourceUri: string
  targetPath: string
  files: number
  folders: number
  skipped: number
  failures: string[]
  cancelled: boolean
}

export async function resolveAbapResource(input: AbapResourceSource): Promise<vscode.Uri> {
  const { source, objectType } = input
  const connectionId = input.connectionId?.toLowerCase()
  if (source.startsWith("file://")) return vscode.Uri.parse(source)
  if (source.startsWith("adt://")) {
    const uri = vscode.Uri.parse(source)
    if (!connectionId || uri.authority.toLowerCase() === connectionId) return uri
    const root = await getOrCreateRoot(connectionId)
    if (uri.path.startsWith("/sap/bc/adt/")) {
      const found = await root.findByAdtUri(uri.path, false)
      if (!found?.path) throw new Error(`Cannot resolve ADT path ${uri.path} on ${connectionId}`)
      return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
    }
    const targetUri = uri.with({ authority: connectionId })
    try {
      await vscode.workspace.fs.stat(targetUri)
      return targetUri
    } catch {
      const alternatePath = alternateLibraryPath(uri.path)
      if (!alternatePath) throw new Error(`Cannot resolve ${uri.path} on ${connectionId}`)
      const alternateUri = uri.with({ authority: connectionId, path: alternatePath })
      await vscode.workspace.fs.stat(alternateUri)
      return alternateUri
    }
  }
  if (!connectionId)
    throw new Error("connectionId is required when source is not a full adt:// or file:// URI")

  const root = await getOrCreateRoot(connectionId)
  if (source.startsWith("/sap/bc/adt/")) {
    const found = await root.findByAdtUri(source, false)
    if (!found?.path) throw new Error(`Cannot resolve ADT path ${source} on ${connectionId}`)
    return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
  }

  const results = await getSearchService(connectionId).searchObjects(
    source,
    objectType ? [objectType] : undefined,
    5
  )
  const exact =
    results?.find(result => result.name?.toUpperCase() === source.toUpperCase()) ?? results?.[0]
  if (!exact?.uri) {
    throw new Error(
      `Object ${source}${objectType ? ` (${objectType})` : ""} not found on ${connectionId}`
    )
  }
  const found = await root.findByAdtUri(exact.uri, false)
  if (!found?.path) throw new Error(`Cannot resolve workspace path for ${source}`)
  return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
}

function alternateLibraryPath(value: string): string | undefined {
  if (value.includes("/Source Code Library/"))
    return value.replace("/Source Code Library/", "/Source Library/")
  if (value.includes("/Source Library/"))
    return value.replace("/Source Library/", "/Source Code Library/")
  return undefined
}

export class AbapResourceDownloadService {
  async download(options: AbapResourceDownloadOptions): Promise<AbapResourceDownloadResult> {
    const token = options.token ?? new vscode.CancellationTokenSource().token
    const source = await resolveAbapResource(options)
    const sourceStat = await vscode.workspace.fs.stat(source)
    if (sourceStat.type !== vscode.FileType.Directory) {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.file(path.dirname(options.target.fsPath))
      )
    }
    const total = await this.countFiles(source, token)
    const stats = { files: 0, folders: 0, skipped: 0, failures: [] as string[] }
    let completed = 0
    await this.copyTree(
      source,
      options.target,
      options.overwrite ?? false,
      Math.min(10, Math.max(1, options.concurrency ?? 5)),
      stats,
      token,
      name => {
        completed++
        options.onProgress?.({ completed, total, name })
      }
    )
    return {
      sourceUri: source.toString(),
      targetPath: options.target.fsPath,
      ...stats,
      cancelled: token.isCancellationRequested
    }
  }

  private async copyTree(
    source: vscode.Uri,
    target: vscode.Uri,
    overwrite: boolean,
    concurrency: number,
    stats: { files: number; folders: number; skipped: number; failures: string[] },
    token: vscode.CancellationToken,
    onFile: (name: string) => void
  ): Promise<void> {
    if (token.isCancellationRequested) return
    let stat: vscode.FileStat
    try {
      stat = await vscode.workspace.fs.stat(source)
    } catch (error) {
      stats.failures.push(`${source.toString()} (stat: ${this.errorMessage(error)})`)
      return
    }

    if (stat.type === vscode.FileType.Directory) {
      stats.folders++
      try {
        await vscode.workspace.fs.createDirectory(target)
        const entries = await vscode.workspace.fs.readDirectory(source)
        await runPool(entries, concurrency, async ([name]) =>
          this.copyTree(
            vscode.Uri.joinPath(source, name),
            vscode.Uri.joinPath(target, name),
            overwrite,
            concurrency,
            stats,
            token,
            onFile
          )
        )
      } catch (error) {
        stats.failures.push(`${source.toString()} (${this.errorMessage(error)})`)
      }
      return
    }

    onFile(source.path.split("/").pop() ?? "")
    if (!overwrite) {
      try {
        await vscode.workspace.fs.stat(target)
        stats.skipped++
        return
      } catch {}
    }
    try {
      const content = await vscode.workspace.fs.readFile(source)
      if (token.isCancellationRequested) return
      await vscode.workspace.fs.writeFile(target, content)
      stats.files++
    } catch (error) {
      stats.failures.push(`${source.toString()} (${this.errorMessage(error)})`)
    }
  }

  private async countFiles(source: vscode.Uri, token: vscode.CancellationToken): Promise<number> {
    if (token.isCancellationRequested) return 0
    try {
      const stat = await vscode.workspace.fs.stat(source)
      if (stat.type !== vscode.FileType.Directory) return 1
      const entries = await vscode.workspace.fs.readDirectory(source)
      const counts = await Promise.all(
        entries.map(([name]) => this.countFiles(vscode.Uri.joinPath(source, name), token))
      )
      return counts.reduce((sum, count) => sum + count, 0)
    } catch {
      return 0
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}
