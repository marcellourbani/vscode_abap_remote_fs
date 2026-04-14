import { FileStat, ProgressLocation, Uri, ViewColumn, WebviewPanel, commands } from "vscode"
import {
  BindinTypes,
  CreatableType,
  CreatableTypeIds,
  CreatableTypes,
  objectPath,
  PackageTypes,
  isPackageType,
  parentTypeId,
  ParentTypeIds
} from "abap-adt-api"
import { isAbapStat, isFolder } from "abapfs"
import { fromNode } from "abapobject"
import { transportValidators } from "../adt/AdtTransports"
import { PACKAGE, AdtObjectCreator } from "../adt/operations/AdtObjectCreator"
import { AdtObjectFinder, MySearchResult, pathSequence } from "../adt/operations/AdtObjectFinder"
import { getClient, getRoot } from "../adt/conections"
import { pickAdtRoot } from "../config"
import { caughtToString, fieldOrder, log } from "../lib"
import { funWindow as window } from "../services/funMessenger"

let currentPanel: WebviewPanel | undefined

interface CreateObjectTypeOption {
  typeId: CreatableTypeIds
  label: string
  maxLen: number
  parentType: string
  isPackage: boolean
  isServiceBinding: boolean
  usesSuffix: boolean
}

interface CreateObjectBindingTypeOption {
  label: string
  bindingtype: string
  category: string
}

interface CreateObjectTransportLayerOption {
  label: string
  description: string
  detail: string
}

interface CreateObjectFormContext {
  types: CreateObjectTypeOption[]
  bindingTypes: CreateObjectBindingTypeOption[]
  transportLayers: CreateObjectTransportLayerOption[]
  initialTypeId?: CreatableTypeIds
  initialPackageName: string
  initialParents: Record<string, string>
}

interface CreateObjectFormInput {
  typeId: CreatableTypeIds
  name: string
  description: string
  packageName: string
  parentName?: string
  softwareComponent?: string
  packageType?: PackageTypes
  transportLayer?: string
  serviceDefinition?: string
  bindingType?: string
  bindingCategory?: string
  transportMode?: "existing" | "new" | "locked" | "local"
  selectedTransport?: string
  newTransportText?: string
}

interface TransportOption {
  transport: string
  description: string
}

interface TransportPreview {
  applicable: boolean
  local: boolean
  lockedTransport?: string
  transports: TransportOption[]
  requiresSelection: boolean
  message: string
}

interface PackageSuggestion {
  name: string
  description?: string
}

type CreationDetails = Awaited<ReturnType<typeof buildCreationDetails>>

const toTypeOption = (type: CreatableType): CreateObjectTypeOption => ({
  typeId: type.typeId,
  label: type.label,
  maxLen: type.maxLen,
  parentType: parentTypeId(type.typeId),
  isPackage: isPackageType(type.typeId),
  isServiceBinding: type.typeId === "SRVB/SVB",
  usesSuffix: type.typeId === "FUGR/I"
})

const getSortedTypeOptions = () => [...CreatableTypes.values()].sort(fieldOrder("label")).map(toTypeOption)

const getBindingTypeOptions = (): CreateObjectBindingTypeOption[] =>
  BindinTypes.map(type => ({
    label: type.description,
    bindingtype: type.bindingtype,
    category: type.category
  }))

export async function createObjectInEditorCommand(uri: Uri | undefined) {
  const fsRoot = await pickAdtRoot(uri)
  const connId = fsRoot?.uri.authority
  if (!connId) return

  const formContext = await getCreateObjectFormContext(connId, uri)

  if (currentPanel) {
    currentPanel.dispose()
  }

  currentPanel = window.createWebviewPanel(
    "abapfsCreateObjectEditor",
    "ABAP Create Object",
    ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )

  currentPanel.webview.html = getWebviewHtml(connId, formContext)

  currentPanel.webview.onDidReceiveMessage(
    message => handleWebviewMessage(connId, message),
    undefined,
    []
  )

  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined
    },
    null,
    []
  )
}

async function handleWebviewMessage(connId: string, message: any) {
  try {
    switch (message.command) {
      case "searchPackages":
        postPanelMessage("packageSuggestions", {
          suggestions: await searchPackages(connId, message.query)
        })
        return
      case "browseParent": {
        const [parentName, packageName] = await browseParent(connId, message.parentType)
        postPanelMessage("parentSelected", { parentName, packageName })
        return
      }
      case "browseServiceDefinition":
        postPanelMessage("serviceSelected", {
          serviceDefinition: await browseServiceDefinition(connId)
        })
        return
      case "submit":
        await handleSubmit(connId, message.input)
        return
      case "refreshTransport":
        postPanelMessage("transportInfo", {
          transportInfo: await resolveTransportPreview(connId, message.input)
        })
        return
    }
  } catch (error) {
    postPanelMessage("error", { message: caughtToString(error) })
  }
}

