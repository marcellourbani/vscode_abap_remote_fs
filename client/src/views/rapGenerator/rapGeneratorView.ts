import {
  CancellationToken,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
  commands
} from "vscode"
import * as path from "path"
import * as fs from "fs"
import { context } from "../../extension"
import { getOrCreateClient, ADTSCHEME } from "../../adt/conections"
import { connectedRoots } from "../../config"
import {
  rapGenIsAvailable,
  rapGenGetContent,
  rapGenValidateInitial,
  rapGenValidateContent,
  rapGenPreview,
  rapGenGenerate,
  rapGenPublishService
} from "../../adt/rapGenerator"
import type { RapGeneratorContent, RapGeneratorId } from "../../adt/rapGenerator"
import { selectTransport } from "../../adt/AdtTransports"
import { AbapFsCommands, command, openObject } from "../../commands"
import { caughtToString } from "../../lib"
import { AdtObjectFinder, uriAbapFile } from "../../adt/operations/AdtObjectFinder"

export class RapGeneratorPanel implements WebviewViewProvider {
  public static readonly viewType = "abapfs.rapGenerator"
  private static instance: RapGeneratorPanel | undefined
  private view: WebviewView | undefined

  public static get() {
    if (!RapGeneratorPanel.instance) RapGeneratorPanel.instance = new RapGeneratorPanel()
    return RapGeneratorPanel.instance
  }

  /** Pre-populate the panel with a table name from an editor context menu */
  public prefill(connId: string, tableName: string) {
    this.view?.webview.postMessage({ type: "prefill", connId, tableName })
  }

