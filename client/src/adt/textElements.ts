import { ADTClient } from "abap-adt-api";
import { fullParse } from "abap-adt-api/build/utilities";
import { randomBytes } from "crypto";

// Import logging
const log = (message: string) => {
  // Use the same pattern as other files
  try {
    const { logCommands } = require('../services/abapCopilotLogger');
    logCommands.info(message);
  } catch {
    // Fallback if logger not available
    console.log(`[TextElements] ${message}`);
  }
};

// Generate Eclipse-style ADT session IDs
function generateAdtSessionId(): string {
  return randomBytes(16).toString('hex');
}

// ADT session management - maintain connection ID across requests
let sessionConnectionId: string | undefined;

function getAdtConnectionId(): string {
  if (!sessionConnectionId) {
    sessionConnectionId = generateAdtSessionId();
  }
  return sessionConnectionId;
}

function generateAdtRequestId(): string {
  return generateAdtSessionId();
}

export interface TextElement {
  id: string;
  text: string;
  maxLength?: number;
}

export interface TextElementsResult {
  textElements: TextElement[];
  programName: string;
}

export interface LockResult {
  lockHandle: string;
  corrUserId?: string;
  corrUser?: string;
  isLocal?: boolean;
  modificationSupport?: boolean;
  // Transport information from lock response
  transportInfo?: {
    corrNr?: string;      // Transport/Task number
    corrText?: string;    // Transport description
  };
}

/**
 * Object type detection and URL utilities for text elements
 */

export enum ObjectType {
  PROGRAM = 'PROGRAM',
  CLASS = 'CLASS',
  FUNCTION_GROUP = 'FUNCTION_GROUP',
  FUNCTION_MODULE = 'FUNCTION_MODULE'
}

export interface ObjectInfo {
  name: string;
  type: ObjectType;
  cleanName: string; // Name without extension
}

/**
 * Parse object name and determine type
 * Automatically handles URL encoding for namespace objects
 * Handles both regular forward slash (/) and division slash (∕) characters
 */
export function parseObjectName(objectName: string, explicitType?: string): ObjectInfo {
  // Clean the object name - handle URL encoding and file extensions
  let cleanName = objectName;
  
  // URL-decode if it contains URL-encoded characters (for namespace objects)
  if (cleanName.includes('%')) {
    try {
      cleanName = decodeURIComponent(cleanName);
    } catch (error) {
      log(`Failed to URL decode '${objectName}': ${error}`);
      // Continue with original name if decoding fails
    }
  }
  
  // Normalize division slash (∕) to forward slash (/) for consistent processing
  if (cleanName.includes('∕')) {
    const originalName = cleanName;
    cleanName = cleanName.replace(/∕/g, '/');
  }
  
  // Always use explicit type when provided (Copilot knows the object type)
  if (explicitType) {
    const type = explicitType.toUpperCase();
    if (type === 'CLASS' || type.includes('CLAS')) {
      const finalCleanName = cleanName.replace(/\.clas\.abap$/i, '');
      return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName };
    } else if (type === 'FUNCTION_GROUP' || type.includes('FUGR') || type.includes('FUNCTION')) {
      const finalCleanName = cleanName.replace(/\.fugr\.abap$/i, '');
      return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName };
    } else {
      const finalCleanName = cleanName.replace(/\.prog\.abap$/i, '');
      return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName };
    }
  }
  
  // Fallback: detect from file extension only (no name-based guessing)
  const name = cleanName.toLowerCase();
  if (name.endsWith('.clas.abap')) {
    const finalCleanName = name.replace('.clas.abap', '');
    return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName };
  } else if (name.endsWith('.fugr.abap')) {
    const finalCleanName = name.replace('.fugr.abap', '');
    return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName };
  } else if (name.endsWith('.func.abap')) {
    // Function module (individual function, not function group)
    const finalCleanName = name.replace('.func.abap', '');
    return { name: objectName, type: ObjectType.FUNCTION_MODULE, cleanName: finalCleanName };
  } else if (name.endsWith('.prog.abap')) {
    const finalCleanName = name.replace('.prog.abap', '');
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName };
  } else {
    // Default to program for plain names (no smart guessing)
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: cleanName };
  }
}

/**
 * Get text elements URL based on object info
 * Automatically handles URL encoding for namespace objects
 * Handles both regular forward slash (/) and division slash (∕) characters
 */
