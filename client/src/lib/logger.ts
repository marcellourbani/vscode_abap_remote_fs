import { window } from "vscode"

export const CHANNELNAME = "ABAP FS"

export const channel = window.createOutputChannel(CHANNELNAME)
export function log(...messages: string[]) {
  channel.appendLine(messages.join(""))
}
