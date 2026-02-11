import { getClient } from "../../adt/conections"

/**
 * Shared utilities and types for ABAP Language Model Tools
 */

// ============================================================================
// SQL INJECTION PROTECTION
// ============================================================================

/**
 * Sanitize SAP object names to prevent SQL injection.
 * SAP object names are alphanumeric with underscores and slashes (for namespaces).
 * This function validates and sanitizes the input to ensure it's safe for SQL queries.
 *
 * @throws Error if the name contains invalid characters
 */
export function sanitizeObjectName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Object name is required and must be a string")
  }

  const sanitized = name.trim().toUpperCase()

  // SAP object names: alphanumeric, underscore, forward slash (namespaces), percent (wildcards for LIKE)
  // Max length is typically 30 characters for most objects, but some can be longer
  const validPattern = /^[A-Z0-9_/%]+$/

  if (!validPattern.test(sanitized)) {
    throw new Error(
      `Invalid object name: "${name}". Only alphanumeric characters, underscores, forward slashes, and percent signs are allowed.`
    )
  }

  if (sanitized.length > 120) {
    throw new Error(`Object name too long: "${name}". Maximum length is 120 characters.`)
  }

  // Additional check: no SQL keywords or suspicious patterns
  const suspiciousPatterns = [
    /'/, // Single quotes (SQL string delimiter)
    /--/, // SQL comment
    /;/, // Statement terminator
    /\bOR\b/i, // OR keyword
    /\bAND\b/i, // AND keyword
    /\bDROP\b/i, // DROP keyword
    /\bDELETE\b/i, // DELETE keyword
    /\bUPDATE\b/i, // UPDATE keyword
    /\bINSERT\b/i // INSERT keyword
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error(`Object name contains suspicious pattern: "${name}"`)
    }
  }

  return sanitized
}

// ============================================================================
// DATA DICTIONARY QUERY HELPERS
// ============================================================================

/**
 * Get table type information from DD40L/DD40T
 */
export async function getTableTypeFromDD(client: any, typeName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(typeName)
  const sql = `SELECT l~TYPENAME, l~ROWTYPE, l~ROWKIND, l~DATATYPE, l~LENG, l~DECIMALS, t~DDTEXT FROM DD40L AS l INNER JOIN DD40T AS t ON l~TYPENAME = t~TYPENAME WHERE l~TYPENAME = '${sanitizedName}' AND l~AS4LOCAL = 'A' AND t~DDLANGUAGE = 'E' AND t~AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Table Type from DD40L/DD40T:\n`
  result.values.forEach((row: any) => {
    structure += `Type Name: ${row.TYPENAME}\n`
    if (row.DDTEXT) structure += `Description: ${row.DDTEXT}\n`
    structure += `Line Type (ROWTYPE): ${row.ROWTYPE}\n`
    structure += `Row Kind: ${row.ROWKIND}\n`
    if (row.DATATYPE) {
      structure += `Data Type: ${row.DATATYPE}`
      if (row.LENG) structure += `(${row.LENG})`
      if (row.DECIMALS) structure += ` DECIMALS ${row.DECIMALS}`
      structure += `\n`
    }
    structure += `\n💡 This is a table type that references line type ${row.ROWTYPE}. To see the actual fields, query the line type structure.`
  })

  return structure
}

/**
 * Get table structure from DD03M
 */