export function getTextElementsUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  // Check for namespace characters: both regular forward slash (/) and division slash (∕)
  const hasNamespaceChars = objectInfo.cleanName.includes('/') || objectInfo.cleanName.includes('∕');
  
  let encodedCleanName = objectInfo.cleanName;
  if (hasNamespaceChars) {
    // Normalize division slash (∕) to forward slash (/) first, then encode
    const normalizedName = objectInfo.cleanName.replace(/∕/g, '/');
    encodedCleanName = encodeURIComponent(normalizedName);
  }
  
  
  switch (objectInfo.type) {
    case ObjectType.CLASS:
      return `/sap/bc/adt/textelements/classes/${encodedCleanName}/source/symbols`;
    case ObjectType.FUNCTION_GROUP:
      return `/sap/bc/adt/textelements/functiongroups/${encodedCleanName}/source/symbols`;
    case ObjectType.PROGRAM:
    default:
      return `/sap/bc/adt/textelements/programs/${encodedCleanName}/source/symbols`;
  }
}

/**
 * Get lock URL based on object info
 * Automatically handles URL encoding for namespace objects
 * Handles both regular forward slash (/) and division slash (∕) characters
 */
export function getTextElementsLockUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  // Check for namespace characters: both regular forward slash (/) and division slash (∕)
  const hasNamespaceChars = objectInfo.cleanName.includes('/') || objectInfo.cleanName.includes('∕');
  
  let encodedCleanName = objectInfo.cleanName;
  if (hasNamespaceChars) {
    // Normalize division slash (∕) to forward slash (/) first, then encode
    const normalizedName = objectInfo.cleanName.replace(/∕/g, '/');
    encodedCleanName = encodeURIComponent(normalizedName);
  }
  
  
  switch (objectInfo.type) {
    case ObjectType.CLASS:
      return `/sap/bc/adt/textelements/classes/${encodedCleanName}`;
    case ObjectType.FUNCTION_GROUP:
      return `/sap/bc/adt/textelements/functiongroups/${encodedCleanName}`;
    case ObjectType.PROGRAM:
    default:
      return `/sap/bc/adt/textelements/programs/${encodedCleanName}`;
  }
}

/**
 * Get transport object path based on object info
 */
export function getTransportObjectPathFromObjectInfo(objectInfo: ObjectInfo): string {
  return getTextElementsUrlFromObjectInfo(objectInfo).replace('/source/symbols', '');
}

/**
 * Determine the text elements URL based on object type (uses consolidated logic)
 */
function getTextElementsUrl(objectName: string, objectType?: string): string {
  const objectInfo = parseObjectName(objectName, objectType);
  return getTextElementsUrlFromObjectInfo(objectInfo);
}

/**
 * Get text elements for an ABAP object (program, class, or function group)
 * Based on Eclipse ADT: GET /sap/bc/adt/textelements/{objectType}/{objectName}/source/symbols
 */
export async function getTextElements(connection: ADTClient, objectName: string, objectType?: string): Promise<TextElementsResult> {
  const url = getTextElementsUrl(objectName, objectType);
  
  const headers = {
    Accept: "application/vnd.sap.adt.textelements.symbols.v1"
  };

  try {
    const response = await connection.httpClient.request(url, { headers });
    
    const textElements = parseTextElementsResponse(response.body);
    
    return {
      textElements,
      programName: objectName.toUpperCase()
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      // Object has no text elements or doesn't exist
      return {
        textElements: [],
        programName: objectName.toUpperCase()
      };
    }
    throw new Error(`Failed to get text elements for ${objectName}: ${error.message}`);
  }
}

/**
 * Get lock URL for text elements based on object type (uses consolidated logic)
 */
function getTextElementsLockUrl(objectName: string, objectType?: string): string {
  const objectInfo = parseObjectName(objectName, objectType);
  return getTextElementsLockUrlFromObjectInfo(objectInfo);
}

/**
 * Lock text elements for modification
 * Based on Eclipse ADT: POST /sap/bc/adt/textelements/{objectType}/{objectName}?_action=LOCK&accessMode=MODIFY
 */