function postPanelMessage(command: string, payload: Record<string, unknown> = {}) {
  currentPanel?.webview.postMessage({ command, ...payload })
}

async function handleSubmit(connId: string, input: CreateObjectFormInput) {
  const obj = await window.withProgress(
    { location: ProgressLocation.Notification, title: "Creating ABAP object..." },
    async () => createObjectFromForm(connId, input)
  )

  if (!obj) {
    postPanelMessage("info", { message: "Object creation was cancelled." })
    return
  }

  log(`Created object ${obj.type} ${obj.name}`)

  if (obj.type === PACKAGE) {
    await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
    postPanelMessage("created", { message: `Created ${obj.type} ${obj.name}` })
    return
  }

  try {
    await commands.executeCommand("abapfs.showObject", { connId, uri: obj.path })
    await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
  } catch {
    log("error opening created object")
  }

  postPanelMessage("created", { message: `Created ${obj.type} ${obj.name}` })
}

function getTypeOption(typeId: CreatableTypeIds): CreateObjectTypeOption | undefined {
  const type = CreatableTypes.get(typeId)
  return type ? toTypeOption(type) : undefined
}

function buildObjectName(input: CreateObjectFormInput, parentName: string): string {
  if (input.typeId !== "FUGR/I") return input.name
  const parts = parentName.split("/")
  return parts.length < 3 ? `L${parentName}${input.name}` : `/${parts[1]}/L${parts[2]}${input.name}`
}

function hasEnoughTransportData(input: CreateObjectFormInput, type: CreateObjectTypeOption): boolean {
  if (!input.typeId || !input.name || !input.packageName) return false
  if (type.parentType !== PACKAGE && type.typeId !== PACKAGE && !input.parentName) return false
  return true
}

async function buildCreationDetails(connId: string, input: CreateObjectFormInput) {
  const creator = new AdtObjectCreator(connId) as any
  const typeInfo = getTypeOption(input.typeId)
  if (!typeInfo) throw new Error(`Unknown object type: ${input.typeId}`)
  validateFormInput(input, typeInfo)

  const parentName = typeInfo.parentType === PACKAGE ? input.packageName : input.parentName || ""
  const responsible = getClient(connId).username.toUpperCase()
  let options: any = {
    description: input.description,
    name: buildObjectName(input, parentName),
    objtype: input.typeId,
    parentName,
    parentPath: objectPath(typeInfo.parentType as CreatableTypeIds, parentName, ""),
    responsible
  }

  if (typeInfo.isServiceBinding) {
    options = {
      ...options,
      bindingtype: input.bindingType,
      category: input.bindingCategory,
      service: input.serviceDefinition
    }
  }

  if (typeInfo.isPackage) {
    const swcomp = input.softwareComponent || (input.name.match(/^\$/) ? "LOCAL" : "HOME")
    options = {
      ...options,
      swcomp,
      packagetype: input.packageType,
      transportLayer: input.transportLayer || ""
    }
  }

  return {
    creator,
    typeInfo,
    devclass: input.packageName,
    options,
    objectContentPath: objectPath(options.objtype, options.name, options.parentName),
    transportLayer: options.transportLayer || ""
  }
}

async function resolveTransportPreview(connId: string, rawInput: CreateObjectFormInput): Promise<TransportPreview> {
  const input = normalizeInput(rawInput)
  const typeInfo = getTypeOption(input.typeId)
  if (!typeInfo || !hasEnoughTransportData(input, typeInfo)) {
    return transportPreviewMessage("Complete object details to load transport requests.")
  }

  const details = await buildCreationDetails(connId, { ...input, description: input.description || "DUMMY" })
  const info = await fetchTransportInfo(connId, details)
  return toTransportPreview(info)
}

function transportPreviewMessage(message: string): TransportPreview {
  return {
    applicable: false,
    local: false,
    transports: [],
    requiresSelection: false,
    message
  }
}

