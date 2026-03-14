import { funWindow as window } from "../services/funMessenger"

export const CHANNELNAME = "ABAP FS"

export const channel = window.createOutputChannel(CHANNELNAME, { log: true })

export function log(...messages: string[]) {
  channel.info(messages.join(""))
}

log.info = (...messages: string[]) => channel.info(messages.join(""))
log.warn = (...messages: string[]) => channel.warn(messages.join(""))
log.error = (...messages: string[]) => channel.error(messages.join(""))
log.debug = (...messages: string[]) => channel.debug(messages.join(""))
log.trace = (...messages: string[]) => channel.trace(messages.join(""))