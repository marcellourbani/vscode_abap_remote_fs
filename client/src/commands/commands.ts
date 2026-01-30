import { PACKAGE, AdtObjectCreator } from "../adt/operations/AdtObjectCreator"
import { CreatableTypeIds, PackageTypes } from "abap-adt-api"
import {
  workspace,
  Uri,
  commands,
  ProgressLocation,
  Range,
  FileChangeType,
  extensions
} from "vscode"
import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { pickAdtRoot, RemoteManager } from "../config"
import { caughtToString, inputBox, lineRange, log, rangeVscToApi, splitAdtUri, channel } from "../lib"
import { FavouritesProvider, FavItem } from "../views/favourites"
import { findEditor, vsCodeUri } from "../langClient"
import { showHideActivate } from "../listeners"
import { UnitTestRunner } from "../adt/operations/UnitTestRunner"
import { selectTransport } from "../adt/AdtTransports"
import { showInGuiCb, executeInGui, runInSapGui } from "../adt/sapgui/sapgui"
import { storeTokens, clearTokens } from "../oauth"
import { showAbapDoc } from "../views/help"
import { showQuery } from "../views/query/query"
import {
  ADTSCHEME,
  getClient,
  getRoot,
  uriRoot,
  getOrCreateRoot,
  disconnect
} from "../adt/conections"
import { isAbapFolder, isAbapFile, isAbapStat } from "abapfs"
import { AdtObjectActivator } from "../adt/operations/AdtObjectActivator"
import {
  AdtObjectFinder,
  createUri,
  findAbapObject,
  uriAbapFile
} from "../adt/operations/AdtObjectFinder"
import { isAbapClassInclude } from "abapobject"
import { IncludeProvider } from "../adt/includes" // resolve dependencies
import { command, AbapFsCommands } from "."
import { createConnection } from "./connectionwizard"
import { openConnectionManager } from "../configuration/sapConnectionManager"
import { context as extensionContext } from "../extension"
import { types } from "util"
import { atcProvider } from "../views/abaptestcockpit"
import { FsProvider } from "../fs/FsProvider"
import { logTelemetry } from "../services/telemetry"

export function currentUri() {
  if (!window.activeTextEditor) return
  const uri = window.activeTextEditor.document.uri
  if (uri.scheme !== ADTSCHEME) return
  return uri
}
export function currentAbapFile() {
  const uri = currentUri()
  return uriAbapFile(uri)
}

export function currentEditState() {
  const uri = currentUri()
  if (!uri) return
  const line = window.activeTextEditor?.selection.active.line
  return { uri, line }
}

export function openObject(connId: string, uri: string, objectType?: string) {
  return window.withProgress(
    { location: ProgressLocation.Notification, title: "Opening..." },
    async () => {
      const root = getRoot(connId)
      let result = await root.findByAdtUri(uri, true)
      
      // If not found, try refreshing the workspace (for newly created objects)
      if (!result) {
        try {
          await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
          await new Promise(resolve => setTimeout(resolve, 500)) // Give it a moment
          result = await root.findByAdtUri(uri, true)
        } catch (e) {
          // Refresh failed or still not found
        }
      }
      
      const { file, path } = result || {}
      if (!file || !path) throw new Error("Object not found in workspace. Try refreshing the explorer.")
      
      if (isAbapFolder(file) && file.object.type === PACKAGE) {
        await commands.executeCommand(
          "revealInExplorer",
          createUri(connId, path)
        )
        return
      } else if (isAbapFile(file)) {
        const fileUri = createUri(connId, path)
        
        // For message classes, force open with custom editor
        if (objectType === 'MSAG/N' || path.endsWith('.msagn.xml')) {
          await commands.executeCommand('vscode.openWith', fileUri, 'abapfs.msagn')
        } else {
          await workspace
            .openTextDocument(fileUri)
            .then(window.showTextDocument)
        }
      }
      return { file, path }
    }
  )
}
interface ShowObjectArgument {
  connId: string,
  uri: string
}
export class AdtCommands {
  @command(AbapFsCommands.extractMethod)
  private static async extractMethod(url: string, range: Range) {
    const uri = Uri.parse(url)
    const client = getClient(uri.authority)
    const root = getRoot(uri.authority)
    const file = await root.getNodeAsync(uri.path)
    if (isAbapFile(file)) {
      const o = file.object
      const proposal = await client.extractMethodEvaluate(o.path, rangeVscToApi(range))
      const methodName = await window.showInputBox({ prompt: "Method name" })
      if (!methodName) return
      const transport = await selectTransport(o.path, "", client)
      if (transport.cancelled) return
      proposal.genericRefactoring.transport = transport.transport
      proposal.name = methodName
      const preview = await client.extractMethodPreview(proposal)
      await client.extractMethodExecute(preview)
      FsProvider.get().notifyChanges([{ type: FileChangeType.Changed, uri }])
    }

  }
  @command(AbapFsCommands.showDocumentation)
  private static async showAbapDoc() {
    return showAbapDoc()
  }

