import * as vscode from "vscode"
import * as path from "node:path"
import { mkdirSync } from "node:fs"
import { ADTSCHEME } from "../../../adt/conections"

// ACP agents only understand absolute local paths, so every adt://<system>/<path> resource is
// exposed to them as <agentRoot>/adt/<system>/<path>. Reads and writes are routed back to the
// ABAP FS file system provider; nothing exists on the local disk, because ACP has no stat or
// list request.
let agentRoot = ""

export function initAgentRoot(storageDir: string): void {
  agentRoot = path.join(storageDir, "acp-workspace")
  mkdirSync(adtMountRoot(), { recursive: true })
}

export function agentWorkspaceRoot(): string {
  return agentRoot
}

export function adtMountRoot(): string {
  return path.join(agentRoot, ADTSCHEME)
}

const isWindows = process.platform === "win32"

function relativeToMount(localPath: string): string | undefined {
  if (!agentRoot) return
  const resolved = path.resolve(localPath)
  const root = adtMountRoot()
  const head = resolved.slice(0, root.length)
  const sameRoot = isWindows ? head.toLowerCase() === root.toLowerCase() : head === root
  if (!sameRoot) return
  const rest = resolved.slice(root.length)
  if (rest && !rest.startsWith(path.sep)) return
  return rest.split(path.sep).filter(Boolean).join("/")
}

/** Translate a path received from an agent into the VS Code URI that backs it */
export function toVscodeUri(agentPath: string): vscode.Uri {
  if (/^adt:\/\//i.test(agentPath)) return vscode.Uri.parse(agentPath)
  const localPath = /^file:\/\//i.test(agentPath) ? vscode.Uri.parse(agentPath).fsPath : agentPath
  const relative = relativeToMount(localPath)
  if (relative === undefined) return vscode.Uri.file(localPath)
  const [authority = "", ...segments] = relative.split("/")
  return vscode.Uri.from({ scheme: ADTSCHEME, authority, path: `/${segments.join("/")}` })
}

/** Translate a VS Code URI into the absolute path an agent should use for it */
export function toAgentPath(uri: vscode.Uri): string {
  if (uri.scheme === "file") return uri.fsPath
  if (uri.scheme !== ADTSCHEME || !agentRoot) return uri.toString()
  return path.join(adtMountRoot(), uri.authority, ...uri.path.split("/").filter(Boolean))
}

export function toAgentUri(uri: vscode.Uri): string {
  if (uri.scheme !== ADTSCHEME || !agentRoot) return uri.toString()
  return vscode.Uri.file(toAgentPath(uri)).toString()
}

export function isLocalPath(agentPath: string): boolean {
  return toVscodeUri(agentPath).scheme === "file"
}

/** Context sent with the first prompt so agents know how ABAP objects are exposed */
export function abapWorkspaceHint(): string {
  const systems = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === ADTSCHEME)
  if (!systems.length) return ""
  const lines = systems.map(f => `- ${f.name}: ${toAgentPath(f.uri)}`)
  return [
    "[ABAP FS context]",
    "SAP systems are exposed as virtual folders that do NOT exist on the local disk: shell commands, grep, glob and existence checks will not find them.",
    "Read these paths through the client file system (your read file tool) or the abap-fs MCP tools. To edit ABAP sources use the abap-fs replace_string_in_abap_object tool with the adt:// URI.",
    "abap-fs tools return adt:// URIs; the matching path is the system folder below followed by the URI path.",
    ...lines,
    "Use abapfs_search_objects and abapfs_get_workspace_uri to locate objects, and abapfs_activate_object after editing."
  ].join("\n")
}