export async function getTableStructureFromDD(client: any, objectName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(objectName)
  const sql = `SELECT TABNAME, FIELDNAME, ROLLNAME, DOMNAME, POSITION, KEYFLAG, MANDATORY, CHECKTABLE, INTTYPE, INTLEN, PRECFIELD, ROUTPUTLEN, DATATYPE, LENG, OUTPUTLEN, DECIMALS, DDTEXT, LOWERCASE, SIGNFLAG, LANGFLAG, VALEXI, ENTITYTAB, CONVEXIT FROM DD03M WHERE TABNAME = '${sanitizedName}' AND DDLANGUAGE = 'E' ORDER BY POSITION`

  const result = await client.runQuery(sql, 1000, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Fields from DD03M (Data Dictionary with Text):\n`
  result.values.forEach((row: any) => {
    const fieldName = row.FIELDNAME || ""
    const dataElement = row.ROLLNAME || ""
    const domain = row.DOMNAME || ""
    const description = row.DDTEXT || ""
    const keyFlag = row.KEYFLAG === "X" ? " [KEY]" : ""
    const mandatory = row.MANDATORY === "X" ? " [MANDATORY]" : ""
    const intType = row.INTTYPE || ""
    const intLen = row.INTLEN || ""
    const dataType = row.DATATYPE || ""
    const length = row.LENG || ""
    const decimals = row.DECIMALS || ""

    structure += `${fieldName}: ${intType || dataType}`
    if (intLen || length) structure += `(${intLen || length})`
    if (decimals) structure += ` DECIMALS(${decimals})`
    if (description) structure += ` - ${description}`
    if (dataElement) structure += ` [DE:${dataElement}]`
    if (domain) structure += ` [DOM:${domain}]`
    structure += `${keyFlag}${mandatory}\n`
  })

  return structure
}

/**
 * Get append structures from DD02L
 */
export async function getAppendStructuresFromDD(
  client: any,
  tableName: string
): Promise<Array<{ name: string; fields: number }>> {
  const sanitizedName = sanitizeObjectName(tableName)
  const sql = `SELECT TABNAME, TABCLASS FROM DD02L WHERE SQLTAB = '${sanitizedName}' AND TABCLASS = 'APPEND' AND AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return []
  }

  const appendStructures: Array<{ name: string; fields: number }> = []

  for (const row of result.values) {
    const appendName = row.TABNAME || ""
    if (appendName) {
      // Count fields in this append structure - appendName is already from DB, but sanitize for safety
      const sanitizedAppendName = sanitizeObjectName(appendName)
      const fieldCountSql = `SELECT COUNT(*) AS CNT FROM DD03L WHERE TABNAME = '${sanitizedAppendName}' AND AS4LOCAL = 'A' AND FIELDNAME <> '.INCLUDE'`
      try {
        const fieldResult = await client.runQuery(fieldCountSql, 1, true)
        const fieldCount = fieldResult?.values?.[0]?.CNT || 0
        appendStructures.push({ name: appendName, fields: parseInt(fieldCount, 10) })
      } catch {
        appendStructures.push({ name: appendName, fields: 0 })
      }
    }
  }

  return appendStructures
}

/**
 * Get data element information from DD04L
 */
export async function getDataElementFromDD(client: any, dataElementName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(dataElementName)
  const sql = `SELECT ROLLNAME, DOMNAME, DATATYPE, LENG, DECIMALS FROM DD04L WHERE ROLLNAME = '${sanitizedName}' AND AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Data Element from DD04L:\n`
  result.values.forEach((row: any) => {
    structure += `Element: ${row.ROLLNAME}\n`
    structure += `Domain: ${row.DOMNAME}\n`
    structure += `Data Type: ${row.DATATYPE}(${row.LENG})`
    if (row.DECIMALS) structure += ` DECIMALS ${row.DECIMALS}`
    structure += `\n`
  })

  return structure
}

/**
 * Get domain information from DD01L
 */
export async function getDomainFromDD(client: any, domainName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(domainName)
  const headerSql = `SELECT DOMNAME, DATATYPE, LENG, DECIMALS FROM DD01L WHERE DOMNAME = '${sanitizedName}' AND AS4LOCAL = 'A'`

  const headerResult = await client.runQuery(headerSql, 10, true)

  let structure = `Domain from DD01L:\n`

  if (headerResult && headerResult.values && headerResult.values.length > 0) {
    const header = headerResult.values[0]
    structure += `Domain: ${header.DOMNAME}\n`
    structure += `Data Type: ${header.DATATYPE}(${header.LENG})`
    if (header.DECIMALS) structure += ` DECIMALS ${header.DECIMALS}`
    structure += `\n`
  }

  return structure
}

/**
 * Get complete table structure including append structures
 */
