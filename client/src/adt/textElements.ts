import { ADTClient, AdtLock, TextElement, TextElementsResult } from "abap-adt-api"
import { log } from "../lib"
import { selectTransport } from "./AdtTransports"

export type { TextElement, TextElementsResult }

export interface LockResult {
  lockHandle: string
  corrUserId?: string
  corrUser?: string
  isLocal?: boolean
  modificationSupport?: boolean
  transportInfo?: {
    corrNr?: string
    corrText?: string
  }
}

/** Map from AdtLock to the LockResult shape used throughout this module. */
function adtLockToLockResult(lock: AdtLock): LockResult {
  const corrNr = lock.CORRNR?.toString()
  const corrText = lock.CORRTEXT?.toString()
  return {
    lockHandle: lock.LOCK_HANDLE,
    corrUserId: lock.CORRUSER?.toString(),
    corrUser: lock.CORRUSER?.toString(),
    isLocal: lock.IS_LOCAL === "X",
    modificationSupport: lock.MODIFICATION_SUPPORT === "X",
    transportInfo: corrNr ? { corrNr, corrText } : undefined
  }
}

/**
 * Object type detection and URL utilities for text elements
 */

export enum ObjectType {
  PROGRAM = "PROGRAM",
  CLASS = "CLASS",
  FUNCTION_GROUP = "FUNCTION_GROUP",
  FUNCTION_MODULE = "FUNCTION_MODULE"
}

export interface ObjectInfo {
  name: string
  type: ObjectType
  cleanName: string // Name without extension
}

/**
 * Parse object name and determine type
 * Automatically handles URL encoding for namespace objects
 * Handles both regular forward slash (/) and division slash (∕) characters
 */
export function parseObjectName(objectName: string, explicitType?: string): ObjectInfo {
  // Clean the object name - handle URL encoding and file extensions
  let cleanName = objectName

  // URL-decode if it contains URL-encoded characters (for namespace objects)
  if (cleanName.includes("%")) {
    try {
      cleanName = decodeURIComponent(cleanName)
    } catch (error) {
      log(`[TextElements] Failed to URL decode '${objectName}': ${error}`)
      // Continue with original name if decoding fails
    }
  }

  // Normalize division slash (∕) to forward slash (/) for consistent processing
  if (cleanName.includes("∕")) {
    const originalName = cleanName
    cleanName = cleanName.replace(/∕/g, "/")
  }

  // Always use explicit type when provided (Copilot knows the object type)
  if (explicitType) {
    const type = explicitType.toUpperCase()
    if (type === "CLASS" || type.includes("CLAS")) {
      const finalCleanName = cleanName.replace(/\.clas\.abap$/i, "")
      return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName }
    } else if (type === "FUNCTION_GROUP" || type.includes("FUGR") || type.includes("FUNCTION")) {
      const finalCleanName = cleanName.replace(/\.fugr\.abap$/i, "")
      return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName }
    } else {
      const finalCleanName = cleanName.replace(/\.prog\.abap$/i, "")
      return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName }
    }
  }

  // Fallback: detect from file extension only (no name-based guessing)
  const name = cleanName.toLowerCase()
  if (name.endsWith(".clas.abap")) {
    const finalCleanName = name.replace(".clas.abap", "")
    return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName }
  } else if (name.endsWith(".fugr.abap")) {
    const finalCleanName = name.replace(".fugr.abap", "")
    return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName }
  } else if (name.endsWith(".func.abap")) {
    // Function module (individual function, not function group)
    const finalCleanName = name.replace(".func.abap", "")
    return { name: objectName, type: ObjectType.FUNCTION_MODULE, cleanName: finalCleanName }
  } else if (name.endsWith(".prog.abap")) {
    const finalCleanName = name.replace(".prog.abap", "")
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName }
  } else {
    // Default to program for plain names (no smart guessing)
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: cleanName }
  }
}

/**
 * Determine the ADT type prefix for use with apiTextElementsUrl from ObjectInfo.
 */
function objectInfoToAdtType(type: ObjectType): string {
  switch (type) {
    case ObjectType.CLASS:
      return "CLAS"
    case ObjectType.FUNCTION_GROUP:
      return "FUGR"
    default:
      return "PROG"
  }
}

/**
 * Get text elements base URL based on object info using the abap-adt-api helper.
 */
export function getTextElementsUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  return ADTClient.textElementsUrl(objectInfoToAdtType(objectInfo.type), objectInfo.cleanName)
}

/**
 * Get lock URL based on object info (same as the base text elements URL).
 */
export function getTextElementsLockUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * Get transport object path based on object info.
 */