function toTransportPreview(info: any): TransportPreview {
  if (info.LOCKS) {
    return {
      applicable: true,
      local: false,
      lockedTransport: info.LOCKS.HEADER.TRKORR,
      transports: [],
      requiresSelection: false,
      message: `Using locked transport ${info.LOCKS.HEADER.TRKORR}.`
    }
  }

  if (info.DLVUNIT === "LOCAL") {
    return {
      applicable: false,
      local: true,
      transports: [],
      requiresSelection: false,
      message: "This object can be created locally. No transport request is needed."
    }
  }

  const transports = (info.TRANSPORTS || []).map((transport: any) => ({
    transport: transport.TRKORR,
    description: transport.AS4TEXT || ""
  }))

  return {
    applicable: true,
    local: false,
    transports,
    requiresSelection: true,
    message:
      transports.length > 0
        ? "Select an existing transport request or create a new one before submitting."
        : "No existing transport requests found. Enter text to create a new request."
  }
}

async function validateSelectedTransport(
  transport: string,
  objtype: string,
  name: string,
  devClass: string
) {
  for (const validator of transportValidators) {
    const outcome = await validator(transport, objtype, name, devClass)
    if (!outcome) throw new Error(`Transport validation failed for ${transport}`)
  }
}

async function resolveTransportForCreate(
  connId: string,
  input: CreateObjectFormInput,
  details: CreationDetails
): Promise<string> {
  const info = await fetchTransportInfo(connId, details)

  if (info.LOCKS) return info.LOCKS.HEADER.TRKORR
  if (info.DLVUNIT === "LOCAL") return ""

  if (input.transportMode === "existing" && input.selectedTransport) {
    await validateSelectedTransport(
      input.selectedTransport,
      details.options.objtype,
      details.options.name,
      details.devclass
    )
    return input.selectedTransport
  }

  if (input.transportMode === "new" && input.newTransportText) {
    const transport = await getClient(connId).createTransport(
      details.objectContentPath,
      input.newTransportText,
      details.devclass,
      details.transportLayer
    )
    await validateSelectedTransport(
      transport,
      details.options.objtype,
      details.options.name,
      details.devclass
    )
    return transport
  }

  throw new Error("Transport request is required. Select an existing request or enter text for a new one.")
}

async function getCreateObjectFormContext(
  connId: string,
  uri: Uri | undefined
): Promise<CreateObjectFormContext> {
  const creator = new AdtObjectCreator(connId) as any
  const hierarchy = pathSequence(getRoot(connId), uri)
  const initialParents: Record<string, string> = {}

  for (const type of new Set([...CreatableTypes.values()].map(t => parentTypeId(t.typeId)).filter(Boolean))) {
    initialParents[type] = creator.guessParentByType(hierarchy, type as ParentTypeIds)
  }

  return {
    types: getSortedTypeOptions(),
    bindingTypes: getBindingTypeOptions(),
    transportLayers: await getTransportLayerOptions(connId),
    initialTypeId: guessObjectTypeFromHierarchy(hierarchy)?.typeId,
    initialPackageName: creator.guessParentByType(hierarchy, PACKAGE),
    initialParents
  }
}

async function fetchTransportInfo(
  connId: string,
  details: CreationDetails
) {
  return getClient(connId).transportInfo(details.objectContentPath, details.devclass, "I")
}

async function getTransportLayerOptions(connId: string): Promise<CreateObjectTransportLayerOption[]> {
  const layers = await getClient(connId).packageSearchHelp("transportlayers")
  const items = layers.map(layer => ({
    label: layer.name,
    description: layer.description,
    detail: layer.data
  }))
  items.push({ label: "", description: "Blank", detail: "" })
  return items
}

function guessObjectTypeFromHierarchy(hierarchy: FileStat[]): CreatableType | undefined {
  const creatable = (file: FileStat) => {
    const type = isAbapStat(file) && file.object.type
    return type && type !== PACKAGE && CreatableTypes.get(type as CreatableTypeIds)
  }

  const first = hierarchy[0]
  if (isAbapStat(first) && first.object.type === "FUGR/F") return CreatableTypes.get("FUGR/FF")

  for (const file of hierarchy) {
    const candidate = creatable(file)
    if (candidate) return candidate
    if (isFolder(file)) {
      for (const child of file) {
        const nested = creatable(child.file)
        if (nested) return nested
      }
    }
  }

  return undefined
}

async function searchPackages(connId: string, query: string): Promise<PackageSuggestion[]> {
  const searchText = query.trim().toUpperCase()
  if (searchText.length < 2) return []
  const client = getClient(connId)
  const results = await client.searchObject(`${searchText}*`, PACKAGE)
  const mapped = await MySearchResult.createResults(results, client)
  return mapped.slice(0, 20).map(result => ({
    name: result.name,
    description: result.description
  }))
}