  @command(AbapFsCommands.selectDB)
  private static async selectDB(table?: string) {
    return showQuery(table)
  }

  @command(AbapFsCommands.changeInclude)
  private static async changeMain(uri: Uri) {
    return IncludeProvider.get().switchInclude(uri)
  }

  @command(AbapFsCommands.createConnection)
  private static createConnectionCommand() {
    return createConnection()
  }

  @command(AbapFsCommands.connectionManager)
  private static connectionManagerCommand() {
    return openConnectionManager(extensionContext)
  }

  @command(AbapFsCommands.connect)
  private static async connectAdtServer(selector: any) {
    let name = ""
    try {
      const connectionID = selector && selector.connection
      const manager = RemoteManager.get()
      const { remote, userCancel } = await manager.selectConnection(
        connectionID
      )
      if (!remote)
        if (!userCancel)
          throw Error("No remote configuration available in settings")
        else return
      name = remote.name

      // this might involve asking for a password...
      await getOrCreateRoot(remote.name) // if connection raises an exception don't mount any folder

      await storeTokens()

      workspace.updateWorkspaceFolders(0, 0, {
        uri: Uri.parse("adt://" + remote.name),
        name: remote.name + "(ABAP)"
      })
      extensionContext.subscriptions.push(UnitTestRunner.get(connectionID).controller)


    } catch (e) {
      const body = typeof e === "object" && (e as any)?.response?.body
      if (body) log(body)
      const isMissing = (e: any) =>
        !!`${e}`.match("name.*org.freedesktop.secrets")
      const message = isMissing(e)
        ? `Password storage not supported. Please install gnome-keyring or add a password to the connection`
        : `Failed to connect to ${name}:${caughtToString(e)}`
      return window.showErrorMessage(message)
    }
  }

  @command(AbapFsCommands.disconnect)
  private static async disconnectAdtServer(selector?: any) {
    try {
      
      // Show confirmation dialog
      const choice = await window.showWarningMessage(
        "This will disconnect from all ABAP systems and remove them from the workspace. Continue?",
        { modal: true },
        "Disconnect",
        "Cancel"
      )
      
      if (choice !== "Disconnect") {
        return
      }

      // Get all current ABAP workspace folders
      const abapFolders = workspace.workspaceFolders?.filter(
        folder => folder.uri.scheme === ADTSCHEME
      ) || []

      // Log out from all connections and clear cached data
      await disconnect()
      
      // Remove all ABAP folders from workspace
      if (abapFolders.length > 0) {
        const startIndex = workspace.workspaceFolders?.findIndex(
          folder => folder.uri.scheme === ADTSCHEME
        ) ?? 0
        
        workspace.updateWorkspaceFolders(
          startIndex, 
          abapFolders.length // Remove all ABAP folders
        )
        
      }

      // Clear any cached tokens
      clearTokens()
      
      // Refresh file explorer to reflect changes
      await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
      
      window.showInformationMessage("✅ Disconnected from all ABAP systems")
      
    } catch (e) {
      const message = `Failed to disconnect: ${caughtToString(e)}`
      return window.showErrorMessage(message)
    }
  }

