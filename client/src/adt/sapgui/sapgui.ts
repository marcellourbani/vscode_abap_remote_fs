import { RemoteConfig, RemoteManager } from "../../config"
import { file } from "tmp-promise"
import { writeAsync } from "fs-jetpack"
import { log } from "../../lib"
import { closeSync } from "fs"
import opn = require("open")
import { window, ProgressLocation } from "vscode"
import { ADTClient } from "abap-adt-api"
import { getClient } from "../conections"
import {
  commands,
  Uri
} from "vscode"
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
        switch (config.sapGui?.useWebGui) {
          case "VSCODE":
            return sapGui.runInWebView(config, cmd)
            break;
          case "Browser":
            return sapGui.runInBrowser(config, cmd)
          default:
            const client = getClient(connId)
            if (cmd) {
              log("Running " + JSON.stringify(cmd))
              sapGui.checkConfig()
              const ticket = await client.reentranceTicket()
              return sapGui.startGui(cmd, ticket)

              break;
            }
        }
      }
    })
}

export function executeInGui(connId: string, name: string, type: string) {
  return runInSapGui(connId, () => {
    let transaction = '';
    let dynprofield = '';
    let okcode = '';
    switch (type) {
      case 'PROG/P':
        transaction = 'SE38'
        dynprofield = 'RS38M-PROGRAMM'
        okcode = 'STRT'
        break;
      case 'FUGR/FF':
        transaction = 'SE37'
        dynprofield = 'RS38L-NAME'
        okcode = 'WB_EXEC'
        break;
      case 'CLAS/I':
        transaction = 'SE24'
        dynprofield = 'SEOCLASS-CLSNAME'
        okcode = 'WB_EXEC'
        break;
      default:
        break;
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

export function showInGui(connId: string, uri: string) {
  return runInSapGui(connId, () => ({
    type: "Transaction",
    command: "*SADT_START_WB_URI",
    parameters: [
      { name: "D_OBJECT_URI", value: uri },
      { name: "DYNP_OKCODE", value: "OKAY" }
    ]
  }))
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
        const [server, port] = (
          config.url.match(/https?:\/\/([^:]+):([0-9]+)/i) || ["", "", "8000"]
        ).splice(1)
        const systemID = port.match(/\n\n$/) ? port.substr(-2) : "00"
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

  public async runInWebView(config: RemoteConfig, cmd: SapGuiCommand) {
    if (cmd.parameters) {
      const okCode = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name === 'DYNP_OKCODE')
      const D_OBJECT_URI = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name === 'D_OBJECT_URI')
      const url = (config.url.slice(-1) === '/') ? config.url : config.url + "/";
      commands.executeCommand('browser-preview.openPreview', `${url}sap/bc/gui/sap/its/webgui?sap-user=${config.username}&sap-password=${config.password}&language=EN&~transaction=${cmd.command}%20${D_OBJECT_URI?.name}=${D_OBJECT_URI!.value};DYNP_OKCODE=${okCode!.value}#...`);
    }
    // commands.executeCommand('browser-preview.openPreview', 'https://vhcalnplci.agilux.com.au:44300/sap/bc/gui/sap/its/webgui?sap-user=kjaerj&sap-password=Fernando1.&language=EN&~transaction=*SE38%20RS38M-PROGRAMM=ZTEST;DYNP_OKCODE=STRT#...');  
  }
  public async runInBrowser(config: RemoteConfig, cmd: SapGuiCommand) {
    if (cmd.parameters) {
      const okCode = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name === 'DYNP_OKCODE')
      const D_OBJECT_URI = cmd.parameters.find((parameter: { name: string; value: string }) => parameter.name !== 'DYNP_OKCODE')
      const url = (config.url.slice(-1) === '/') ? config.url : config.url + "/";
      commands.executeCommand('vscode.open', Uri.parse(`${url}sap/bc/gui/sap/its/webgui?sap-user=${config.username}&sap-password=${config.password}&language=EN&~transaction=${cmd.command}%20${D_OBJECT_URI?.name}=${D_OBJECT_URI!.value};DYNP_OKCODE=${okCode!.value}#...`));
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
    const loginTicket = ticket ? `at = "MYSAPSSO2=${ticket}"` : ""
    const lang = this.language ? `Language = ${this.language} ` : ""
    return `[System]
    guiparm = "${this.connectionString}"
    Name = ${this.systemname}
    Client = ${this.config!.client}
    [User]
    Name = ${this.user}
    ${loginTicket}
    ${lang}
    [Function]
    Type = ${command.type}
    Command = ${this.commandString(command)}
    [Configuration]
    GuiSize = Maximized
    [Options]
    Reuse = 1`
  }
}