export function getTransportObjectPathFromObjectInfo(objectInfo: ObjectInfo): string {
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * Determine the text elements base URL based on object name/type.
 */
function getTextElementsBaseUrl(objectName: string, objectType?: string): string {
  const objectInfo = parseObjectName(objectName, objectType)
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * Get text elements for an ABAP object using the ADT client.
 */
export async function getTextElements(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<TextElementsResult> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    return await connection.getTextElements(url, "symbols")
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { textElements: [], programName: objectName.toUpperCase() }
    }
    throw new Error(`Failed to get text elements for ${objectName}: ${error.message}`)
  }
}

/**
 * Lock text elements for modification via the standard ADT lock API.
 */
export async function lockTextElements(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<LockResult> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    const lock = await connection.lock(url, "MODIFY")
    return adtLockToLockResult(lock)
  } catch (error: any) {
    throw new Error(`Failed to lock text elements for ${objectName}: ${error.message}`)
  }
}

/**
 * Set text elements for an ABAP object.
 * Writes elements via the ADT client, then unlocks and activates.
 */
export async function setTextElements(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[],
  lockHandle: string,
  corrNr?: string,
  objectType?: string
): Promise<void> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    await connection.setTextElements(url, "symbols", textElements, lockHandle, corrNr)
    await connection.unLock(url, lockHandle).catch(() => undefined)
    await connection.activate(objectName.toUpperCase(), url)
  } catch (error: any) {
    throw new Error(`Failed to set text elements for ${objectName}: ${error.message}`)
  }
}

export async function updateTextElements(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[]
): Promise<void> {
  const lockResult = await lockTextElements(connection, objectName)
  try {
    await setTextElements(connection, objectName, textElements, lockResult.lockHandle)
  } catch (error) {
    await connection
      .unLock(getTextElementsBaseUrl(objectName), lockResult.lockHandle)
      .catch(() => undefined)
    throw error
  }
}

/**
 * Simple validation for object names
 */
function validateObjectName(objectName: string): void {
  if (!objectName || typeof objectName !== "string" || objectName.trim().length === 0) {
    throw new Error("Object name is required and must be a non-empty string")
  }
}

/**
 * Validate text elements array
 */
function validateTextElements(textElements: TextElement[]): void {
  if (!Array.isArray(textElements)) {
    throw new Error("Text elements must be an array")
  }

  if (textElements.length === 0) {
    throw new Error("At least one text element is required")
  }

  const usedIds = new Set<string>()

  for (const element of textElements) {
    if (!element.id || typeof element.id !== "string") {
      throw new Error("Each text element must have a valid id")
    }

    if (!element.text || typeof element.text !== "string") {
      throw new Error("Each text element must have valid text")
    }

    const id = element.id.toUpperCase()

    if (usedIds.has(id)) {
      throw new Error(`Duplicate text element ID: ${id}`)
    }
    usedIds.add(id)

    // Auto-calculate maxLength if not provided or invalid
    if (element.maxLength === undefined || element.maxLength === null || isNaN(element.maxLength)) {
      element.maxLength = Math.max(element.text.length, 10) // At least 10, or text length
    }

    if (typeof element.maxLength !== "number" || element.maxLength < 1 || element.maxLength > 255) {
      throw new Error(`Invalid maxLength for element ${id}: must be between 1 and 255`)
    }

    if (element.text.length > element.maxLength) {
      throw new Error(
        `Text length exceeds maxLength for element ${id}: ${element.text.length} > ${element.maxLength}`
      )
    }
  }
}

/**
 * Safe wrapper for getting text elements with validation
 */
export async function getTextElementsSafe(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<TextElementsResult> {
  validateObjectName(objectName)
  return getTextElements(connection, objectName, objectType)
}

export async function updateTextElementsWithTransport(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[],
  objectType?: string // Optional - only required when called from Copilot
): Promise<void> {
  validateObjectName(objectName)
  validateTextElements(textElements)

  let lockResult: LockResult | undefined

  try {
    lockResult = await lockTextElements(connection, objectName, objectType)

    let transportToUse: string | undefined

    if (lockResult.transportInfo?.corrNr) {
      transportToUse = lockResult.transportInfo.corrNr
    } else if (!lockResult.isLocal) {
      const objContentPath = getTextElementsBaseUrl(objectName, objectType)
      const transportSelection = await selectTransport(
        objContentPath,
        "",
        connection,
        false,
        "",
        ""
      )

      if (transportSelection.cancelled) {
        throw new Error("Transport selection was cancelled. Text elements update aborted.")
      }

      transportToUse = transportSelection.transport
    }

    await setTextElements(
      connection,
      objectName,
      textElements,
      lockResult.lockHandle,
      transportToUse,
      objectType
    )
  } catch (error) {
    if (lockResult) {
      await connection
        .unLock(getTextElementsBaseUrl(objectName, objectType), lockResult.lockHandle)
        .catch(() => undefined)
    }
    throw error
  }
}