export async function lockTextElements(connection: ADTClient, objectName: string, objectType?: string): Promise<LockResult> {
  const url = getTextElementsLockUrl(objectName, objectType);
  
  
 // const connectionId = getAdtConnectionId();
//  const requestId = generateAdtRequestId();
  
  const headers = {
    Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.9",
    "User-Agent": "VSCode ABAP Remote FS/1.0.0 ADT/3.50.0",
    "X-sap-adt-profiling": "server-time",
   // "sap-adt-connection-id": connectionId,
   // "sap-adt-request-id": requestId
  };

  const qs = {
    _action: "LOCK",
    accessMode: "MODIFY"
  };

  try {
    
    const response = await connection.httpClient.request(url, {
      method: "POST",
      headers,
      qs
    });

    
    const lockResult = parseLockResponse(response.body);
    
    
    return lockResult;
  } catch (error: any) {
    throw new Error(`Failed to lock text elements for ${objectName}: ${error.message}`);
  }
}

/**
 * Check text elements version (Eclipse does this after lock, before PUT)
 * Based on Eclipse behavior: GET /sap/bc/adt/textelements/{objectType}/{objectName}?version=inactive
 */
async function checkTextElementsVersion(
  connection: ADTClient, 
  objectName: string, 
  objectType?: string
): Promise<void> {
  const url = getTextElementsUrl(objectName, objectType).replace('/source/symbols', '');
  
  const connectionId = getAdtConnectionId();
  const requestId = generateAdtRequestId();
  
  const headers = {
    Accept: "application/vnd.sap.adt.textelements.v1+xml",
    "User-Agent": "VSCode ABAP Remote FS/1.0.0 ADT/3.50.0",
    "X-sap-adt-profiling": "server-time",
    "sap-adt-connection-id": connectionId,
    "sap-adt-request-id": requestId
  };

  const qs = {
    version: "inactive"
  };

  try {
    const response = await connection.httpClient.request(url, {
      method: "GET",
      headers,
      qs
    });
  } catch (error: any) {
    // Don't fail the whole operation for version check
  }
}

/**
 * Unlock text elements after modification
 * Based on Eclipse ADT: POST /sap/bc/adt/textelements/{objectType}/{objectName}?_action=UNLOCK
 */
async function unlockTextElements(
  connection: ADTClient,
  lockUrl: string,
  lockHandle: string,
  objectName: string
): Promise<void> {
  const headers = {
    "User-Agent": "VSCode ABAP Remote FS/1.0.0 ADT/3.50.0",
    "X-sap-adt-profiling": "server-time"
  };

  const qs = {
    _action: "UNLOCK",
    lockHandle: lockHandle
  };

  try {
    await connection.httpClient.request(lockUrl, {
      method: "POST",
      headers,
      qs
    });
    
  } catch (error: any) {
    // Don't throw - unlock failure shouldn't stop activation
  }
}

/**
 * Activate text elements using ADT activation API
 */