async function browseParent(connId: string, parentType: ParentTypeIds): Promise<[string, string]> {
  const creator = new AdtObjectCreator(connId) as any
  return creator.askParent(parentType)
}

async function browseServiceDefinition(connId: string): Promise<string> {
  const result = await new AdtObjectFinder(connId).findObject(
    "Select Service definition",
    "SRVD/SRV"
  )
  return result?.name || ""
}

function validateName(type: CreateObjectTypeOption, name: string): string {
  if (!name) return "Field is mandatory"
  if (type.usesSuffix)
    return /^[A-Za-z]\w\w$/.test(name) ? "" : "Suffix must be 3 characters long"
  if (name.length <= type.maxLen) return ""
  return `Name length of ${name.length} exceeds maximum (${type.maxLen})`
}

function normalizeInput(input: CreateObjectFormInput): CreateObjectFormInput {
  return {
    ...input,
    name: input.name.trim().toUpperCase(),
    description: input.description.trim(),
    packageName: input.packageName.trim().toUpperCase(),
    parentName: input.parentName?.trim().toUpperCase() || "",
    softwareComponent: input.softwareComponent?.trim().toUpperCase() || "",
    transportLayer: input.transportLayer?.trim().toUpperCase() || "",
    serviceDefinition: input.serviceDefinition?.trim().toUpperCase() || ""
  }
}

function validateFormInput(input: CreateObjectFormInput, type: CreateObjectTypeOption): void {
  const nameError = validateName(type, input.name)
  if (nameError) throw new Error(nameError)
  if (!input.description) throw new Error("Description is mandatory")
  if (!input.packageName) throw new Error("Package is mandatory")
  if (type.parentType !== PACKAGE && type.typeId !== PACKAGE && !input.parentName)
    throw new Error("Parent is mandatory")
  if (type.isPackage && (!input.softwareComponent || !input.packageType || input.transportLayer === undefined))
    throw new Error("Software component, package type and transport layer are mandatory")
  if (type.isServiceBinding && (!input.bindingType || !input.bindingCategory || !input.serviceDefinition))
    throw new Error("Service binding type and service definition are mandatory")
}

async function createObjectFromForm(connId: string, rawInput: CreateObjectFormInput) {
  const input = normalizeInput(rawInput)
  const details = await buildCreationDetails(connId, input)
  await details.creator.validateObject(details.options)
  details.options.transport = await resolveTransportForCreate(connId, input, details)
  await getClient(connId).createObject(details.options)

  const parent = await details.creator.getAndRefreshParent(details.options)
  const obj = fromNode(
    {
      EXPANDABLE: "",
      OBJECT_NAME: details.options.name,
      OBJECT_TYPE: details.options.objtype,
      OBJECT_URI: objectPath(details.options),
      OBJECT_VIT_URI: "",
      TECH_NAME: details.options.name
    },
    parent,
    getRoot(connId).service
  )

  if (details.options.objtype !== PACKAGE) await obj.loadStructure()
  return obj
}