  @command(AbapFsCommands.activate)
  private static async activateCurrent(selector: Uri) {
    try {
      const uri = selector || currentUri()
      logTelemetry("command_activate_called", { connectionId: uri?.authority })
      if (!uri) {
        throw new Error('No ABAP file is currently open')
      }
      
      const activator = AdtObjectActivator.get(uri.authority)
      const editor = findEditor(uri.toString())
      
      await window.withProgress(
        { location: ProgressLocation.Notification, title: "Activating..." },
        async (progress) => {
          // Wait for any pending Copilot changes to complete
          await new Promise(resolve => setTimeout(resolve, 3000))
          
          progress.report({ message: "Validating object..." })
          const obj = await findAbapObject(uri)
          
          // Enhanced save logic with better error handling
          if (editor && editor.document.isDirty) {
            progress.report({ message: "Saving changes..." })
            const saved = await editor.document.save()
            if (!saved) {
              throw new Error('Failed to save file before activation. Please save manually and try again.')
            }
            // Small delay to ensure save is completed
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          
          progress.report({ message: "Activating object..." })
          const { ok, summary } = await activator.activate(obj, uri)
          if (!ok) {
            throw new Error(summary || 'Activation failed; see ABAP FS output for details')
          }
          
          if (editor === window.activeTextEditor) {
            await workspace.fs.stat(uri)
            await showHideActivate(editor)
          }
        }
      )
      
      // Show success message
      const objectName = uri.path.split('/').pop() || 'Object'
      window.showInformationMessage(`✅ ${objectName} activated successfully`)
      
    } catch (e) {
      const errorMessage = caughtToString(e)

      const action = await window.showErrorMessage(`Activation failed: ${errorMessage}`, 'Show activation log')
      if (action === 'Show activation log') {
        channel.show(true)
      }
      // Don't re-throw or show additional notifications - user already saw the summary
      return
    }
  }

  @command(AbapFsCommands.pickAdtRootConn)
  private static async pickRoot() {
    const uri = currentUri()
    const fsRoot = await pickAdtRoot(uri)
    if (!fsRoot) return
    return fsRoot.uri.authority
  }

  @command(AbapFsCommands.runClass)
  private static async runClass() {
    try {
      const uri = currentUri()
      if (!uri) return
      const client = getClient(uri.authority)
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      const clas = isAbapFile(file) && isAbapClassInclude(file.object) && file.object.parent
      if (clas) {
        const text = await client.runClass(clas.name)
      }
    } catch (error) {
      log(caughtToString(error))
    }

  }

  @command(AbapFsCommands.search)
  private static async searchAdtObject(uri: Uri | undefined) {
    // find the adt relevant namespace roots, and let the user pick one if needed
    const adtRoot = await pickAdtRoot(uri)
    logTelemetry("command_search_for_object_called", { connectionId: adtRoot?.uri.authority })
    if (!adtRoot) return
    try {
      const connId = adtRoot.uri.authority
      // Use enhanced search with type filter for manual command
      const object = await new AdtObjectFinder(connId).findObjectWithTypeFilter()
      if (!object) return // user cancelled
      // found, show progressbar as opening might take a while
      await openObject(connId, object.uri, object.type)
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.create)
  private static async createAdtObject(uri: Uri | undefined) {
    try {
      // find the adt relevant namespace roots, and let the user pick one if needed
      const fsRoot = await pickAdtRoot(uri)
      logTelemetry("command_create_object_called", { connectionId: fsRoot?.uri.authority })
      const connId = fsRoot?.uri.authority
      if (!connId) return
      const obj = await new AdtObjectCreator(connId).createObject(uri)
      if (!obj) return // user aborted
      await obj.loadStructure()

      if (obj.type === PACKAGE) {
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return // Packages can't be opened perhaps could reveal it?
      }
      const nodePath = await openObject(connId, obj.path)
      if (nodePath) {
        new AdtObjectFinder(connId).displayNode(nodePath)
        try {
          await commands.executeCommand(
            "workbench.files.action.refreshFilesExplorer"
          )
        } catch (e) {
          //log("error refreshing workspace")
        }
      }
    } catch (e) {
      const stack = types.isNativeError(e) ? e.stack || "" : ""
      return window.showErrorMessage(caughtToString(e))
    }
  }

  /**
   * Creates an ABAP object programmatically for AI/automation purposes
   * Uses the exact same logic as createObject() but with programmatic selections
   * 
   * @example
   * // Create a new ABAP report with new transport request
   * await vscode.commands.executeCommand('abapfs.createObjectProgrammatically', 
   *   'PROG/P', 'ZTEST_REPORT', 'test:do not use', 'ZXXX', undefined, undefined, {
   *     transportRequest: { type: 'new', description: 'Test transport - do not move' }
   *   });
   * 
   * @example  
   * // Create a new class with existing transport request
   * await vscode.commands.executeCommand('abapfs.createObjectProgrammatically',
   *   'CLAS/OC', 'ZCL_TEST', 'Test class', 'ZXXX', undefined, undefined, {
   *     transportRequest: { type: 'existing', number: 'DEV1K900123' }
   *   });
   */
  @command(AbapFsCommands.createObjectProgrammatically)
  public static async createAdtObjectProgrammatically(
    objectType: CreatableTypeIds,
    name: string,
    description: string,
    packageName: string = "$TMP",
    parentName?: string,
    connectionId?: string,
    additionalOptions?: {
      // For service bindings
      serviceDefinition?: string
      bindingType?: string
      bindingCategory?: string
      // For packages  
      softwareComponent?: string
      packageType?: PackageTypes
      transportLayer?: string
      // For transport requests
      transportRequest?: {
        type: 'new' | 'existing'
        number?: string        // For existing transport
        description?: string   // For new transport
      }
    }
  ) {
    try {
      
      // Use current connection or specified one
      const connId = connectionId || (await pickAdtRoot())?.uri.authority
      if (!connId) return
      

      // Create a special AdtObjectCreator that uses programmatic selections
      const creator = new AdtObjectCreator(connId)
      
      // Override the key methods based on AdtObjectCreator analysis
      
      // 1. Override askInput for name and description prompts
      creator['askInput'] = async (prompt: string, uppercase: boolean = true, value = ""): Promise<string> => {
        if (prompt.toLowerCase().includes('name')) {
          const result = uppercase ? name.toUpperCase() : name
          return result
        } else if (prompt.toLowerCase().includes('description')) {
          const result = uppercase ? description.toUpperCase() : description
          return result
        }
        return value
      }
      
      // 2. Override guessParentByType - THIS IS THE KEY METHOD that prevents package popup
      creator['guessParentByType'] = (hierarchy: any[], type: string): string => {
        if (type === 'DEVC/K') { // PACKAGE type - this is what prevents the "Select package" dialog
          return packageName
        }
        // For other types, use original logic
        const original = hierarchy.filter((n: any) => n.object?.type === type)?.[0]?.object?.name || ""
        return original
      }
      
      // 3. Override guessOrSelectObjectType to return the specified object type
      creator['guessOrSelectObjectType'] = async (hierarchy: any[]): Promise<any> => {
        const CreatableTypes = await import('abap-adt-api').then(m => m.CreatableTypes)
        const objType = CreatableTypes.get(objectType)
        if (objType) {
          return { typeId: objectType, label: objType.label, maxLen: objType.maxLen }
        }
        throw new Error(`Unknown object type: ${objectType}`)
      }
      
      // 4. Let ADT handle transport selection naturally - just call createObject
      const obj = await creator.createObject(undefined)
      
      if (!obj) {
        log(`❌ Object creation was cancelled or failed`)
        return {
          success: false,
          error: "CREATION_CANCELLED",
          message: "Object creation was cancelled or failed",
          objectName: name,
          objectType: objectType
        }
      }

      // 🔧 FIX: Follow the same pattern as manual creation (like AbapFsCommands.create)
      await obj.loadStructure()

      if (obj.type === PACKAGE) {
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return {
          success: true,
          object: obj,
          objectName: obj.name,
          objectType: obj.type,
          path: obj.path
        }
      }

      // 🔧 FIX: Use the same flow as manual creation - no artificial delays
      const nodePath = await openObject(connId, obj.path)
      if (nodePath) {
        new AdtObjectFinder(connId).displayNode(nodePath)
        try {
          await commands.executeCommand(
            "workbench.files.action.refreshFilesExplorer"
          )
        } catch (e) {
          //log("error refreshing workspace")
        }
      }
      
      return {
        success: true,
        object: obj,
        objectName: obj.name,
        objectType: obj.type,
        path: obj.path,
        nodePath: nodePath
      }
    } catch (e) {
      const stack = types.isNativeError(e) ? e.stack || "" : ""
      const errorMessage = caughtToString(e)
      
      
      // ⚡ PROGRAMMATIC API: Return structured error result, don't show UI popups
      // This is used by AI systems that need to handle the response programmatically
      if (errorMessage.includes("already exists")) {
        return {
          success: false,
          error: "OBJECT_ALREADY_EXISTS",
          message: errorMessage,
          objectName: name,
          objectType: objectType
        }
      }
      
      // For other errors, return structured error response
      return {
        success: false,
        error: "CREATION_FAILED",
        message: errorMessage,
        objectName: name,
        objectType: objectType,
        stack: stack
      }
    }
  }

  @command(AbapFsCommands.showObject)
  private static async showObject(arg: ShowObjectArgument) {
    const p = splitAdtUri(arg.uri)
    const path = await vsCodeUri(arg.connId, arg.uri, true, true)
    const uri = Uri.parse(path)
    const doc = await workspace.openTextDocument(uri)
    const selection = p.start?.line ? lineRange(p.start?.line + 1) : undefined
    window.showTextDocument(doc, { selection })
  }
  @command(AbapFsCommands.runInGui)
  private static async executeAbap() {
    try {
      const uri = currentUri()
      if (!uri) return
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      logTelemetry("command_sap_gui_desktop_called", { connectionId: fsRoot.uri.authority })
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file) || !file.object.sapGuiUri) return
      
      // 🎯 FORCE native SAP GUI by bypassing runInSapGui routing
      const config = RemoteManager.get().byId(fsRoot.uri.authority)
      if (!config) {
        window.showErrorMessage('Connection configuration not found')
        return
      }
      
      // Create SapGui instance and call startGui directly (no routing check)
      const { SapGui } = await import('../adt/sapgui/sapgui')
      const sapGui = SapGui.create(config)
      const client = getClient(fsRoot.uri.authority)
      
      const { SapGuiPanel } = await import('../views/sapgui/SapGuiPanel')
      const transactionInfo = SapGuiPanel.getTransactionInfo(file.object.type, file.object.name)
      
      // For non-standard types, fall back to URI-based approach
      let cmd = transactionInfo.sapGuiCommand
      if (file.object.type !== 'PROG/P' && file.object.type !== 'FUGR/FF' && file.object.type !== 'CLAS/OC') {
        cmd = {
          type: "Transaction" as const,
          command: "*SADT_START_WB_URI",
          parameters: [
            { name: "D_OBJECT_URI", value: file.object.sapGuiUri },
            { name: "DYNP_OKCODE", value: "OKAY" }
          ]
        }
      }
      
      // Get ticket and call native SAP GUI directly (bypasses routing)
      const ticket = await client.reentranceTicket()
      await sapGui.startGui(cmd, ticket)

    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  /**
   * Execute ABAP object in embedded SAP GUI within VS Code
   * This provides Eclipse ADT-like functionality where execution happens in a webview
   */
  @command("abapfs.runInEmbeddedGui")
  private static async executeAbapEmbedded() {
    try {
      const uri = currentUri()
      if (!uri) {
        window.showErrorMessage("No ABAP file is currently open")
        return
      }
      
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) {
        return
      }
      logTelemetry("command_sap_gui_embedded_called", { connectionId: fsRoot.uri.authority })
      
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file)) {
        window.showErrorMessage("Current file is not an ABAP object")
        return
      }
      

      // Import the SAP GUI Panel and authentication utilities
      let SapGuiPanel, runInSapGui
      try {
        const sapGuiPanelModule = await import('../views/sapgui/SapGuiPanel')
        SapGuiPanel = sapGuiPanelModule.SapGuiPanel
        
        const sapGuiModule = await import('../adt/sapgui/sapgui')
        runInSapGui = sapGuiModule.runInSapGui
      } catch (importError) {
        throw importError
      }
      
      
      // Get the remote configuration for authentication
      const config = RemoteManager.get().byId(fsRoot.uri.authority)
      if (!config) {
        window.showErrorMessage(`Connection configuration not found for ${fsRoot.uri.authority}`)
        return
      }
      
      // Check if embedded GUI is configured
      if (config.sapGui?.guiType !== 'WEBGUI_UNSAFE_EMBEDDED') {
        await runInSapGui(fsRoot.uri.authority, () => ({
          type: "Transaction" as const,
          command: "*SE38",
          parameters: [
            { name: "RS38M-PROGRAMM", value: file.object.name },
            { name: "DYNP_OKCODE", value: "STRT" }
          ]
        }))
        return
      }
      
      
      // Get extension URI more reliably
      let extensionUri: Uri
      try {
        const extension = extensions.getExtension('murbani.vscode-abap-remote-fs')
        if (extension) {
          extensionUri = extension.extensionUri
        } else {
          // Fallback: try alternative extension ID
          const altExtension = extensions.getExtension('abap-copilot')
          if (altExtension) {
            extensionUri = altExtension.extensionUri
          } else {
            extensionUri = Uri.file(__dirname)
          }
        }
      } catch (error) {
        extensionUri = Uri.file(__dirname)
      }
      
      // Create the panel first
      const panel = SapGuiPanel.createOrShow(
        extensionUri,
        getClient(fsRoot.uri.authority),
        fsRoot.uri.authority,
        file.object.name,
        file.object.type
      )
      
      // Build target URL using simple WebGUI format (no SSO ticket needed)
      let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '') // Remove ADT path, keep base
      
