import { RemoteConfig, RemoteManager } from "../../config"
import { file } from "tmp-promise"
import { writeAsync } from "fs-jetpack"
import { log, caughtToString } from "../../lib"
import { closeSync } from "fs"
import opn = require("open")
import { ProgressLocation, extensions } from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { getClient, getOrCreateClient } from "../conections"
import { AbapObject, isAbapClassInclude, getObjectTypeConfig, getAllConfigs } from "abapobject"
import { commands, Uri, workspace } from "vscode"
import * as vscode from "vscode"
import { ADTClient } from "abap-adt-api"
import { SapGuiPanel } from "../../views/sapgui/SapGuiPanel"
import { startSsoFormLauncher, SsoLauncher, SsoLauncherOptions } from "./ssoLaunch"

export interface SapGuiCommand {
  type: "Transaction" | "Report" | "SystemCommand"
  command: string
  parameters?: { name: string; value: string }[]
  okCode?: string
}
interface ServerGuiConfig {
  server: string
  systemNumber: string
  client: string
  routerString: string
}

interface LoadBalancingGuiConfig {
  messageServer: string
  messageServerPort: string
  group: string
  client: string
  routerString: string
}
type guiConfig = ServerGuiConfig | LoadBalancingGuiConfig
function isLoadBalancing(config: guiConfig): config is LoadBalancingGuiConfig {
  return !!(config as LoadBalancingGuiConfig).messageServer
}

export function getGuiCommand(target: AbapObject | string | SapGuiCommand): SapGuiCommand {
  if (typeof target === "object" && "type" in target && "command" in target) {
    return target as SapGuiCommand
  }

  if (typeof target === "string") {
    if (target.startsWith("adt://") || target.includes("/sap/bc/adt/")) {
      return {
        type: "Transaction",
        command: "*SADT_START_WB_URI",
        parameters: [
          { name: "D_OBJECT_URI", value: target },
          { name: "DYNP_OKCODE", value: "OKAY" }
        ]
      }
    } else {
      return {
        type: "Transaction",
        command: `*${target}`,
        parameters: []
      }
    }
  }

  // target is AbapObject
  const objectType = target.type
  const objectName = target.name

  const config = getObjectTypeConfig(objectType)
  if (config?.transactionInfo) {
    const info = SapGuiPanel.getTransactionInfo(objectType, objectName)
    return info.sapGuiCommand
  }

  return {
    type: "Transaction",
    command: "*SADT_START_WB_URI",
    parameters: [
      { name: "D_OBJECT_URI", value: target.sapGuiUri },
      { name: "DYNP_OKCODE", value: "OKAY" }
    ]
  }
}

export function detectObjectType(command: string): string {
  const configs = getAllConfigs()
  for (const config of configs) {
    if (
      config.transactionInfo?.transaction &&
      command.includes(config.transactionInfo.transaction)
    ) {
      return config.type
    }
  }
  return "PROG/P"
}

export function getWebGuiUrl(config: RemoteConfig, cmd: SapGuiCommand): string {
  // Keep the configured scheme: the ADT URL may point at a system, gateway or proxy that
  // only speaks HTTP, and forcing HTTPS makes WebGUI unreachable for those.
  let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, "").replace(/\/$/, "")
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = "https://" + baseUrl

  let transactionPart = ""
  if (cmd.parameters && cmd.parameters.length > 0) {
    const okCode = cmd.parameters.find(p => p.name === "DYNP_OKCODE")?.value || ""
    const targetParam = cmd.parameters.find(p => p.name !== "DYNP_OKCODE")
    if (targetParam) {
      transactionPart = `${cmd.command} ${targetParam.name}=${targetParam.value};DYNP_OKCODE=${okCode}`
    } else {
      transactionPart = cmd.command
    }
  } else {
    transactionPart = cmd.command
  }

  const query = `~transaction=${encodeURIComponent(transactionPart)}&sap-client=${config.client}&sap-language=${config.language || "EN"}&saml2=disabled`
  return `${baseUrl}/sap/bc/gui/sap/its/webgui?${query}`
}

/**
 * Reentrance ticket for the ADT session, or undefined when the system can't mint one
 * (SSO2 tickets not enabled, ticket not trusted). Callers fall back to the logon screen.
 */
async function tryReentranceTicket(client: ADTClient): Promise<string | undefined> {
  try {
    return await client.reentranceTicket()
  } catch (error) {
    log("Failed to acquire reentrance ticket:", caughtToString(error))
    return undefined
  }
}