function getWebviewHtml(
  connId: string,
  formContext: CreateObjectFormContext
): string {
  const nonce = getNonce()
  const payload = JSON.stringify({ connId, formContext }).replace(/</g, "\\u003c")

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ABAP Create Object</title>
    <style>
      :root {
        --border: var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.35));
        --surface: var(--vscode-editor-background);
        --text: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --accent: var(--vscode-button-background);
        --accent-text: var(--vscode-button-foreground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, var(--border));
        --danger: var(--vscode-errorForeground, #c42b1c);
        --success: #2f855a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 16px;
        font: 13px/1.5 var(--vscode-font-family);
        color: var(--text);
        background: var(--surface);
      }
      .container {
        max-width: 780px;
        margin: 0 auto;
        display: grid;
        gap: 14px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .header h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.3;
      }
      .system-label {
        font-size: 12px;
        color: var(--muted);
      }
      .block {
        display: grid;
        gap: 12px;
        padding-top: 16px;
        border-top: 1px solid var(--border);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 16px;
      }
      .field {
        display: grid;
        gap: 6px;
      }
      .field.full {
        grid-column: 1 / -1;
      }
      .suggestion-box {
        position: relative;
      }
      .suggestion-list {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 20;
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid var(--border);
        background: var(--surface);
      }
      .suggestion-item {
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-bottom: 1px solid var(--border);
        color: var(--text);
        background: transparent;
        text-align: left;
      }
      .suggestion-item:last-child {
        border-bottom: 0;
      }
      .suggestion-item:hover,
      .suggestion-item:focus {
        background: var(--surface-alt);
        outline: none;
      }
      .suggestion-title {
        display: block;
        font-weight: 600;
      }
      .suggestion-detail {
        display: block;
        color: var(--muted);
        font-size: 12px;
      }
      label {
        font-weight: 600;
      }
      .hint {
        color: var(--muted);
        font-size: 12px;
      }
      .control {
        width: 100%;
        min-height: 34px;
        padding: 6px 10px;
        border: 1px solid var(--input-border);
        color: var(--input-fg);
        background: var(--input-bg);
      }
      .inline {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
      }
      button {
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid var(--border);
        color: var(--accent-text);
        background: var(--accent);
        cursor: pointer;
      }
      button.secondary {
        color: var(--text);
        background: var(--input-bg);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .message {
        min-height: 20px;
        color: var(--muted);
      }
      .message.error { color: var(--danger); }
      .message.success { color: var(--success); }
      .hidden { display: none; }
      .hint.reserved {
        min-height: 18px;
      }
      @media (max-width: 720px) {
        body { padding: 12px; }
        .header {
          flex-direction: column;
          align-items: flex-start;
        }
        .grid { grid-template-columns: 1fr; }
        .inline { grid-template-columns: 1fr; }
        .actions {
          flex-direction: column-reverse;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header class="header">
        <h1>Create ABAP Object</h1>
        <div class="system-label">${escapeHtml(connId)}</div>
      </header>

      <section class="block">
        <div class="grid">
          <div class="field full">
            <label for="typeId">Object type</label>
            <select id="typeId" class="control"></select>
          </div>
          <div class="field">
            <label id="nameLabel" for="name">Name</label>
            <input id="name" class="control" autocomplete="off" spellcheck="false" />
            <div id="nameHint" class="hint reserved"></div>
          </div>
          <div class="field">
            <label for="description">Description</label>
            <input id="description" class="control" autocomplete="off" spellcheck="false" />
            <div class="hint reserved"></div>
          </div>
          <div class="field full">
            <label for="packageName">Package</label>
            <div class="suggestion-box">
              <input id="packageName" class="control" autocomplete="off" spellcheck="false" />
              <div id="packageSuggestions" class="suggestion-list hidden"></div>
            </div>
            <div class="hint">Type at least 2 characters to search packages.</div>
          </div>
          <div id="parentField" class="field full">
            <label id="parentLabel" for="parentName">Parent</label>
            <div class="inline">
              <input id="parentName" class="control" autocomplete="off" spellcheck="false" />
              <button id="browseParent" type="button" class="secondary">Browse</button>
            </div>
          </div>
        </div>
      </section>

      <section id="packagePanel" class="block hidden">
        <div class="grid">
          <div class="field">
            <label for="softwareComponent">Software component</label>
            <input id="softwareComponent" class="control" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label for="packageType">Package type</label>
            <select id="packageType" class="control">
              <option value="">Select package type</option>
              <option value="development">development</option>
              <option value="structure">structure</option>
              <option value="main">main</option>
            </select>
          </div>
          <div class="field full">
            <label for="transportLayer">Transport layer</label>
            <select id="transportLayer" class="control"></select>
          </div>
        </div>
      </section>

      <section id="servicePanel" class="block hidden">
        <div class="grid">
          <div class="field">
            <label for="bindingSelection">Binding type</label>
            <select id="bindingSelection" class="control"></select>
          </div>
          <div class="field full">
            <label for="serviceDefinition">Service definition</label>
            <div class="inline">
              <input id="serviceDefinition" class="control" autocomplete="off" spellcheck="false" />
              <button id="browseService" type="button" class="secondary">Browse</button>
            </div>
          </div>
        </div>
      </section>

      <section id="transportPanel" class="block hidden">
        <div class="grid">
          <div class="field full">
            <div id="transportMessage" class="hint"></div>
          </div>
          <div id="transportModeField" class="field">
            <label for="transportMode">Transport action</label>
            <select id="transportMode" class="control">
              <option value="existing">Use existing transport</option>
              <option value="new">Create new transport</option>
            </select>
          </div>
          <div id="existingTransportField" class="field full">
            <label for="selectedTransport">Existing transport</label>
            <select id="selectedTransport" class="control"></select>
          </div>
          <div id="newTransportField" class="field full hidden">
            <label for="newTransportText">New transport text</label>
            <input id="newTransportText" class="control" autocomplete="off" spellcheck="false" />
          </div>
        </div>
      </section>

      <section class="block">
        <div id="message" class="message"></div>
        <div class="actions">
          <button id="reset" type="button" class="secondary">Reset defaults</button>
          <button id="submit" type="button">Create</button>
        </div>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = ${payload};
      const typeMap = new Map(state.formContext.types.map(type => [type.typeId, type]));
      const bindingOptions = state.formContext.bindingTypes;
      const initialParents = state.formContext.initialParents || {};

      const byId = id => document.getElementById(id);
      const setHidden = (element, hidden) => element.classList.toggle('hidden', hidden);
      const post = (command, payload = {}) => vscode.postMessage({ command, ...payload });
      const setOptions = (element, html) => (element.innerHTML = html);
      const optionHtml = (value, label) => '<option value="' + escapeAttr(value) + '">' + escapeHtml(label) + '</option>';
      const bind = (element, event, handler) => element.addEventListener(event, handler);
      const el = {
        typeId: byId('typeId'),
        name: byId('name'),
        description: byId('description'),
        packageName: byId('packageName'),
        packageSuggestions: byId('packageSuggestions'),
        parentName: byId('parentName'),
        softwareComponent: byId('softwareComponent'),
        packageType: byId('packageType'),
        transportLayer: byId('transportLayer'),
        bindingSelection: byId('bindingSelection'),
        serviceDefinition: byId('serviceDefinition'),
        parentField: byId('parentField'),
        parentLabel: byId('parentLabel'),
        nameLabel: byId('nameLabel'),
        nameHint: byId('nameHint'),
        packagePanel: byId('packagePanel'),
        servicePanel: byId('servicePanel'),
        transportPanel: byId('transportPanel'),
        transportMessage: byId('transportMessage'),
        transportMode: byId('transportMode'),
        selectedTransport: byId('selectedTransport'),
        newTransportText: byId('newTransportText'),
        transportModeField: byId('transportModeField'),
        existingTransportField: byId('existingTransportField'),
        newTransportField: byId('newTransportField'),
        message: byId('message'),
        browseParent: byId('browseParent'),
        browseService: byId('browseService'),
        submit: byId('submit'),
        reset: byId('reset')
      };
      let transportState = null;
      let transportRefreshTimer = 0;
      let packageSuggestionTimer = 0;
      let packageSuggestionItems = [];

      function setMessage(text, kind = '') {
        el.message.textContent = text || '';
        el.message.className = 'message' + (kind ? ' ' + kind : '');
      }

      function currentType() {
        return typeMap.get(el.typeId.value);
      }

      function syncSoftwareComponent() {
        const type = currentType();
        if (!type || !type.isPackage) return;
        if (!el.softwareComponent.dataset.touched || el.softwareComponent.dataset.touched === 'false') {
          el.softwareComponent.value = el.name.value.trim().startsWith('$') ? 'LOCAL' : 'HOME';
        }
      }

      function updateLayout() {
        const type = currentType();
        if (!type) {
          setHidden(el.parentField, true);
          setHidden(el.packagePanel, true);
          setHidden(el.servicePanel, true);
          setHidden(el.transportPanel, true);
          el.nameLabel.textContent = 'Name';
          el.nameHint.textContent = '';
          return;
        }

        el.nameLabel.textContent = type.usesSuffix ? 'Suffix' : 'Name';
        el.nameHint.textContent = type.usesSuffix
          ? 'Function group includes use a 3-character suffix.'
          : 'Maximum length: ' + type.maxLen;

        const hasParent = type.parentType && type.parentType !== 'DEVC/K';
        setHidden(el.parentField, !hasParent);
        setHidden(el.packagePanel, !type.isPackage);
        setHidden(el.servicePanel, !type.isServiceBinding);

        if (hasParent) {
          el.parentLabel.textContent = type.parentType === 'FUGR/F' ? 'Function group' : 'Parent';
          if (!el.parentName.value && initialParents[type.parentType]) {
            el.parentName.value = initialParents[type.parentType];
          }
        } else {
          el.parentName.value = el.packageName.value.trim();
        }

        if (type.isPackage) {
          syncSoftwareComponent();
        }

        scheduleTransportRefresh();
      }

      function updateTransportLayout() {
        if (!transportState) {
          setHidden(el.transportPanel, true);
          return;
        }

        setHidden(el.transportPanel, false);
        el.transportMessage.textContent = transportState.message || '';

        if (transportState.local) {
          setHidden(el.transportModeField, true);
          setHidden(el.existingTransportField, true);
          setHidden(el.newTransportField, true);
          return;
        }

        if (transportState.lockedTransport) {
          setHidden(el.transportModeField, true);
          setHidden(el.existingTransportField, false);
          setHidden(el.newTransportField, true);
          el.selectedTransport.innerHTML = '<option value="' + escapeAttr(transportState.lockedTransport) + '">' + escapeHtml(transportState.lockedTransport) + '</option>';
          el.selectedTransport.value = transportState.lockedTransport;
          return;
        }

        setHidden(el.transportModeField, !transportState.requiresSelection);
        setHidden(el.existingTransportField, el.transportMode.value !== 'existing');
        setHidden(el.newTransportField, el.transportMode.value !== 'new');
      }

      function scheduleTransportRefresh() {
        if (transportRefreshTimer) {
          clearTimeout(transportRefreshTimer);
        }
        transportRefreshTimer = setTimeout(() => {
          post('refreshTransport', { input: collectInput() });
        }, 250);
      }

      function schedulePackageSuggestions() {
        if (packageSuggestionTimer) {
          clearTimeout(packageSuggestionTimer);
        }
        packageSuggestionTimer = setTimeout(() => {
          post('searchPackages', { query: el.packageName.value });
        }, 180);
      }

      function applyTransportInfo(info) {
        transportState = info;
        if (!info || !info.applicable && !info.local) {
          setHidden(el.transportPanel, true);
          return;
        }

        if (info.transports && info.transports.length > 0) {
          setOptions(
            el.selectedTransport,
            info.transports
              .map(item => optionHtml(item.transport, item.transport + (item.description ? ' ' + item.description : '')))
              .join('')
          );
          if (!el.selectedTransport.value && info.transports[0]) {
            el.selectedTransport.value = info.transports[0].transport;
          }
        } else {
          setOptions(el.selectedTransport, optionHtml('', 'No existing transports'));
          if (el.transportMode.value === 'existing') {
            el.transportMode.value = 'new';
          }
        }

        if (info.lockedTransport) {
          el.transportMode.value = 'locked';
        } else if (info.local) {
          el.transportMode.value = 'local';
        } else if (el.transportMode.value !== 'existing' && el.transportMode.value !== 'new') {
          el.transportMode.value = info.transports && info.transports.length > 0 ? 'existing' : 'new';
        }

        updateTransportLayout();
      }

      function applyPackageSuggestions(suggestions) {
        packageSuggestionItems = suggestions || [];
        if (!packageSuggestionItems.length) {
          el.packageSuggestions.innerHTML = '';
          setHidden(el.packageSuggestions, true);
          return;
        }

        el.packageSuggestions.innerHTML = packageSuggestionItems
          .map((item, index) =>
            '<button type="button" class="suggestion-item" data-package-index="' + index + '">' +
            '<span class="suggestion-title">' + escapeHtml(item.name) + '</span>' +
            '<span class="suggestion-detail">' + escapeHtml(item.description || '') + '</span>' +
            '</button>'
          )
          .join('');
        setHidden(el.packageSuggestions, false);
      }

      function hidePackageSuggestions() {
        setHidden(el.packageSuggestions, true);
      }

      function choosePackageSuggestion(index) {
        const selected = packageSuggestionItems[index];
        if (!selected) {
          return;
        }
        el.packageName.value = selected.name;
        hidePackageSuggestions();
        if (currentType() && currentType().parentType === 'DEVC/K') {
          el.parentName.value = el.packageName.value.trim();
        }
        scheduleTransportRefresh();
      }

      function populate() {
        setOptions(
          el.typeId,
          optionHtml('', 'Select object type') + state.formContext.types
            .map(type => optionHtml(type.typeId, type.label + ' (' + type.typeId + ')'))
            .join('')
        );

        setOptions(
          el.transportLayer,
          state.formContext.transportLayers
            .map(layer => optionHtml(layer.label, layer.label || 'Blank'))
            .join('')
        );

        setOptions(
          el.bindingSelection,
          optionHtml('', 'Select binding type') + bindingOptions
            .map((binding, index) => optionHtml(String(index), binding.label))
            .join('')
        );
      }

      function applyDefaults() {
        el.typeId.value = state.formContext.initialTypeId || '';
        el.name.value = '';
        el.description.value = '';
        el.packageName.value = state.formContext.initialPackageName || '';
        el.parentName.value = '';
        el.softwareComponent.value = 'HOME';
        el.softwareComponent.dataset.touched = 'false';
        el.packageType.value = '';
        el.transportLayer.value = '';
        el.bindingSelection.value = '';
        el.serviceDefinition.value = '';
        el.transportMode.value = 'existing';
        el.selectedTransport.innerHTML = '';
        el.newTransportText.value = '';
        el.packageSuggestions.innerHTML = '';
        hidePackageSuggestions();
        transportState = null;
        updateLayout();
      }

      function selectedBinding() {
        return el.bindingSelection.value === '' ? undefined : bindingOptions[Number(el.bindingSelection.value)];
      }

      function collectInput() {
        const binding = selectedBinding();
        return {
          typeId: el.typeId.value,
          name: el.name.value.trim(),
          description: el.description.value.trim(),
          packageName: el.packageName.value.trim(),
          parentName: el.parentName.value.trim(),
          softwareComponent: el.softwareComponent.value.trim(),
          packageType: el.packageType.value || undefined,
          transportLayer: el.transportLayer.value,
          serviceDefinition: el.serviceDefinition.value.trim(),
          bindingType: binding ? binding.bindingtype : undefined,
          bindingCategory: binding ? binding.category : undefined,
          transportMode: el.transportMode.value || undefined,
          selectedTransport: el.selectedTransport.value || undefined,
          newTransportText: el.newTransportText.value.trim()
        };
      }

      function escapeHtml(value) {
        return value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function escapeAttr(value) {
        return escapeHtml(value).split(String.fromCharCode(96)).join('&#96;');
      }

      window.addEventListener('message', event => {
        const data = event.data;
        if (!data) return;
        const handlers = {
          packageSuggestions: () => applyPackageSuggestions(data.suggestions),
          parentSelected: () => {
            if (data.parentName) el.parentName.value = data.parentName;
            if (data.packageName) el.packageName.value = data.packageName;
            updateLayout();
          },
          serviceSelected: () => {
            if (data.serviceDefinition) el.serviceDefinition.value = data.serviceDefinition;
          },
          transportInfo: () => applyTransportInfo(data.transportInfo),
          error: () => setMessage(data.message, 'error'),
          info: () => setMessage(data.message),
          created: () => setMessage(data.message, 'success')
        };
        if (handlers[data.command]) {
          handlers[data.command]();
        }
      });

      bind(el.browseParent, 'click', () => {
        const type = currentType();
        if (!type || !type.parentType || type.parentType === 'DEVC/K') {
          return;
        }
        setMessage('');
        post('browseParent', { parentType: type.parentType });
      });

      bind(el.browseService, 'click', () => {
        setMessage('');
        post('browseServiceDefinition');
      });

      bind(el.submit, 'click', () => {
        setMessage('');
        post('submit', { input: collectInput() });
      });

      bind(el.reset, 'click', () => {
        setMessage('');
        applyDefaults();
      });

      bind(el.packageSuggestions, 'mousedown', event => {
        event.preventDefault();
        const button = event.target.closest('[data-package-index]');
        if (!button) {
          return;
        }
        choosePackageSuggestion(Number(button.getAttribute('data-package-index')));
      });

      bind(el.typeId, 'change', updateLayout);
      bind(el.packageName, 'input', () => {
        if (currentType() && currentType().parentType === 'DEVC/K') {
          el.parentName.value = el.packageName.value.trim();
        }
        schedulePackageSuggestions();
        scheduleTransportRefresh();
      });
      bind(el.packageName, 'focus', () => {
        if (packageSuggestionItems.length > 0) {
          setHidden(el.packageSuggestions, false);
        }
      });
      bind(el.packageName, 'blur', () => {
        setTimeout(() => hidePackageSuggestions(), 120);
      });
      bind(el.name, 'input', () => {
        syncSoftwareComponent();
        scheduleTransportRefresh();
      });
      [el.description, el.parentName].forEach(node => bind(node, 'input', scheduleTransportRefresh));
      [el.packageType, el.transportLayer].forEach(node => bind(node, 'change', scheduleTransportRefresh));
      bind(el.transportMode, 'change', updateTransportLayout);
      bind(el.softwareComponent, 'input', () => {
        el.softwareComponent.dataset.touched = 'true';
        scheduleTransportRefresh();
      });
      bind(el.newTransportText, 'input', () => setMessage(''));

      populate();
      applyDefaults();
    </script>
  </body>
</html>`
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let index = 0; index < 32; index++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
