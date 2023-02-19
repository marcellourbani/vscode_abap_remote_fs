import { RemoteConfig, RemoteManager } from "../../config"
import { file } from "tmp-promise"
import { writeAsync } from "fs-jetpack"
import { log } from "../../lib"
import { closeSync } from "fs"
import opn = require("open")
import { window, ProgressLocation, extensions } from "vscode"
import { getClient } from "../conections"
import { AbapObject, isAbapClassInclude } from "abapobject"
import puppeteer from "puppeteer-core"
import {
  commands,
  Uri
} from "vscode"
import { ADTClient } from "abap-adt-api"

const BROWSERPREVIEW = "auchenberg.vscode-browser-preview"

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

export function runInSapGui(
  connId: string,
  getCmd: () => Promise<SapGuiCommand | undefined> | SapGuiCommand | undefined
) {
  return window.withProgress(
    { location: ProgressLocation.Window, title: "Opening SAPGui..." },
    async () => {
      const config = RemoteManager.get().byId(connId)
      if (!config) return
      const sapGui = SapGui.create(config)

      const cmd = await getCmd()
      if (cmd) {
        const client = getClient(connId)
        switch (config.sapGui?.guiType) {
          case "WEBGUI_UNSAFE_EMBEDDED":
          case "WEBGUI_UNSAFE":
          case "WEBGUI_CONTROLLED":
            return sapGui.runInBrowser(config, cmd, client)
          default:
            if (cmd) {
              log("Running " + JSON.stringify(cmd))
              sapGui.checkConfig()
              const ticket = await client.reentranceTicket()
              return sapGui.startGui(cmd, ticket)
            }
        }
      }
    })
}

export function executeInGui(connId: string, object: AbapObject) {
  if (isAbapClassInclude(object) && object.parent) object = object.parent
  return runInSapGui(connId, () => {
    const { type, name } = object
    let transaction = ''
    let dynprofield = ''
    let okcode = ''
    switch (type) {
      case 'PROG/P':
        transaction = 'SE38'
        dynprofield = 'RS38M-PROGRAMM'
        okcode = 'STRT'
        break
      case 'FUGR/FF':
        transaction = 'SE37'
        dynprofield = 'RS38L-NAME'
        okcode = 'WB_EXEC'
        break
      case 'CLAS/OC':
        transaction = 'SE24'
        dynprofield = 'SEOCLASS-CLSNAME'
        okcode = 'WB_EXEC'
        break
      default:
        return showInGuiCb(object.sapGuiUri)()
        break
    }
    return {
      type: "Transaction",
      command: `*${transaction}`,
      parameters: [
        { name: dynprofield, value: name },
        { name: "DYNP_OKCODE", value: okcode }
      ]
    }
  })
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

        return new SapGui(
          gui.disabled,
          guiconf,
          config.username,
          config.name,
          config.language
        )
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

        return new SapGui(
          !!gui?.disabled,
          guiconf,
          config.username,
          config.name,
          config.language
        )
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
    if (this.disabled || !this.config)
      throw new Error("SAPGUI was not configured or disabled")
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
    if (guitype === "WEBGUI_UNSAFE_EMBEDDED") {
      const ext = extensions.getExtension<unknown>(BROWSERPREVIEW)
      if (!ext) {
        guitype = "WEBGUI_CONTROLLED"
        const args = encodeURIComponent(JSON.stringify([[BROWSERPREVIEW]]))
        const exturl = Uri.parse(`command:workbench.extensions.action.showExtensionsWithIds?${args}`)
        window.showInformationMessage(`Embedded browser requires [Browser preview extension](${exturl})<br>showing in browser`)
      }
    }
    if (cmd.parameters) {
      const okCode = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name === 'DYNP_OKCODE')
      const D_OBJECT_URI = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name !== 'DYNP_OKCODE')
      const q: any = {
        "~transaction": `${cmd.command} ${D_OBJECT_URI?.name}=${D_OBJECT_URI!.value};DYNP_OKCODE=${okCode?.value || ""}`,
      }
      if (config.language) config.language = config.language
      if (guitype !== "WEBGUI_CONTROLLED") {
        q["sap-user"] = config.username
        q["sap-password"] = config.password
      }
      const query = Object.keys(q).map(k => `${k}=${q[k]}`).join("&")
      const url = Uri.parse(config.url).with({ path: "/sap/bc/gui/sap/its/webgui", query })
      switch (guitype) {
        case "WEBGUI_UNSAFE_EMBEDDED":
          commands.executeCommand('browser-preview.openPreview', url.toString())
          break
        case "WEBGUI_UNSAFE":
          commands.executeCommand('vscode.open', url)
          break
        default:
          const ticket = await client.reentranceTicket()
          const browser = await puppeteer.launch({
            headless: false,
            executablePath: config.sapGui?.browserPath || "chrome",
            ignoreDefaultArgs: ["--enable-automation", "--enable-blink-features=IdleDetection"],
            ignoreHTTPSErrors: !!config.allowSelfSigned,
            // @ts-ignore
            defaultViewport: null,
            args: ['--start-maximized']
          })

          const page = (await browser.pages())[0] || await browser.newPage()
          await page.setExtraHTTPHeaders({ "sap-mysapsso": `${config.client}${ticket}`, "sap-mysapred": url.toString() })
          const logonUri = Uri.parse(config.url).with({ path: `/sap/public/myssocntl` }).toString()
          await page.goto(logonUri)
          // browser.disconnect()
          break
      }
    }
  }

  private commandString(command: SapGuiCommand) {
    let params = ""
    const addParm = (name: string, value: string) =>
      (params = `${params}${name} = ${value}; `)
    if (command.parameters)
      command.parameters.forEach(p => addParm(p.name, p.value))
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
