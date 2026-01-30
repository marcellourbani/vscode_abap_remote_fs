import { Uri, workspace } from "vscode"
import * as t from "io-ts"
import { isLeft } from "fp-ts/lib/Either"
import { ADTSCHEME } from "../adt/conections"
import { templates } from "./initialtemplates"

const configFile = "folderMap.json"
const templatesFolder = "templates"
const connectionsFolder = "connections"

const mappingStatus = t.type({
  initialised: t.boolean,
  mappings: t.record(t.string, t.string)
})

type MappingStatus = t.TypeOf<typeof mappingStatus>

export const createFolderIfMissing = async (basePath: Uri) => {
  try {
    await workspace.fs.stat(basePath)
  } catch {
    await workspace.fs.createDirectory(basePath)
  }
  return basePath
}

const createFileIfMissing = async (fileUri: Uri, content: Uint8Array) => {
  try {
    await workspace.fs.stat(fileUri)
  } catch {
    await workspace.fs.writeFile(fileUri, content)
  }
  return fileUri
}

export const initializeMainStorage = async (uri: Uri) => {
  await createFolderIfMissing(uri)
  await createFolderIfMissing(Uri.joinPath(uri, connectionsFolder))
  await createFolderIfMissing(Uri.joinPath(uri, templatesFolder))
  for (const t of templates) {
    await createFileIfMissing(
      Uri.joinPath(uri, templatesFolder, t.name),
      new TextEncoder().encode(t.content)
    )
  }
  const status: MappingStatus = {
    initialised: false,
    mappings: {}
  }
  await createFileIfMissing(
    Uri.joinPath(uri, configFile),
    new TextEncoder().encode(JSON.stringify(status))
  )
}

const unique = (base: string, values: string[]): string => {
  if (!values.includes(base)) return base
  for (let counter = 1; counter < 1000; counter++) {
    const candidate = `${base}_${counter}`
    if (!values.includes(candidate)) return candidate
  }
  throw new Error("Unable to generate unique folder name")
}

const initializeFolder = async (uri: Uri, target: string) => {
  const folderUri = await createFolderIfMissing(Uri.joinPath(uri, connectionsFolder, target))

  for (const t of templates) {
    const readc = async () => {
      try {
        const content = await workspace.fs.readFile(Uri.joinPath(uri, templatesFolder, t.name))
        return content
      } catch (error) {
        return new TextEncoder().encode(t.content)
      }
    }
    const content = await readc()
    await createFileIfMissing(Uri.joinPath(folderUri, t.name), content)
  }

  return folderUri
}

export class LocalStorage {
  private roots = new Map<string, Uri>()
  private initialized = false
  private initializing?: Promise<void> = undefined
  constructor(private root: Uri) {}
  
  private async initialize() {
    if (this.initializing) return this.initializing
    this.initializing = this._initialize()
    await this.initializing
    this.initializing = undefined
  }
  
  private async _initialize() {
    await initializeMainStorage(this.root)
    const configUri = Uri.joinPath(this.root, configFile)
    const raw = await workspace.fs.readFile(configUri)
    const parsed = mappingStatus.decode(JSON.parse(new TextDecoder().decode(raw)))
    if (isLeft(parsed)) throw new Error("Invalid configuration")
    const config = parsed.right
    for (const [k, v] of Object.entries(config.mappings)) {
      this.roots.set(k, Uri.joinPath(this.root, connectionsFolder, v))
    }
    const missing = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME && !this.roots.has(f.uri.authority)
    )
    for (const folder of missing) {
      const target = unique(
        folder.uri.authority.replaceAll(/[^a-zA-Z0-9._-]/g, "_"),
        Object.values(config.mappings)
      )
      const folderUri = await initializeFolder(this.root, target)
      this.roots.set(folder.uri.authority, folderUri)
      config.mappings[folder.uri.authority] = target
      workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify(config)))
    }
    this.initialized = true
  }
  
  public async resolveUri(uri: Uri): Promise<Uri> {
    if (!this.initialized) await this.initialize()
    const root = this.roots.get(uri.authority)
    if (!root) throw new Error(`No local storage for connection ${uri.authority}`)
    const relativePath = uri.path.startsWith("/") ? uri.path.substring(1) : uri.path
    return Uri.joinPath(root, relativePath)
  }
}