/**
 * URL that lands the browser on `webguiUrl` already authenticated, or `webguiUrl` itself
 * when auto-login is off or no ticket can be obtained — in which case the user sees the SAP
 * logon screen.
 */
async function authenticatedWebGuiUrl(
  config: RemoteConfig,
  client: ADTClient,
  webguiUrl: string
): Promise<string> {
  // The launcher shuts itself down once the browser fetches it; nothing to dispose here.
  return (await ssoLoginUrl(config, client, webguiUrl))?.url ?? webguiUrl
}

/**
 * Same as {@link authenticatedWebGuiUrl}, resolving the connection and ADT client from a
 * connection id — for callers that hold a WebGUI URL but no client. Never throws: a URL that
 * simply lands on the logon screen beats failing to open anything.
 */
export async function withAutoLogin(connId: string, webguiUrl: string): Promise<string> {
  try {
    const config = await RemoteManager.get().byIdAsync(connId)
    if (!config) return webguiUrl
    // Checked before acquiring a client: on an opted-out connection, connecting purely to
    // build a client we then discard can trigger a password prompt or an SSO round-trip.
    if (config.webGuiAutoLogin === false) return webguiUrl
    return await authenticatedWebGuiUrl(config, await getOrCreateClient(connId), webguiUrl)
  } catch (error) {
    log("Auto-login unavailable:", caughtToString(error))
    return webguiUrl
  }
}

/**
 * One-shot loopback URL that authenticates the browser, or undefined when auto-login is off,
 * no ticket can be minted, or the launcher can't start. Callers decide whether that means
 * "open the plain URL" or "skip the login step".
 */
export async function ssoLoginUrl(
  config: RemoteConfig,
  client: ADTClient,
  webguiUrl: string,
  opts?: SsoLauncherOptions
): Promise<SsoLauncher | undefined> {
  if (config.webGuiAutoLogin === false) return undefined

  const ticket = await tryReentranceTicket(client)
  if (!ticket) {
    log("No reentrance ticket available — SAP will show the logon screen.")
    return undefined
  }
  try {
    return await startSsoFormLauncher(webguiUrl, config.client, ticket, opts)
  } catch (error) {
    log("Failed to start the SSO launcher:", caughtToString(error))
    return undefined
  }
}

export async function openInGui(
  connId: string,
  target: AbapObject | string | SapGuiCommand,
  mode?: "SAPGUI" | "WEBGUI" | "EMBEDDED"
) {
  return window.withProgress(
    { location: ProgressLocation.Notification, title: "Opening SAP GUI..." },
    async () => {
      const config = RemoteManager.get().byId(connId)
      if (!config) return

      const cmd = getGuiCommand(target)
      const client = getClient(connId)

      // Determine the target mode based on argument or configuration preference
      let targetMode: "SAPGUI" | "WEBGUI" | "EMBEDDED" = mode || "SAPGUI"
      if (!mode) {
        const guiType = config.sapGui?.guiType || "SAPGUI"
        if (guiType === "WEBGUI_UNSAFE_EMBEDDED") {
          targetMode = "EMBEDDED"
        } else if (guiType === "WEBGUI_UNSAFE" || guiType === "WEBGUI_CONTROLLED") {
          targetMode = "WEBGUI"
        } else {
          targetMode = "SAPGUI"
        }
      }

      const sapGui = SapGui.create(config)

      if (targetMode === "EMBEDDED") {
        const webguiUrl = getWebGuiUrl(config, cmd)

        // Use VS Code simple browser if configured
        const useIntegratedBrowser = workspace
          .getConfiguration("abapfs.sapGui")
          .get<boolean>("useIntegratedBrowser", true)
        if (useIntegratedBrowser) {
          commands.executeCommand(
            "simpleBrowser.api.open",
            await authenticatedWebGuiUrl(config, client, webguiUrl),
            {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: false
            }
          )
          return
        }

        // Otherwise, open in webview panel
        let extensionUri: Uri
        try {
          const extension = extensions.getExtension("murbani.vscode-abap-remote-fs")
          extensionUri =
            extension?.extensionUri ||
            extensions.getExtension("abap-copilot")?.extensionUri ||
            Uri.file(__dirname)
        } catch {
          extensionUri = Uri.file(__dirname)
        }

        const D_OBJECT_URI = cmd.parameters?.find(p => p.name !== "DYNP_OKCODE")
        const objectParam = D_OBJECT_URI?.value || "SAP_GUI"
        const detectedObjectType = detectObjectType(cmd.command)

        const panel = SapGuiPanel.createOrShow(
          extensionUri,
          client,
          config.name || connId,
          objectParam,
          detectedObjectType
        )
        // The panel applies auto-login itself.
        await panel.loadDirectWebGuiUrl(webguiUrl)
        return
      }

      if (targetMode === "WEBGUI") {
        const webguiUrl = getWebGuiUrl(config, cmd)
        const targetUrl =
          config.sapGui?.guiType === "WEBGUI_CONTROLLED"
            ? await authenticatedWebGuiUrl(config, client, webguiUrl)
            : webguiUrl
        commands.executeCommand("vscode.open", Uri.parse(targetUrl))
        return
      }

      // Default: Native SAPGUI
      sapGui.checkConfig()
      const ticket = await client.reentranceTicket()
      return sapGui.startGui(cmd, ticket)
    }
  )
}

