import { isAdtError, type ActivationResult } from "abap-adt-api"
import { channel } from "../../../lib"

export interface ActivationFailure {
  ok: false
  summary: string
  details: string
}

interface TargetedMessage {
  text: string
  target: string
}

export const logActivation = (message: string) => channel.appendLine(message)

const plainText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(plainText).join(" ")
  if (value === undefined || value === null) return ""
  return `${value}`
}

const hrefTarget = (href: string) => {
  const parts = href.split("/").filter(Boolean)
  const sourceIndex = parts.indexOf("source")
  if (sourceIndex > 0) return parts[sourceIndex - 1] || ""
  const match = href.match(/includes\/([^\/\?#]+)|programs\/([^\/\?#]+)|classes\/([^\/\?#]+)/i)
  return match?.[1] || match?.[2] || match?.[3] || ""
}

const messageTarget = (message: Record<string, unknown>, objectName: string) => {
  const href = typeof message.href === "string" ? message.href : ""
  const fromHref = href ? hrefTarget(href) : ""
  if (fromHref) return fromHref
  const objDescr = typeof message.objDescr === "string" ? message.objDescr : ""
  return objDescr.match(/Include\s+([^\s]+)/i)?.[1] || objectName
}

const targetedMessages = (result: ActivationResult, objectName: string): TargetedMessage[] =>
  (result.messages || []).flatMap(raw => {
    const message = raw as unknown as Record<string, unknown>
    const text = plainText(
      message.shortText || message.longText || message.message || message.msg
    ).trim()
    return text ? [{ text, target: messageTarget(message, objectName) }] : []
  })

const groupByTarget = (messages: TargetedMessage[]) => {
  const grouped = new Map<string, string[]>()
  for (const message of messages)
    grouped.set(message.target, [...(grouped.get(message.target) || []), message.text])
  return grouped
}

const failureSummary = (messages: TargetedMessage[], inactive: string[], objectName: string) => {
  if (!messages.length && inactive.length)
    return `Activation failed: these objects must be activated together: ${inactive.join(", ")}`
  if (!messages.length) return `Activation failed for ${objectName}: SAP returned no messages`
  const count = messages.length
  const first = messages[0]
  return `Activation failed: ${count} error${count !== 1 ? "s" : ""} in ${first.target} (${first.text}${count > 1 ? "..." : ""})`
}

/** Builds the user facing summary of a failed activation and logs the details */
export function summarizeActivationFailure(
  result: ActivationResult,
  objectName: string
): ActivationFailure {
  const messages = targetedMessages(result, objectName)
  const inactive = (result.inactive || [])
    .map(record =>
      `${plainText(record.object?.["adtcore:type"])} ${plainText(record.object?.["adtcore:name"])}`.trim()
    )
    .filter(Boolean)

  const detailLines: string[] = []
  logActivation(`❌ Activation failed for ${objectName}:`)
  for (const [target, texts] of groupByTarget(messages)) {
    detailLines.push(`${target}:`, ...texts.map(text => `  ${text}`))
    logActivation(`  📍 ${target}:`)
    texts.forEach(text => logActivation(`      ${text}`))
  }
  if (inactive.length) {
    detailLines.push(`Inactive objects: ${inactive.join(", ")}`)
    logActivation(`  ⚠️ Inactive objects: ${inactive.join(", ")}`)
  }

  return {
    ok: false,
    summary: failureSummary(messages, inactive, objectName),
    details: detailLines.join("\n")
  }
}

const MAIN_PROGRAM_HINT =
  "SAP has no valid main program for this include. This usually means the main program " +
  "that contains the INCLUDE statement is inactive, or was not activated after the INCLUDE " +
  "statement was added. Activate the main program together with the include."

const mentionsMainProgram = (type: string, text: string) =>
  type === "invalidMainProgram" || /master program/i.test(text)

/** SAP rejected the main program of an include */
export const isMainProgramError = (error: unknown) => {
  const { type, message } = (error || {}) as { type?: unknown; message?: unknown }
  return mentionsMainProgram(`${type || ""}`, `${message || ""}`)
}

const withHint = (text: string, type: string) => {
  if (!mentionsMainProgram(type, text)) return text
  return `${text}${/[.!?…]$/.test(text.trim()) ? "" : "."} ${MAIN_PROGRAM_HINT}`
}

/** Turns an exception thrown during activation into a user facing summary and logs it */
export function describeActivationError(error: unknown, operation: string) {
  if (isAdtError(error)) {
    const status = error.response?.status || error.type || "ADT error"
    const body = error.response?.body || error.message || ""
    const bodyText = typeof body === "string" ? body : JSON.stringify(body)
    const trimmed = bodyText.length > 800 ? `${bodyText.slice(0, 800)}…` : bodyText
    logActivation(`❌ ${operation} ADT error status=${status} body=${trimmed}`)
    return `Activation failed (${status}): ${withHint(trimmed, `${error.type || ""}`)}`
  }

  const message = (error as Error)?.message || String(error)
  logActivation(`❌ ${operation} error: ${message}`)
  if (message.includes("ECONNRESET") || message.includes("timeout"))
    return `Connection lost during activation (${message}). Please reconnect to SAP and try again.`
  if (message.includes("401") || message.includes("403"))
    return `Authentication failed (${message}). Please reconnect to SAP and try again.`
  return message
}