  async resolveWebviewView(
    panel: WebviewView,
    _ctx: WebviewViewResolveContext<unknown>,
    _token: CancellationToken
  ) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [] }

    const htmlPath = path.join(context.extensionPath, "client", "dist", "media", "rapGenerator.html")
    try {
      panel.webview.html = fs.readFileSync(htmlPath, "utf8")
    } catch (err) {
      const msg = caughtToString(err)
      panel.webview.html = `<html><body><p>Failed to load RAP Generator panel: ${msg}</p></body></html>`
      return
    }

    panel.webview.onDidReceiveMessage(async msg => {
      try {
        await this.handleMessage(msg)
      } catch (e: any) {
        this.post({ type: "error", text: caughtToString(e) })
      }
    })
    panel.onDidDispose(() => { this.view = undefined })
    // Assign after setup so prefill() can safely post
    this.view = panel
  }

  private post(msg: any) {
    this.view?.webview.postMessage(msg)
  }

  private async handleMessage(msg: any) {
    switch (msg.command) {
      case "ready":
        this.sendSystems()
        break
      case "loadDefaults":
        await this.loadDefaults(msg.connId, msg.tableName, msg.packageName, msg.generatorId)
        break
      case "validate":
        await this.validateContent(msg.connId, msg.tableName, msg.content, msg.generatorId)
        break
      case "preview":
        await this.previewContent(msg.connId, msg.tableName, msg.content, msg.generatorId)
        break
      case "generate":
        await this.generate(msg.connId, msg.tableName, msg.content, msg.generatorId)
        break
      case "openObject":
        if (msg.connId && msg.uri) {
          await openObject(msg.connId, msg.uri)
        }
        break
      case "publish":
        await this.publishService(msg.connId, msg.srvbName)
        break
    }
  }

  private sendSystems() {
    const systems = [...connectedRoots().keys()]
    this.post({ type: "systems", systems })
  }

  private tableUri(name: string): string {
    return `/sap/bc/adt/ddic/tables/${name.toLowerCase()}`
  }

  private async loadDefaults(connId: string, tableName: string, packageName: string, genId: RapGeneratorId) {
    try {
      const client = await getOrCreateClient(connId)

      // Check availability first
      const available = await rapGenIsAvailable(client, genId)
      if (!available) {
        this.post({ type: "error", text: "RAP Generator is not available on this system." })
        return
      }

      // Initial validation
      const tableUri = this.tableUri(tableName)
      const validation = await rapGenValidateInitial(client, genId, tableUri, packageName)
      if (validation.severity === "error") {
        const msg = validation.longText
          ? `${validation.shortText}\n\n${validation.longText}`
          : (validation.shortText || "Validation failed")
        this.post({ type: "error", text: msg })
        return
      }

      // Get default content
      const content = await rapGenGetContent(client, genId, tableUri, packageName)
      this.post({ type: "defaults", content })
    } catch (e: any) {
      this.post({ type: "error", text: caughtToString(e) })
    }
  }

  private async validateContent(connId: string, tableName: string, content: RapGeneratorContent, genId: RapGeneratorId) {
    try {
      const client = await getOrCreateClient(connId)
      const result = await rapGenValidateContent(client, genId, this.tableUri(tableName), content)
      this.post({ type: "validation", result })
    } catch (e: any) {
      this.post({ type: "validation", result: { severity: "error", shortText: caughtToString(e) } })
    }
  }

  private async previewContent(connId: string, tableName: string, content: RapGeneratorContent, genId: RapGeneratorId) {
    try {
      const client = await getOrCreateClient(connId)
      const objects = await rapGenPreview(client, genId, this.tableUri(tableName), content)
      this.post({ type: "preview", objects })
    } catch (e: any) {
      this.post({ type: "error", text: caughtToString(e) })
    }
  }

  private async generate(connId: string, tableName: string, content: RapGeneratorContent, genId: RapGeneratorId) {
    try {
      const client = await getOrCreateClient(connId)

      // Validate content first (like Eclipse does)
      const validation = await rapGenValidateContent(client, genId, this.tableUri(tableName), content)
      if (validation.severity === "error") {
        const msg = validation.longText
          ? `${validation.shortText}\n\n${validation.longText}`
          : (validation.shortText || "Validation failed")
        this.post({ type: "error", text: msg })
        return
      }

      // Get full object list via preview before generating
      const previewObjects = await rapGenPreview(client, genId, this.tableUri(tableName), content)

      const needsTransport = content.metadata?.package !== "$TMP"

      let transport = ""
      if (needsTransport) {
        const tableUri = this.tableUri(tableName)
        const result = await selectTransport(tableUri, content.metadata?.package || "", client, true)
        if (result.cancelled) {
          this.post({ type: "cancelled" })
          return
        }
        transport = result.transport
      }

      await rapGenGenerate(client, genId, this.tableUri(tableName), transport, content)

      // Use the preview list (which has all objects) for the generated view
      // Mark them as CREATED instead of CREATE
      const objects = previewObjects.map(o => ({ ...o, description: "CREATED" }))
      this.post({ type: "generated", objects, srvbName: content.businessService?.serviceBinding?.name })

      // Open the service binding from the preview URIs
      const srvb = previewObjects.find(o => o.type?.includes("SRVB"))
      if (srvb?.uri) {
        try {
          await openObject(connId, srvb.uri)
        } catch { /* non-critical — objects are already created */ }
      }

      window.showInformationMessage(`RAP service generated successfully (${objects.length} objects created)`)
    } catch (e: any) {
      // Extract detailed error info from ADT HTTP exceptions
      const responseBody = e?.response?.body || e?.response?.data || ""
      const detail = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)
      const mainMsg = caughtToString(e)
      const fullMsg = detail && !mainMsg.includes(detail) ? `${mainMsg}\n\n${detail}` : mainMsg
      this.post({ type: "error", text: fullMsg })
    }
  }

  private async publishService(connId: string, srvbName: string) {
    try {
      const client = await getOrCreateClient(connId)
      const result = await rapGenPublishService(client, srvbName)
      if (result.severity === "error") {
        const msg = result.longText
          ? `${result.shortText}\n\n${result.longText}`
          : (result.shortText || "Publish failed")
        this.post({ type: "error", text: msg })
      } else {
        this.post({ type: "published" })
        window.showInformationMessage(`Service binding ${srvbName} published successfully`)
      }
    } catch (e: any) {
      this.post({ type: "error", text: caughtToString(e) })
    }
  }

  // ── Commands ────────────────────────────────────────────────────────

  @command(AbapFsCommands.rapGenFromEditor)
  private static async fromEditor() {
    const editor = window.activeTextEditor
    if (!editor) return
    const uri = editor.document.uri
    if (uri.scheme !== ADTSCHEME) return

    const abapFile = uriAbapFile(uri)
    if (!abapFile?.object || abapFile.object.type !== "TABL/DT") return

    const connId = uri.authority
    const tableName = abapFile.object.name

    await commands.executeCommand("abapfs.rapGenerator.focus")
    // Wait for the webview to be resolved
    const panel = RapGeneratorPanel.get()
    for (let i = 0; i < 20 && !panel.view; i++) {
      await new Promise(r => setTimeout(r, 50))
    }
    if (!panel.view) {
      window.showErrorMessage("RAP Generator panel failed to initialize")
      return
    }
    panel.prefill(connId, tableName)
  }
}
