import { window } from "vscode"

export const CHANNELNAME = "ABAP FS"

export const channel = window.createOutputChannel(CHANNELNAME)
export function log(...messages: string[]) {
  channel.appendLine(messages.join(""))
}
export function logJ(...messages: any) {
  for (const m of messages) {
    try {
      if (m instanceof Object) log(JSON.stringify(m))
      else log(`$m`)
    } catch (error) {
      // usually circular dependencies
      log(`$m`)
    }
  }
}