      // Ensure HTTPS is used (fix certificate issues for hover etc.)
      if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
        baseUrl = 'https://' + baseUrl
      } else if (baseUrl.startsWith('http://')) {
        baseUrl = baseUrl.replace('http://', 'https://')
      }
      
      
      // 🎯 USE CENTRALIZED transaction mapping - NO MORE DUPLICATION! 🎉
      const transactionInfo = SapGuiPanel.getTransactionInfo(file.object.type, file.object.name)
      
      
      // Use the cleaned object name from transaction info (removes .main suffix for classes)
      const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
      
      // Use the dynamic WebGUI URL format with correct transaction
      const webguiUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
        `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || 'EN'}` +
        `&saml2=disabled`
      
      
      // Load the direct URL in the WebView panel (authentication will be handled by cookies)
      panel.loadDirectWebGuiUrl(webguiUrl)

    } catch (e) {
      //log(`Error in executeAbapEmbedded: ${caughtToString(e)}`)
      return window.showErrorMessage(`Failed to open embedded GUI: ${caughtToString(e)}`)
    }
  }

  /**
   * Run SAP Transaction Code
   * Allows users to search for and execute any SAP transaction
   */
  @command(AbapFsCommands.runTransaction)
  private static async runTransaction() {
    try {
      // 1. Select system
      const fsRoot = await pickAdtRoot()
      if (!fsRoot) return
      
      const connectionId = fsRoot.uri.authority
      const config = RemoteManager.get().byId(connectionId)
      if (!config) {
        window.showErrorMessage('Connection configuration not found')
        return
      }
      
      const client = getClient(connectionId)
      
      // 2. Search for transaction code with QuickPick that allows Enter
      const quickPick = window.createQuickPick()
      quickPick.placeholder = 'Type transaction code (e.g., MM43, SE16N) and press Enter, or search for transactions...'
      quickPick.matchOnDescription = true
      quickPick.matchOnDetail = true
      quickPick.ignoreFocusOut = true
      
      let currentInput = ''
      
      // Function to perform search using ADT client
      const performSearch = async (searchTerm: string) => {
        if (!searchTerm || searchTerm.length < 3) {
          quickPick.items = []
          return
        }
        
        quickPick.busy = true
        try {
          const query = searchTerm.toUpperCase() + "*"
          const raw = await client.searchObject(query, "TRAN/T")
          
          // Import MySearchResult to format results properly
          const { MySearchResult } = await import('../adt/operations/AdtObjectFinder')
          const results = await MySearchResult.createResults(raw, client)
          
          quickPick.items = results.map(r => ({
            label: `$(symbol-event) ${r.name}`,
            description: r.description || '',
            detail: `Package: ${r.packageName}`,
            tcode: r.name
          }))
        } catch (error) {
          quickPick.items = []
        } finally {
          quickPick.busy = false
        }
      }
      
      // Handle input changes
      quickPick.onDidChangeValue(async (value) => {
        currentInput = value
        if (value.length >= 3) {
          await performSearch(value)
        } else {
          quickPick.items = []
        }
      })
      
      // Handle selection
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0]
        let tcodeToRun = ''
        
        if (selected) {
          // User selected from list
          tcodeToRun = (selected as any).tcode
        } else if (currentInput) {
          // User pressed Enter without selecting - use typed value
          tcodeToRun = currentInput.toUpperCase()
        }
        
        quickPick.hide()
        
        if (!tcodeToRun) return
        
        logTelemetry("command_run_transaction_called", { connectionId })
        
        // 3. Execute transaction based on guiType preference
        const guiType = config.sapGui?.guiType || 'SAPGUI'
        
        switch (guiType) {
          case 'WEBGUI_UNSAFE_EMBEDDED':
            // Embedded webview
            await AdtCommands.launchTransactionInEmbeddedGui(config, client, tcodeToRun)
            break
            
          case 'WEBGUI_UNSAFE':
          case 'WEBGUI_CONTROLLED':
            // External browser
            await AdtCommands.launchTransactionInBrowser(config, client, tcodeToRun)
            break
            
          case 'SAPGUI':
          default:
            // Native SAP GUI
            await AdtCommands.launchTransactionInNativeGui(config, client, tcodeToRun)
            break
        }
      })
      
      quickPick.onDidHide(() => quickPick.dispose())
      quickPick.show()
      
    } catch (e) {
      return window.showErrorMessage(`Failed to run transaction: ${caughtToString(e)}`)
    }
  }
  
  /**
   * Launch transaction in embedded webview
   */
  private static async launchTransactionInEmbeddedGui(config: any, client: any, tcode: string) {
    try {
      // Build base URL
      let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '')
      
      // Ensure HTTPS
      if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
        baseUrl = 'https://' + baseUrl
      } else if (baseUrl.startsWith('http://')) {
        baseUrl = baseUrl.replace('http://', 'https://')
      }
      
      // Direct WebGUI URL for transaction (no SSO, user will login manually)
      const webguiUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
        `%7etransaction=%2a${tcode}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || 'EN'}` +
        `&saml2=disabled`
      
      const { SapGuiPanel } = await import('../views/sapgui/SapGuiPanel')
      
      let extensionUri: vscode.Uri
      try {
        const extension = vscode.extensions.getExtension('murbani.vscode-abap-remote-fs')
        extensionUri = extension?.extensionUri || vscode.extensions.getExtension('abap-copilot')?.extensionUri || vscode.Uri.file(__dirname)
      } catch {
        extensionUri = vscode.Uri.file(__dirname)
      }
      
      const panel = SapGuiPanel.createOrShow(
        extensionUri,
        client,
        config.name || 'SAP',
        tcode,
        'TRAN'
      )
      
      panel.loadDirectWebGuiUrl(webguiUrl)
    } catch (error) {
      window.showErrorMessage(`Failed to open transaction in embedded GUI: ${caughtToString(error)}`)
    }
  }
  
  /**
   * Launch transaction in external browser
   */
  private static async launchTransactionInBrowser(config: any, client: any, tcode: string) {
    try {
      const ticket = await client.reentranceTicket()
      
      const baseUrl = config.sapGui?.server ? 
        `${config.url.startsWith('https') ? 'https' : 'https'}://${config.sapGui.server}` : 
        config.url
      
      const tcodeUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?~transaction=*${tcode}&sap-client=${config.client}&sap-language=${config.language || 'EN'}&saml2=disabled`
      
      const authenticatedUrl = Uri.parse(baseUrl).with({ 
        path: `/sap/public/myssocntl`,
        query: `sap-mysapsso=${config.client}${ticket}&sap-mysapred=${encodeURIComponent(tcodeUrl)}`
      })
      
      commands.executeCommand('vscode.open', authenticatedUrl)
    } catch (error) {
      window.showErrorMessage(`Failed to open transaction in browser: ${caughtToString(error)}`)
    }
  }
  
  /**
   * Launch transaction in native SAP GUI
   */
  private static async launchTransactionInNativeGui(config: any, client: any, tcode: string) {
    try {
      const { SapGui } = await import('../adt/sapgui/sapgui')
      const sapGui = SapGui.create(config)
      
      const cmd = {
        type: "Transaction" as const,
        command: `*${tcode}`,
        parameters: []
      }
      
      const ticket = await client.reentranceTicket()
      await sapGui.startGui(cmd, ticket)
    } catch (error) {
      window.showErrorMessage(`Failed to open transaction in SAP GUI: ${caughtToString(error)}`)
    }
  }

  @command(AbapFsCommands.execute)
  private static async openInGuiAbap() {
    try {
      const uri = currentUri()
      if (!uri) return
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      logTelemetry("command_sap_gui_browser_called", { connectionId: fsRoot.uri.authority })
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file) || !file.object.sapGuiUri) return
      
      // 🎯 FORCE browser opening by bypassing runInSapGui routing
      const config = RemoteManager.get().byId(fsRoot.uri.authority)
      if (!config) {
        window.showErrorMessage('Connection configuration not found')
        return
      }
      
      // Build direct WebGUI URL with authentication
      let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '')
      
      // Ensure HTTPS
      if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
        baseUrl = 'https://' + baseUrl
      } else if (baseUrl.startsWith('http://')) {
        baseUrl = baseUrl.replace('http://', 'https://')
      }
      
      // 🎯 USE CENTRALIZED transaction mapping - NO MORE DUPLICATION! 🎉
      const { SapGuiPanel } = await import('../views/sapgui/SapGuiPanel')
      const transactionInfo = SapGuiPanel.getTransactionInfo(file.object.type, file.object.name)
      
      // Build simple WebGUI URL (same format as WebView uses)
      const browserUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
        `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${file.object.name}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || 'EN'}` +
        `&saml2=disabled`
      
      
      // Open in external browser - user will authenticate themselves
      commands.executeCommand('vscode.open', Uri.parse(browserUrl))

    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.addfavourite)
  private static addFavourite(uri: Uri | undefined) {
    // find the adt relevant namespace roots, and let the user pick one if needed
    if (uri) FavouritesProvider.get().addFavourite(uri)
  }

  @command(AbapFsCommands.deletefavourite)
  private static deleteFavourite(node: FavItem) {
    FavouritesProvider.get().deleteFavourite(node)
  }

  @command(AbapFsCommands.tableContents)
  private static showTableContents() {
    const file = currentAbapFile()
    const uri = currentUri()
    logTelemetry("command_show_table_contents_called", { connectionId: uri?.authority })
    if (!file) {
      window.showInformationMessage("Unable to determine the table to display")
      return
    }
    commands.executeCommand(AbapFsCommands.selectDB, file.object.name)
  }

  @command(AbapFsCommands.unittest)
  private static async runAbapUnit(targetUri?: Uri) {
    try {
      // Use provided URI (from language model tool) or current active editor
      const uri = targetUri || currentUri()
      if (!uri) {
        window.showErrorMessage("No ABAP file specified. Please open an ABAP file or provide object details.")
        return
      }

      await window.withProgress(
        { location: ProgressLocation.Notification, title: "Running ABAP UNIT" },
        () => UnitTestRunner.get(uri.authority).addResults(uri)
      )
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.atcChecks)
  private static async runAtc() {
    try {
      const state = await currentEditState()
      if (!state) return

      await window.withProgress(
        { location: ProgressLocation.Notification, title: "Running ABAP Test cockpit" },
        () => atcProvider.runInspector(state.uri)
      )
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.createtestinclude)
  private static createTestInclude(uri?: Uri) {
    if (uri) {
      if (uri.scheme !== ADTSCHEME) return
      return this.createTI(uri)
    }
    const cur = currentEditState()
    if (!cur) return
    return this.createTI(cur.uri)
  }

  @command(AbapFsCommands.clearPassword)
  public static async clearPasswordCmd(connectionId?: string) {
    return RemoteManager.get().clearPasswordCmd(connectionId)
  }

  private static async createTI(uri: Uri) {
    logTelemetry("command_create_test_class_include_called", { connectionId: uri.authority })
    return window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Creating test include...",
        cancellable: false
      },
      async (progress) => {
        try {
          progress.report({ message: "Validating class..." })
          
          const obj = await findAbapObject(uri)
          // only makes sense for classes
          if (!isAbapClassInclude(obj)) {
            throw new Error("This command only works with ABAP class files")
          }
          if (!obj.parent) {
            throw new Error("Class parent not found")
          }
          if (!obj.parent.structure) await obj.parent.loadStructure()
          if (obj.parent.findInclude("testclasses")) {
            window.showInformationMessage("Test include already exists")
            return // This will properly close the progress window
          }

          progress.report({ message: "Acquiring lock..." })
          const m = uriRoot(uri).lockManager
          const lock = await m.requestLock(uri.path)
          const lockId = lock.status === "locked" && lock.LOCK_HANDLE
          if (!lockId) {
            throw new Error(`Can't acquire a lock for ${obj.name}`)
          }
          
          try {
            let created
            const client = getClient(uri.authority)

            progress.report({ message: "Selecting transport..." })
            const transport = await selectTransport(
              obj.contentsPath(),
              "",
              client,
              true
            )
            if (transport.cancelled) return
            
            progress.report({ message: "Creating test include on SAP..." })
            const parentName = obj.parent.name
            await client.createTestInclude(parentName, lockId, transport.transport)
            created = true

            progress.report({ message: "Releasing lock..." })
            if (lock) await m.requestUnlock(uri.path)
            
            if (created) {
              progress.report({ message: "Refreshing structure..." })
              // Force fresh reload by invalidating cache first
              const root = uriRoot(uri)
              root.service.invalidateStructCache(obj.parent.path)
              await obj.parent.loadStructure() // Fetch fresh structure from SAP
              
              progress.report({ message: "Opening test include..." })
              // Find the newly created test include
              const testInclude = obj.parent.findInclude("testclasses")
              if (testInclude) {
                // Get the test include URI from the structure
                const testIncludeUri = testInclude["abapsource:sourceUri"] || "includes/testclasses"
                const fullTestPath = `${obj.parent.path}/${testIncludeUri}`
                
                try {
                  // Open the test include (like create object command)
                  const nodePath = await openObject(uri.authority, fullTestPath)
                  if (nodePath) {
                    // Display the node (like create object command)
                    new AdtObjectFinder(uri.authority).displayNode(nodePath)
                  }
                } catch (openError) {
                  // Fallback to manual refresh if opening fails
                }
              }
              
              progress.report({ message: "Refreshing file explorer..." })
              // Refresh file explorer
              await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
            }
          } catch (e) {
            if (lock) await m.requestUnlock(uri.path)
            throw e
          }
        } catch (e) {
          const errorMsg = caughtToString(e)
          window.showErrorMessage(`Error creating test include: ${errorMsg}`)
        }
      }
    )
  }

  /**
   * Refresh SAP System Info Cache
   * Clears the cached system information so next request fetches fresh data
   */
  @command(AbapFsCommands.refreshSystemInfoCache)
  private static async refreshSystemInfoCache() {
    try {
      const { clearSystemInfoCache } = await import('../services/sapSystemInfo')
      clearSystemInfoCache()
      window.showInformationMessage('SAP system info cache cleared. Next request will fetch fresh data.')
    } catch (e) {
      window.showErrorMessage(`Failed to clear cache: ${caughtToString(e)}`)
    }
  }
}
