import { AdtServer } from "./../AdtServer"
import { RemoteConfig } from "../../config"
import { file } from "tmp-promise"
import { writeAsync } from "fs-jetpack"
import { log } from "../../helpers/logger"
import { closeSync } from "fs"
import opn = require("open")
import { window, ProgressLocation } from "vscode"

export interface SapGuiCommand {
  type: "Transaction" | "Report" | "SystemCommand"
  command: string
  parameters?: Array<{ name: string; value: string }>
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

export async function runInSapGui(
  server: AdtServer,
  getCmd: () => Promise<SapGuiCommand | undefined> | SapGuiCommand | undefined
) {
  await window.withProgress(
    { location: ProgressLocation.Window, title: "Opening SAPGui..." },
    async () => {
      const cmd = await getCmd()
      if (cmd) {
        log("Running " + JSON.stringify(cmd))
        server.sapGui.checkConfig()
        const ticket = await server.getReentranceTicket()
        await server.sapGui.startGui(cmd, ticket)
      }
    }
  )
}

export function showInGui(server: AdtServer, uri: string) {
  return runInSapGui(server, () => ({
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
          gui && gui.disabled,
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
      return `${routerString}/M/${c.messageServer}/S/${c.messageServerPort}/G/${
        c.group
      }`
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

  private commandString(command: SapGuiCommand) {
    let params = ""
    const addParm = (name: string, value: string) =>
      (params = `${params}${name}=${value};`)
    if (command.parameters)
      command.parameters.forEach(p => addParm(p.name, p.value))
    if (command.okCode) addParm("DYNP_OKCODE", command.okCode)
    return `${command.command} ${params}`
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