export async function getCompleteTableStructure(
  connectionId: string,
  objectName: string,
  objectUri: string
): Promise<string> {
  try {
    const client = getClient(connectionId)
    const sanitizedName = sanitizeObjectName(objectName)

    const mainTableURI = getOptimalObjectURI("TABL/TA", objectUri)
    let mainStructure = ""

    try {
      mainStructure = await client.getObjectSource(mainTableURI)
    } catch (mainError) {
      try {
        const tableFields = await getTableStructureFromDD(client, sanitizedName)
        if (tableFields) {
          mainStructure = tableFields

          const completeStructure =
            `Complete Structure for ${sanitizedName}:\n` +
            `${"=".repeat(60)}\n` +
            `💡 DD Table Query: Includes main object + ALL append structures automatically\n` +
            `📊 Source: DD03L (Data Dictionary fields)\n` +
            `${"=".repeat(60)}\n\n` +
            tableFields

          return completeStructure
        }
      } catch (fallbackError) {
        // Ignore
      }
    }

    let allAppendStructures = ""
    let appendStructuresList: Array<{ name: string; fields: number }> = []

    try {
      appendStructuresList = await getAppendStructuresFromDD(client, sanitizedName)

      if (appendStructuresList.length > 0) {
        allAppendStructures += `\n\nALL APPEND STRUCTURES (${appendStructuresList.length}):\n`
        allAppendStructures += `${"=".repeat(40)}\n`
        for (const append of appendStructuresList) {
          allAppendStructures += `• ${append.name} (${append.fields} fields)\n`
        }
      }
    } catch (appendError) {
      // Append structures are optional
    }

    let completeStructure = `Complete Table Structure for ${sanitizedName}:\n`
    completeStructure += `${"=".repeat(60)}\n`
    completeStructure += `💡 SE11-like Table Access: Main table + ALL append structures\n`
    completeStructure += `📊 Append Structures Found: ${appendStructuresList.length}\n`
    completeStructure += `${"=".repeat(60)}\n\n`

    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`
      completeStructure += `${"=".repeat(40)}\n`
      completeStructure += mainStructure + "\n"
    }

    if (allAppendStructures) {
      completeStructure += allAppendStructures
    }

    return completeStructure
  } catch (error) {
    return `Could not retrieve complete table structure for ${objectName}: ${error}`
  }
}

// ============================================================================
// ENHANCEMENT TYPES AND INTERFACES
// ============================================================================

/**
 * Enhancement types and interfaces
 */
export interface EnhancementInfo {
  name: string
  startLine: number
  type: string // e.g., 'ENHANCEMENT'
  code?: string // Only included if needCode = true
  uri?: string // SAP enhancement URI for separate access
}

export interface EnhancementResult {
  hasEnhancements: boolean
  enhancements: EnhancementInfo[]
  totalEnhancements?: number
}

/**
 * 🔧 UTILITY: Get optimal URI path based on object type
 * Uses our research findings to determine whether XML metadata is sufficient
 * or if /source/main is needed for actual source code
 */
export function getOptimalObjectURI(objectType: string, baseUri: string): string {
  // Object types where XML metadata contains all needed information
  const metadataOnlyTypes = ["DTEL/DE", "DOMA/DD", "TTYP/DA"]

  // Object types that require actual source code via /source/main
  const sourceRequiredTypes = ["CLAS/OC", "FUNC/FF", "PROG/P", "INTF/OI", "TABL/TA"]

  if (metadataOnlyTypes.includes(objectType)) {
    // XML has all the info we need - no /source/main needed
    return baseUri
  } else if (sourceRequiredTypes.includes(objectType)) {
    // Need actual source code
    const sourceUri = baseUri.endsWith("/source/main") ? baseUri : `${baseUri}/source/main`
    return sourceUri
  } else {
    // Unknown type - try /source/main as fallback
    const sourceUri = baseUri.endsWith("/source/main") ? baseUri : `${baseUri}/source/main`
    return sourceUri
  }
}

/**
 * 🔧 UTILITY: Resolve correct URI path using findObjectPath
 */
export async function resolveCorrectURI(
  originalUri: string,
  connectionId: string
): Promise<string> {
  try {
    const client = getClient(connectionId)

    const pathSteps = await client.findObjectPath(originalUri)

    if (pathSteps && pathSteps.length > 0) {
      // Use the last path step's URI as it should be the most specific/correct
      const lastStep = pathSteps[pathSteps.length - 1]
      const resolvedUri = lastStep["adtcore:uri"] || originalUri

      if (resolvedUri !== originalUri) {
      }

      return resolvedUri
    } else {
      // logCommands.warn(`⚠️ No path steps found for URI: ${originalUri}`);
      return originalUri
    }
  } catch (pathError) {
    // logCommands.warn(`⚠️ Path resolution failed for ${originalUri}: ${pathError}`);
    return originalUri // Fallback to original
  }
}

interface CachedEnhancementResult {
  result: EnhancementResult
  timestamp: number
  needCode: boolean
}

const enhancementCache = new Map<string, CachedEnhancementResult>()
const ENHANCEMENT_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const MAX_CACHE_SIZE = 1000 // Prevent unlimited growth

setInterval(
  () => {
    const now = Date.now()
    const entriesToDelete: string[] = []

    // First pass: Remove expired entries
    for (const [key, cached] of enhancementCache.entries()) {
      if (now - cached.timestamp > ENHANCEMENT_CACHE_TTL) {
        entriesToDelete.push(key)
      }
    }

    // Delete expired entries
    for (const key of entriesToDelete) {
      enhancementCache.delete(key)
    }

    // Second pass: If still too large, remove oldest entries
    if (enhancementCache.size > MAX_CACHE_SIZE) {
      const sortedEntries = Array.from(enhancementCache.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp
      )

      const toRemove = sortedEntries.slice(0, enhancementCache.size - MAX_CACHE_SIZE)
      for (const [key] of toRemove) {
        enhancementCache.delete(key)
      }
    }
  },
  5 * 60 * 1000
) // Cleanup every 5 minutes

/**
 * Get enhancement information for an ABAP object using SAP's enhancement APIs
 * Called from language model tools, search tools, and editor decorations
 */
export async function getObjectEnhancements(
  objectUriOrPath: string,
  connectionId: string,
  needCode: boolean = false
): Promise<EnhancementResult> {
  try {
    const cacheKey = `${connectionId}:${objectUriOrPath}:${needCode}`
    const cached = enhancementCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < ENHANCEMENT_CACHE_TTL) {
      // Cache hit - return cached result
      return cached.result
    }

    const { getClient } = await import("../../adt/conections")
    const client = getClient(connectionId)

    // Ensure we have a proper source/main path
    let sourceMainPath = objectUriOrPath
    if (!sourceMainPath.includes("/source/main")) {
      if (sourceMainPath.endsWith("/source/main")) {
        // Already has /source/main
      } else {
        // Add /source/main to the path
        sourceMainPath = sourceMainPath.endsWith("/")
          ? `${sourceMainPath}source/main`
          : `${sourceMainPath}/source/main`
      }
    }

    const result: EnhancementResult = {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    }

    try {
      // Step 3: Get enhancement names and source code from elements endpoint
      let enhancementDetails: Array<{
        name: string
        code?: string
        startLine?: number
        endLine?: number
        uri?: string
      }> = []

      try {
        const enhancementsUri = `${sourceMainPath}/enhancements/elements`
        // logCommands.debug(`🔍 Calling enhancements API: ${enhancementsUri}`);

        const enhancementsResponse = await client.httpClient.request(enhancementsUri, {
          headers: {
            Accept: "application/vnd.sap.adt.enhancements.v3+xml"
          }
        })
        const enhancementsData = enhancementsResponse.body

        if (enhancementsData && enhancementsData.trim().length > 0) {
          // Parse the enhancement elements XML to extract names and encoded source
          const elementMatches = enhancementsData.match(
            /<enh:elements[^>]*>(.*?)<\/enh:elements>/gs
          )

          if (elementMatches) {
            for (const elementMatch of elementMatches) {
              // Extract enhancement name
              const nameMatch = elementMatch.match(/enh:full_name="([^"]+)"/)
              // Extract enhancement URI from enh:uri attribute
              const uriMatch = elementMatch.match(/enh:uri="([^"]+)"/)

              if (nameMatch) {
                const enhancementName = nameMatch[1]
                const enhancementUri = uriMatch ? uriMatch[1] : ""
                let enhancementCode: string | undefined
                let startLine = 0

                // Extract position information from the <enh:position> element within <enh:option>
                const positionMatch = elementMatch.match(
                  /<enh:position[^>]*adtcore:uri="[^"]*#start=(\d+),\d+"[^>]*\/>/
                )
                if (positionMatch) {
                  startLine = parseInt(positionMatch[1], 10)
                }

                if (needCode) {
                  // Extract and decode source code if requested
                  const sourceMatch = elementMatch.match(
                    /<enh:source>([A-Za-z0-9+\/=\s]+)<\/enh:source>/
                  )
                  if (sourceMatch) {
                    const encodedSource = sourceMatch[1].replace(/\s/g, "") // Remove whitespace
                    try {
                      enhancementCode = Buffer.from(encodedSource, "base64").toString("utf8")
                      // logCommands.debug(`✅ Decoded enhancement ${enhancementName}: ${enhancementCode.length} chars`);
                    } catch (decodeError) {
                      // logCommands.warn(`⚠️ Failed to decode enhancement ${enhancementName}: ${decodeError}`);
                    }
                  }
                }

                enhancementDetails.push({
                  name: enhancementName,
                  code: enhancementCode,
                  startLine: startLine,
                  uri: enhancementUri
                })
              }
            }
          }
        }
      } catch (enhError) {
        //logCommands.warn(`⚠️ Enhancement elements API failed: ${enhError}`);
        // Continue without enhancement details
      }

      if (enhancementDetails.length === 0) {
        // logCommands.debug(`ℹ️ No enhancement details found`);
        return result
      }

      // Step 4: Build result by combining positions with enhancement details
      result.hasEnhancements = enhancementDetails.length > 0
      result.totalEnhancements = enhancementDetails.length

      // Use line numbers directly from enhancement details (from elements response)
      result.enhancements = enhancementDetails.map(detail => {
        return {
          name: detail.name,
          startLine: detail.startLine || 0,
          type: "ENHANCEMENT",
          code: detail.code,
          uri: detail.uri
        }
      })

      // logCommands.debug(`✅ Enhancement processing complete: ${result.totalEnhancements} enhancements found`);

      enhancementCache.set(cacheKey, {
        result,
        timestamp: now,
        needCode
      })
      return result
    } catch (apiError) {
      // logCommands.debug(`ℹ️ Enhancement APIs not available: ${apiError}`);
      return result // Return empty result
    }
  } catch (error) {
    // logCommands.error(`❌ Error getting enhancements: ${error}`);
    return {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    }
  }
}