async function activateObject(
  connection: ADTClient,
  textElementsUrl: string,
  objectName: string
): Promise<void> {
  // Remove /source/symbols from the URL we already have
  const activationUrl = textElementsUrl.replace('/source/symbols', '');
  
  const activationBody = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${activationUrl}" adtcore:name="${objectName.toUpperCase()}"/>
</adtcore:objectReferences>`;

  const headers = {
    "Accept": "application/xml",
    "Content-Type": "application/xml"
  };

  try {
    await connection.httpClient.request('/sap/bc/adt/activation', {
      method: "POST",
      headers,
      body: activationBody,
      qs: {
        method: "activate",
        preauditRequested: "true"
      }
    });
    
    
  } catch (error: any) {
    throw error;
  }
}

/**
 * Set text elements for an ABAP object (program, class, or function group)
 * Based on Eclipse ADT: PUT /sap/bc/adt/textelements/{objectType}/{objectName}/source/symbols?lockHandle={handle}&corrNr={transport}
 */
export async function setTextElements(
  connection: ADTClient, 
  objectName: string, 
  textElements: TextElement[], 
  lockHandle: string,
  corrNr?: string,
  objectType?: string
): Promise<void> {
  const url = getTextElementsUrl(objectName, objectType);
  
  
//  const connectionId = getAdtConnectionId(); // Use same connection ID as lock
 // const requestId = generateAdtRequestId(); // New request ID for this request
  
  const headers = {
    Accept: "application/vnd.sap.adt.textelements.symbols.v1",
    "Content-Type": "application/vnd.sap.adt.textelements.symbols.v1; charset=UTF-8",
    "User-Agent": "VSCode ABAP Remote FS/1.0.0 ADT/3.50.0",
    "X-sap-adt-profiling": "server-time",
  //  "sap-adt-connection-id": connectionId,
   // "sap-adt-request-id": requestId
  };

  const qs: any = {
    lockHandle
  };

  // Add transport parameter if provided
  if (corrNr) {
    qs.corrNr = corrNr;
  }

  
  const body = formatTextElementsForADT(textElements);

  try {
      const response = await connection.httpClient.request(url, {
      method: "PUT",
      headers,
      qs,
      body
    });
    
    
    // Step 1: Unlock the object after successful save
    const lockUrl = url.replace('/source/symbols', '');
    await unlockTextElements(connection, lockUrl, lockHandle, objectName);
    
    // Step 2: Now activate the object (without lock conflicts)
    try {
      await activateObject(connection, url, objectName);
    } catch (activationError: any) {
      throw new Error(`Text elements saved but activation failed: ${activationError.message}`);
    }
    
  } catch (error: any) {
    throw new Error(`Failed to set text elements for ${objectName}: ${error.message}`);
  }
}


export async function updateTextElements(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[]
): Promise<void> {
  // Step 1: Lock the object
  const lockResult = await lockTextElements(connection, objectName);
  
  try {
    // Step 2: Set the text elements (without transport - legacy function)
    await setTextElements(connection, objectName, textElements, lockResult.lockHandle);
    
    // Note: Lock will be automatically released when connection ends or by SAP timeout
    // In Eclipse ADT, explicit unlock is not always used for text elements
  } catch (error) {
    // If setting fails, we should ideally unlock, but ADT API doesn't always expose unlock endpoint
    // The lock will timeout automatically
    throw error;
  }
}

/**
 * Parse Eclipse ADT text elements response format
 * Format: @MaxLength:27\n001=Article Selection\n@MaxLength:21\n002=Output Mode
 */
function parseTextElementsResponse(responseBody: string): TextElement[] {
  const textElements: TextElement[] = [];
  const lines = responseBody.split('\n');
  
  let currentMaxLength: number | undefined;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.startsWith('@MaxLength:')) {
      // Parse max length directive
      const lengthStr = trimmedLine.substring('@MaxLength:'.length);
      const parsed = parseInt(lengthStr, 10);
      currentMaxLength = isNaN(parsed) ? undefined : parsed;
    } else if (trimmedLine && trimmedLine.includes('=')) {
      // Parse text element: ID=Text
      const equalIndex = trimmedLine.indexOf('=');
      const id = trimmedLine.substring(0, equalIndex).trim();
      const text = trimmedLine.substring(equalIndex + 1).trim();
      
      if (id && text !== undefined) {
        textElements.push({
          id,
          text,
          maxLength: currentMaxLength
        });
      }
      
      // Reset max length after use (seems to be per-element in Eclipse format)
      currentMaxLength = undefined;
    }
  }

  return textElements;
}

/**
 * Format text elements for ADT API (reverse of parsing)
 */
function formatTextElementsForADT(textElements: TextElement[]): string {
  const lines: string[] = [];

  for (const element of textElements) {
    if (element.maxLength && element.maxLength > 0) {
      lines.push(`@MaxLength:${element.maxLength}`);
    }
    lines.push(`${element.id}=${element.text}`);
  }

  return lines.join('\n');
}

/**
 * Parse lock response XML from ADT
 * Expected format: <asx:abap><asx:values><DATA><LOCK_HANDLE>XXX</LOCK_HANDLE>...
 */
function parseLockResponse(responseBody: string): LockResult {
  try {
    const parsed = fullParse(responseBody);
    
    // Navigate the XML structure based on Eclipse response format
    const data = parsed?.["asx:abap"]?.["asx:values"]?.["DATA"];
    
    if (!data) {
      throw new Error("Invalid lock response format");
    }

    const lockHandle = data["LOCK_HANDLE"];
    if (!lockHandle) {
      throw new Error("No lock handle in response");
    }

    // Extract transport information if available
    const transportInfo: any = {};
    if (data["CORRNR"]) {
      transportInfo.corrNr = data["CORRNR"].toString();
    }
    if (data["CORRTEXT"]) {
      transportInfo.corrText = data["CORRTEXT"].toString();
    }

    return {
      lockHandle: lockHandle.toString(),
      corrUserId: data["CORRUSER"]?.toString(),
      corrUser: data["CORRUSER"]?.toString(), // Alias for compatibility
      isLocal: data["IS_LOCAL"] === "X",
      modificationSupport: data["MODIFICATION_SUPPORT"] === "X",
      transportInfo: Object.keys(transportInfo).length > 0 ? transportInfo : undefined
    };
  } catch (error: any) {
    throw new Error(`Failed to parse lock response: ${error.message}`);
  }
}

/**
 * Simple validation for object names
 */
function validateObjectName(objectName: string): void {
  if (!objectName || typeof objectName !== 'string' || objectName.trim().length === 0) {
    throw new Error('Object name is required and must be a non-empty string');
  }
}

/**
 * Validate text elements array
 */
function validateTextElements(textElements: TextElement[]): void {
  if (!Array.isArray(textElements)) {
    throw new Error('Text elements must be an array');
  }

  if (textElements.length === 0) {
    throw new Error('At least one text element is required');
  }

  const usedIds = new Set<string>();
  
  for (const element of textElements) {
    if (!element.id || typeof element.id !== 'string') {
      throw new Error('Each text element must have a valid id');
    }
    
    if (!element.text || typeof element.text !== 'string') {
      throw new Error('Each text element must have valid text');
    }
    
    const id = element.id.toUpperCase();
    
    if (usedIds.has(id)) {
      throw new Error(`Duplicate text element ID: ${id}`);
    }
    usedIds.add(id);
    
    // Auto-calculate maxLength if not provided or invalid
    if (element.maxLength === undefined || element.maxLength === null || isNaN(element.maxLength)) {
      element.maxLength = Math.max(element.text.length, 10); // At least 10, or text length
    }
    
    if (typeof element.maxLength !== 'number' || element.maxLength < 1 || element.maxLength > 255) {
      throw new Error(`Invalid maxLength for element ${id}: must be between 1 and 255`);
    }
    
    if (element.text.length > element.maxLength) {
      throw new Error(`Text length exceeds maxLength for element ${id}: ${element.text.length} > ${element.maxLength}`);
    }
  }
}

/**
 * Safe wrapper for getting text elements with validation
 */
export async function getTextElementsSafe(connection: ADTClient, objectName: string, objectType?: string): Promise<TextElementsResult> {
  validateObjectName(objectName);
  return getTextElements(connection, objectName, objectType);
}


export async function updateTextElementsWithTransport(
  connection: ADTClient, 
  objectName: string, 
  textElements: TextElement[],
  objectType?: string  // Optional - only required when called from Copilot
): Promise<void> {
  validateObjectName(objectName);
  validateTextElements(textElements);
  
  let lockResult: LockResult | undefined;
  
  try {
    // Step 1: Lock the object for text elements modification (LOCK ONCE)
    lockResult = await lockTextElements(connection, objectName, objectType);
    
    // Step 1.5: Version check (Eclipse does this after lock, before PUT)
    await checkTextElementsVersion(connection, objectName, objectType);
    
    // Step 2: Check if we need transport selection
    let transportToUse: string | undefined;
    
    if (lockResult.transportInfo?.corrNr) {
      // Object is already locked in a transport - use it
      transportToUse = lockResult.transportInfo.corrNr;
    } else if (!lockResult.isLocal) {
      // Object needs transport but none assigned - trigger transport selection
      const { selectTransport } = await import('./AdtTransports');
      
      // Get object path for transport info - use same logic as text elements URL
      const objContentPath = getTextElementsUrl(objectName, objectType).replace('/source/symbols', '');
      
      // For text elements, we don't need to determine package - the object already exists
      // and transport selection will use the object's existing package information
      const transportSelection = await selectTransport(
        objContentPath,
        '', // empty package - let selectTransport determine from object
        connection,
        false, // forCreation = false (we're modifying existing object)
        '', // current transport
        '' // transport layer
      );
      
      if (transportSelection.cancelled) {
        throw new Error('Transport selection was cancelled. Text elements update aborted.');
      }
      
      transportToUse = transportSelection.transport;
    }
    // If isLocal = true, no transport needed
    
    // Step 3: Set the text elements with transport info (USE EXISTING LOCK - NO SECOND LOCK)
    await setTextElements(connection, objectName, textElements, lockResult.lockHandle, transportToUse, objectType);
        
    
    // Note: Lock will be automatically released when connection ends or by SAP timeout
    // In Eclipse ADT, explicit unlock is not always used for text elements
  } catch (error) {
    // If setting fails, try to unlock the object to clean up properly
    if (lockResult) {
      try {
        const lockUrl = getTextElementsLockUrl(objectName, objectType);
        await unlockTextElements(connection, lockUrl, lockResult.lockHandle, objectName);
      } catch (unlockError) {
        // Ignore unlock errors in error handling - don't mask the original error
      }
    }
    throw error;
  }
}