export function runInSapGui(
  connId: string,
  getCmd: () => Promise<SapGuiCommand | undefined> | SapGuiCommand | undefined
) {
  return window.withProgress(
    { location: ProgressLocation.Notification, title: "Opening SAP GUI..." },
    async () => {
      const cmd = await getCmd()
      if (cmd) {
        return openInGui(connId, cmd)
      }
    }
  )
}

export function executeInGui(connId: string, object: AbapObject) {
  if (isAbapClassInclude(object) && object.parent) object = object.parent
  return openInGui(connId, object)
}

export function showInGuiCb(uri: string) {
  return (): SapGuiCommand => ({
    type: "Transaction",
    command: "*SADT_START_WB_URI",
    parameters: [
      { name: "D_OBJECT_URI", value: uri },
      { name: "DYNP_OKCODE", value: "OKAY" }
    ]
  })
}
export class SapGui {
  public static create(config: RemoteConfig) {
    try {
      const gui = config.sapGui
      // are we connecting via load balancing? This requires all three parameters
      if (gui && gui.messageServer && gui.group) {
        const guiconf: LoadBalancingGuiConfig = {
          group: gui.group,
          messageServer: gui.messageServer,
          messageServerPort: gui.messageServerPort || "3600",
          routerString: gui.routerString || "",
          client: config.client
        }

        return new SapGui(!!gui.disabled, guiconf, config.username, config.name, config.language)
      } else {
        // use the config if found, try to guess if not
        const [server = "", port = ""] = (
          config.url.match(/https?:\/\/([^:]+):([0-9]+)/i) || ["", "", "8000"]
        ).splice(1)
        const systemID = port?.match(/\n\n$/) ? port?.slice(-2) : "00"
        const guiconf: ServerGuiConfig = {
          server: (gui && gui.server) || server,
          systemNumber: (gui && gui.systemNumber) || systemID,
          routerString: (gui && gui.routerString) || "",
          client: config.client
        }

        return new SapGui(!!gui?.disabled, guiconf, config.username, config.name, config.language)
      }
    } catch {
      return new SapGui(false)
    }
  }

  constructor(
    private disabled: boolean,
    private config?: guiConfig,
    private user?: string,
    private systemname?: string,
    private language?: string
  ) {
    if (!(config && config.client)) disabled = true
  }

  public get connectionString() {
    this.checkConfig()
    if (!this.config) return "" // hack to prevent TS errors
    const c = this.config
    const routerString = this.config.routerString.replace(/\/.\/$/, "")
    if (isLoadBalancing(c)) {
      return `${routerString}/M/${c.messageServer}/S/${c.messageServerPort}/G/${c.group}`
    } else {
      return `${routerString}/H/${c.server}/S/32${c.systemNumber}`
    }
  }

  public checkConfig() {
    if (this.disabled || !this.config) throw new Error("SAPGUI was not configured or disabled")
  }

  public async startGui(command: SapGuiCommand, ticket: string) {
    const content = this.createLauncherContent(command, ticket)
    const win32 = process.platform === "win32"
    const linux = process.platform === "linux"
    const shortcut = await file({
      postfix: ".sap",
      prefix: "abapfs_shortcut_",
      keep: win32
    })
    await writeAsync(shortcut.path, content)
    // windows won't open this if still open...
    if (win32) closeSync(shortcut.fd)
    try {
      // workaround for bug in opn trying to use /xdg-open...
      const options: any = {}
      if (linux) options.app = "xdg-open"

      await opn(shortcut.path, options)
      // delete after opening sapgui, only in windows
      if (win32) setTimeout(() => shortcut.cleanup(), 50000)
    } catch (e) {
      log("Error executing file", shortcut.path)
    }
  }

