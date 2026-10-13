/*
 *   Differences from the current abap-adt-api implementation:
 * - inactive objects: also understands the adtcore:objectReferences format some systems return
 * - activation request: escapes attributes, omits empty parentUri and accepts include context URIs
 * - activation response: same semantics as the library (an ioc:inactiveObjects answer is a failure)
 */
import type {
  ADTClient,
  ActivationResult,
  ActivationResultMessage,
  InactiveObjectElement,
  InactiveObjectRecord
} from "abap-adt-api"
import { XMLParser } from "fast-xml-parser"

export const INACTIVE_OBJECTS_PATH = "/sap/bc/adt/activation/inactiveobjects"
export const ACTIVATION_PATH = "/sap/bc/adt/activation"

export interface ActivationReference {
  /** object URI, for includes optionally with ?context=<main program URI> */
  uri: string
  type: string
  name: string
  parentUri?: string
}

type XmlNode = Record<string, unknown>

const isNode = (value: unknown): value is XmlNode => !!value && typeof value === "object"

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : [])

const parseXml = (xml: string): XmlNode => {
  if (!xml.trim()) return {}
  const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(xml)
  return isNode(parsed) ? parsed : {}
}

const attribute = (node: XmlNode, name: string) => {
  const value = node[`@_${name}`]
  return typeof value === "string" ? value : ""
}

export const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const iocElement = (value: unknown): InactiveObjectElement | undefined => {
  if (!isNode(value) || !isNode(value["ioc:ref"])) return
  const ref = value["ioc:ref"]
  const uri = attribute(ref, "adtcore:uri")
  if (!uri) return
  const description = attribute(ref, "adtcore:description")
  return {
    "adtcore:uri": uri,
    "adtcore:type": attribute(ref, "adtcore:type"),
    "adtcore:name": attribute(ref, "adtcore:name"),
    "adtcore:parentUri": attribute(ref, "adtcore:parentUri"),
    user: attribute(value, "ioc:user"),
    deleted: attribute(value, "ioc:deleted") === "true",
    ...(description ? { "adtcore:description": description } : {})
  }
}

const iocRecords = (root: unknown): InactiveObjectRecord[] =>
  asArray(isNode(root) ? root["ioc:entry"] : undefined).flatMap(entry =>
    isNode(entry)
      ? [{ object: iocElement(entry["ioc:object"]), transport: iocElement(entry["ioc:transport"]) }]
      : []
  )

const objectReferenceRecords = (root: unknown): InactiveObjectRecord[] =>
  asArray(isNode(root) ? root["adtcore:objectReference"] : undefined).flatMap(reference => {
    if (!isNode(reference)) return []
    const uri = attribute(reference, "adtcore:uri")
    const type = attribute(reference, "adtcore:type")
    const name = attribute(reference, "adtcore:name")
    if (!uri || !type || !name) return []
    return [
      {
        object: {
          "adtcore:uri": uri,
          "adtcore:type": type,
          "adtcore:name": name,
          "adtcore:parentUri": attribute(reference, "adtcore:parentUri"),
          user: "",
          deleted: false
        }
      }
    ]
  })

/** Parses both the ioc:inactiveObjects and the adtcore:objectReferences formats */
export const parseInactiveObjects = (xml: string): InactiveObjectRecord[] => {
  const parsed = parseXml(xml)
  if ("ioc:inactiveObjects" in parsed) return iocRecords(parsed["ioc:inactiveObjects"])
  return objectReferenceRecords(parsed["adtcore:objectReferences"])
}

const textValue = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number") return `${value}`
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ")
  if (!isNode(value)) return ""
  return textValue(value.txt) || textValue(value["#text"])
}

const messageAttribute = (message: XmlNode, name: string) =>
  attribute(message, name) || attribute(message, `chkl:${name}`)

const activationMessages = (root: unknown): ActivationResultMessage[] =>
  asArray(isNode(root) ? root.msg : undefined).flatMap(message => {
    if (!isNode(message)) return []
    return [
      {
        objDescr: messageAttribute(message, "objDescr"),
        type: messageAttribute(message, "type"),
        line: Number(messageAttribute(message, "line")) || 0,
        href: messageAttribute(message, "href"),
        forceSupported: messageAttribute(message, "forceSupported") === "true",
        shortText:
          textValue(message.shortText) || messageAttribute(message, "shortText") || "Syntax error"
      }
    ]
  })

/**
 * SAP answers an activation either with chkl:messages, or with ioc:inactiveObjects when
 * further objects have to be activated together with the requested ones
 */
export const parseActivationResponse = (xml: string): ActivationResult => {
  const parsed = parseXml(xml)
  const inactive = "ioc:inactiveObjects" in parsed ? iocRecords(parsed["ioc:inactiveObjects"]) : []
  const messages = activationMessages(parsed["chkl:messages"])
  const failed = inactive.length > 0 || messages.some(message => /[EAX]/.test(message.type))
  return { success: !failed, messages, inactive }
}

export const activationRequestBody = (references: ActivationReference[]) => {
  const elements = references.map(reference => {
    const attributes = [
      `adtcore:uri="${escapeXml(reference.uri)}"`,
      `adtcore:type="${escapeXml(reference.type)}"`,
      `adtcore:name="${escapeXml(reference.name)}"`
    ]
    if (reference.parentUri)
      attributes.push(`adtcore:parentUri="${escapeXml(reference.parentUri)}"`)
    return `<adtcore:objectReference ${attributes.join(" ")}/>`
  })
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
    elements.join("\n") +
    `</adtcore:objectReferences>`
  )
}

export async function activateReferences(
  client: ADTClient,
  references: ActivationReference[]
): Promise<ActivationResult> {
  const response = await client.httpClient.request(ACTIVATION_PATH, {
    method: "POST",
    qs: { method: "activate", preauditRequested: true },
    body: activationRequestBody(references)
  })
  return parseActivationResponse(`${response.body || ""}`)
}

/**
 * Some systems answer the library's request in the adtcore:objectReferences format,
 * which the library parses as an empty list: retry asking for plain XML
 */
export async function inactiveObjectRecords(client: ADTClient): Promise<InactiveObjectRecord[]> {
  const records = await client.inactiveObjects()
  if (records.length) return records.filter(record => record.object)

  const response = await client.httpClient.request(INACTIVE_OBJECTS_PATH, {
    headers: { Accept: "application/xml" }
  })
  return parseInactiveObjects(`${response.body || ""}`).filter(record => record.object)
}
