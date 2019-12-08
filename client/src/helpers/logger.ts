import { window } from "vscode"

export const channel = window.createOutputChannel("ABAP FS")
export function log(...messages: string[]) {
  channel.appendLine(messages.join(""))
}
