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

const createOrMigrateTemplate = async (
  fileUri: Uri,
  content: Uint8Array,
  previousContents: string[] = []
) => {
  try {
    const existing = new TextDecoder().decode(await workspace.fs.readFile(fileUri))
    if (previousContents.includes(existing)) await workspace.fs.writeFile(fileUri, content)
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
    await createOrMigrateTemplate(
      Uri.joinPath(uri, templatesFolder, t.name),
      new TextEncoder().encode(t.content),
      t.previousContents
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

export const initializeFolder = async (uri: Uri, target: string) => {
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
    await createOrMigrateTemplate(Uri.joinPath(folderUri, t.name), content, t.previousContents)
  }

  return folderUri
}

export class LocalStorage {
  private roots = new Map<string, Uri>()
  private connectionInitializers = new Map<string, Promise<Uri>>()
  private initialized = false
  private initializing?: Promise<void> = undefined
  constructor(private root: Uri) {}

  private async initialize() {
    if (this.initializing) return this.initializing
    this.initializing = this._initialize()
    await this.initializing
    this.initializing = undefined
  }

  private async readConfig() {
    const configUri = Uri.joinPath(this.root, configFile)
    const raw = await workspace.fs.readFile(configUri)
    const parsed = mappingStatus.decode(JSON.parse(new TextDecoder().decode(raw)))
    if (isLeft(parsed)) throw new Error("Invalid configuration")
    return { configUri, config: parsed.right }
  }

  private async ensureConnection(
    authority: string,
    config: MappingStatus,
    configUri: Uri
  ): Promise<Uri> {
    const target =
      config.mappings[authority] ||
      unique(authority.replaceAll(/[^a-zA-Z0-9._-]/g, "_"), Object.values(config.mappings))
    const folderUri = await initializeFolder(this.root, target)

    if (!config.mappings[authority]) {
      config.mappings[authority] = target
      await workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify(config)))
    }
    this.roots.set(authority, folderUri)
    return folderUri
  }

  private async _initialize() {
    await initializeMainStorage(this.root)
    const { configUri, config } = await this.readConfig()
    for (const authority of Object.keys(config.mappings)) {
      await this.ensureConnection(authority, config, configUri)
    }
    const missing = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME && !this.roots.has(f.uri.authority)
    )
    for (const folder of missing) {
      await this.ensureConnection(folder.uri.authority, config, configUri)
    }
    this.initialized = true
  }

  private async initializeConnection(authority: string): Promise<Uri> {
    const existing = this.connectionInitializers.get(authority)
    if (existing) return existing

    const initialization = (async () => {
      const { configUri, config } = await this.readConfig()
      return this.ensureConnection(authority, config, configUri)
    })()

    this.connectionInitializers.set(authority, initialization)
    try {
      return await initialization
    } finally {
      this.connectionInitializers.delete(authority)
    }
  }

  public async resolveUri(uri: Uri): Promise<Uri> {
    if (!this.initialized) await this.initialize()
    const root = this.roots.get(uri.authority) || (await this.initializeConnection(uri.authority))
    const relativePath = uri.path.startsWith("/") ? uri.path.substring(1) : uri.path
    return Uri.joinPath(root, relativePath)
  }
}