  public async runInBrowser(config: RemoteConfig, cmd: SapGuiCommand, client: ADTClient) {
    let guitype = config.sapGui?.guiType

    // WebView doesn't need Live Preview extension - remove the check
    if (cmd.parameters) {
      const okCode = cmd.parameters.find(
        (parameter: { name: string; value: string }) => parameter.name === "DYNP_OKCODE"
      )
      const D_OBJECT_URI = cmd.parameters.find(
        (parameter: { name: string; value: string }) => parameter.name !== "DYNP_OKCODE"
      )

      const q: any = {
        "~transaction": `${cmd.command} ${D_OBJECT_URI?.name}=${D_OBJECT_URI!.value};DYNP_OKCODE=${okCode?.value || ""}`
      }
      if (config.language) config.language = config.language
      q["saml2"] = "disabled"
      const query = Object.keys(q)
        .map(k => `${k}=${q[k]}`)
        .join("&")
      const url = Uri.parse(config.url).with({ path: "/sap/bc/gui/sap/its/webgui", query })

      switch (guitype) {
        case "WEBGUI_UNSAFE_EMBEDDED":
          // Use direct WebGUI URL (no SSO ticket - user will login manually in webview)
          const objectParam = D_OBJECT_URI?.value || "SAP_GUI"

          // Get extension context more reliably
          let extensionUri: vscode.Uri
          try {
            const extension = vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")
            if (extension) {
              extensionUri = extension.extensionUri
            } else {
              // Fallback: try alternative extension ID
              const altExtension = vscode.extensions.getExtension("abap-copilot")
              extensionUri = altExtension?.extensionUri || vscode.Uri.file(__dirname)
            }
          } catch (error) {
            extensionUri = vscode.Uri.file(__dirname)
          }

          const detectedObjectType = detectObjectType(cmd.command)

          const panel = SapGuiPanel.createOrShow(
            extensionUri,
            client,
            config.name || "SAP",
            objectParam,
            detectedObjectType
          )

          await panel.loadDirectWebGuiUrl(url.toString())
          break
        case "WEBGUI_UNSAFE":
          commands.executeCommand("vscode.open", url)
          break
        default:
          // For WEBGUI_CONTROLLED mode, fall back to opening in default browser
          let ticket2: string
          try {
            ticket2 = await client.reentranceTicket()
          } catch (error) {
            log("Failed to acquire reentrance ticket for controlled WebGUI:", caughtToString(error))
            window.showErrorMessage("Failed to acquire SAP reentrance ticket. Cannot open WebGUI.")
            return
          }

          const controlledBaseUrl = config.sapGui?.server
            ? `${config.url.startsWith("https") ? "https" : "https"}://${config.sapGui.server}`
            : config.url

          const authenticatedUrl2 = Uri.parse(controlledBaseUrl).with({
            path: `/sap/public/myssocntl`,
            query: `sap-mysapsso=${config.client}${ticket2}&sap-mysapred=${encodeURIComponent(url.toString())}`
          })

          // log('🌐 Opening SAP GUI in default browser: ' + authenticatedUrl2.toString())
          commands.executeCommand("vscode.open", authenticatedUrl2)
          break
      }
    }
  }

  private commandString(command: SapGuiCommand) {
    let params = ""
    const addParm = (name: string, value: string) => (params = `${params}${name} = ${value}; `)
    if (command.parameters) command.parameters.forEach(p => addParm(p.name, p.value))
    if (command.okCode) addParm("DYNP_OKCODE", command.okCode)
    return `${command.command} ${params} `
  }

  private createLauncherContent(command: SapGuiCommand, ticket: string) {
    this.checkConfig()
    const loginTicket = ticket ? `at="MYSAPSSO2=${ticket}"` : ""
    const lang = this.language ? `Language=${this.language}` : ""
    return `[System]
guiparm="${this.connectionString}"
Name=${this.systemname}
Client=${this.config!.client}
[User]
Name=${this.user}
${loginTicket}
${lang}
[Function]
Type=${command.type}
Command=${this.commandString(command)}
[Configuration]
GuiSize=Maximized
[Options]
Reuse=1`
  }
}
