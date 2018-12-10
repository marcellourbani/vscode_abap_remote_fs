import { window } from "vscode"

const channel = window.createOutputChannel("ABAPFS")

export function log(...messages: string[]) {
  channel.appendLine(messages.join(""))
}
