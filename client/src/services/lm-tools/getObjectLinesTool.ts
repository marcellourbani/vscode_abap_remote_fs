/**
 * ABAP Get Object Lines Tool - VSCode AI Integration
 *
 * Retrieves source code lines from ABAP objects with table structure support
 */

import * as vscode from "vscode"
import { funWindow as window } from "../funMessenger"
import { getSearchService } from "../abapSearchService"
import { abapUri, getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import {
  getOptimalObjectURI,
  resolveCorrectURI,
  getObjectEnhancements,
  getTableTypeFromDD,
  getTableStructureFromDD,
  getAppendStructuresFromDD,
  getDataElementFromDD,
  getDomainFromDD
} from "./shared"

// ============================================================================
// LOCAL COMPLETE TABLE STRUCTURE (uses enhancement URIs - different from shared)
// ============================================================================

async function getCompleteTableStructure(
  connectionId: string,
  objectName: string,
  objectUri: string
): Promise<string> {
  try {
    const client = getClient(connectionId)

    const mainTableURI = getOptimalObjectURI("TABL/TA", objectUri)
    let mainStructure = ""

    try {
      mainStructure = await client.getObjectSource(mainTableURI)
    } catch (mainError) {
      try {
        const tableFields = await getTableStructureFromDD(client, objectName)
        if (tableFields) {
          mainStructure = tableFields

          const completeStructure =
            `Complete Structure for ${objectName}:\n` +
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

    try {
      const enhancementURI = `${objectUri}/enhancement/elements`
      const appendMetadata = await client.getObjectSource(enhancementURI)

      if (appendMetadata && appendMetadata.trim().length > 0) {
        const appendStructureNames: string[] = []

        const structureMatches = appendMetadata.match(/adtcore:name="([^"]+)"/g)
        if (structureMatches) {
          for (const match of structureMatches) {
            const nameMatch = match.match(/adtcore:name="([^"]+)"/)
            if (nameMatch && nameMatch[1] !== objectName.toLowerCase()) {
              appendStructureNames.push(nameMatch[1])
            }
          }
        }

        for (const structureName of appendStructureNames) {
          try {
            const searcher = getSearchService(connectionId)
            const structureResults = await searcher.searchObjects(structureName, undefined, 1)

            if (structureResults && structureResults.length > 0 && structureResults[0].uri) {
              const structureUri = structureResults[0].uri
              const optimalStructureUri = getOptimalObjectURI(
                structureResults[0].type,
                structureUri
              )
              const structureContent = await client.getObjectSource(optimalStructureUri)

              if (structureContent && structureContent.trim().length > 0) {
                allAppendStructures += `\n\n--- Append Structure: ${structureName.toUpperCase()} ---\n`
                allAppendStructures += structureContent
              }
            }
          } catch (error) {
            // Ignore append structure errors
          }
        }
      }
    } catch (appendError) {
      // Ignore enhancement errors
    }

    let completeStructure = `Complete Table Structure for ${objectName}:\n`
    completeStructure += `${"=".repeat(60)}\n`
    completeStructure += `💡 SE11-like Table Access: Main table + ALL append structures with complete field properties\n`
    completeStructure += `📊 Includes: ${mainStructure ? "Main table structure" : "No main structure"} + ${allAppendStructures ? "All append structures" : "No append structures"}\n`
    completeStructure += `${"=".repeat(60)}\n\n`

    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`
      completeStructure += `${"-".repeat(30)}\n`
      completeStructure += mainStructure
      completeStructure += `\n\n`
    }

    if (allAppendStructures) {
      completeStructure += `APPEND STRUCTURES (Additional Fields & Extensions):\n`
      completeStructure += `${"-".repeat(30)}\n`
      completeStructure += allAppendStructures
      completeStructure += `\n\n`
    }

    return completeStructure
  } catch (error) {
    return `Could not retrieve complete table structure for ${objectName}: ${error}`
  }
}

// Tool parameter interface
export interface IGetABAPObjectLinesParameters {
  objectName: string
  objectType?: string
  startLine?: number
  lineCount?: number
  connectionId?: string
  methodName?: string // For classes: extract only this specific method
}

/**
 * 📋 GET ABAP OBJECT LINES TOOL
 */
export class GetABAPObjectLinesTool implements vscode.LanguageModelTool<IGetABAPObjectLinesParameters> {
  /**
   * Extract a specific method from class source code
   * Handles: METHOD xxx. to ENDMETHOD. including multi-line comments
   */
  private extractMethod(
    lines: string[],
    methodName: string
  ): { found: boolean; code: string; startLine: number; endLine: number } {
    const methodNameUpper = methodName.toUpperCase().trim()
    let inMethod = false
    let inBlockComment = false
    let methodStartLine = -1
    let methodLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineUpper = line.toUpperCase()
      const lineTrimmed = lineUpper.trim()

      // Track block comments /* ... */
      if (lineTrimmed.includes("/*")) {
        inBlockComment = true
      }
      if (lineTrimmed.includes("*/")) {
        inBlockComment = false
        continue
      }

      // Skip if in block comment
      if (inBlockComment) {
        if (inMethod) methodLines.push(line)
        continue
      }

      // Skip single-line comments when checking for METHOD/ENDMETHOD
      const isCommented = lineTrimmed.startsWith("*") || lineTrimmed.startsWith('"')

      if (!inMethod) {
        // Look for METHOD methodName. (not commented)
        if (!isCommented) {
          // Match: METHOD method_name. or METHOD interface~method_name.
          const methodPattern = new RegExp(`^\\s*METHOD\\s+(\\w+~)?${methodNameUpper}\\s*\\.`, "i")
          if (methodPattern.test(line)) {
            inMethod = true
            methodStartLine = i + 1 // 1-based
            methodLines.push(line)
          }
        }
      } else {
        // We're inside the method, collect lines
        methodLines.push(line)

        // Look for ENDMETHOD. (not commented)
        if (!isCommented && /^\s*ENDMETHOD\s*\./.test(lineUpper)) {
          // Found the end
          return {
            found: true,
            code: methodLines.join("\n"),
            startLine: methodStartLine,
            endLine: i + 1 // 1-based
          }
        }
      }
    }

    // Method not found or ENDMETHOD not found
    return { found: false, code: "", startLine: -1, endLine: -1 }
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ) {
    const {
      objectName,
      objectType,
      startLine = 0,
      lineCount = 50,
      connectionId,
      methodName
    } = options.input

    const confirmationMessages = {
      title: "Get ABAP Object Lines",
      message: new vscode.MarkdownString(
        methodName
          ? `Extract method \`${methodName}\` from class: \`${objectName}\``
          : `Retrieve lines ${startLine}-${startLine + lineCount} from ABAP object: \`${objectName}\`` +
              (objectType ? `\nType: ${objectType}` : "") +
              (connectionId ? ` (connection: ${connectionId})` : "")
      )
    }

    return {
      invocationMessage: methodName
        ? `Extracting method ${methodName} from ${objectName}`
        : `Getting lines from: ${objectName}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let {
      objectName,
      objectType,
      startLine = 1,
      lineCount = 50,
      connectionId,
      methodName
    } = options.input
    logTelemetry("tool_get_abap_object_lines_called", { connectionId })

    // Ensure connectionId is lowercase for consistency
    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    // Convert 1-based line number (user input) to 0-based (array index)
    const arrayStartIndex = Math.max(0, startLine - 1)

    try {
      let actualConnectionId = connectionId

      // If no connectionId provided, try to get from active editor
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error(
            "No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter."
          )
        }
        actualConnectionId = activeEditor.document.uri.authority
      }

      // First, search for the object to get its URI
      const searcher = getSearchService(actualConnectionId)
      const searchTypes = objectType ? [objectType] : undefined
      const searchResults = await searcher.searchObjects(objectName, searchTypes, 1)

      if (!searchResults || searchResults.length === 0) {
        const typeInfo = objectType ? ` of type ${objectType}` : ""
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Could not find ABAP object: ${objectName}${typeInfo}. The object may not exist or may not be accessible.`
          )
        ])
      }

      const objectInfo = searchResults[0]
      if (!objectInfo.uri) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not get URI for ABAP object: ${objectName}.`)
        ])
      }

      // Table/Structure/TableType-aware processing
      if (
        objectInfo.type === "TABL/TA" ||
        objectInfo.type === "TABL" ||
        objectInfo.type === "TABL/DT" ||
        objectInfo.type === "TABL/DS" ||
        objectInfo.type === "TTYP/DA" ||
        objectInfo.type === "TTYP"
      ) {
        try {
          const client = getClient(actualConnectionId)

          let completeStructure = ""

          if (objectInfo.type === "TTYP/DA" || objectInfo.type === "TTYP") {
            const tableTypeInfo = await getTableTypeFromDD(client, objectName)
            if (tableTypeInfo) {
              completeStructure =
                `Complete Structure for ${objectName}:\n` +
                `${"=".repeat(60)}\n` +
                `💡 DD Table Query: Table Type definition from DD40L/DD40T\n` +
                `📊 Source: DD40L (Table Type definitions)\n` +
                `${"=".repeat(60)}\n\n` +
                tableTypeInfo
            }
          } else {
            completeStructure = await getCompleteTableStructure(
              actualConnectionId,
              objectName,
              objectInfo.uri
            )
          }

          if (startLine !== undefined && lineCount !== undefined) {
            const lines = completeStructure.split("\n")
            const totalLines = lines.length
            const endLine = Math.min(startLine + lineCount, totalLines)
            const requestedLines = lines.slice(startLine, endLine)
            const content = requestedLines.join("\n")

            const resultText =
              `**Complete Table Structure for ${objectName}** (lines ${startLine}-${endLine}):\n\n` +
              `${content}\n\n` +
              `• **Total structure lines:** ${totalLines}\n` +
              `• **Lines retrieved:** ${endLine - startLine}` +
              (endLine < totalLines ? "\n• **(More lines available)**" : "") +
              `\n\n💡 **SE11-like Table Access:** This shows the complete table structure including ALL append structures and custom fields.`

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(resultText)
            ])
          } else {
            const resultText =
              `${completeStructure}\n\n` +
              `💡 **SE11-like Table Access:** This shows the complete table structure including ALL append structures and custom fields.`

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(resultText)
            ])
          }
        } catch (tableError) {
          // Continue with standard approach below
        }
      }

      // Standard object processing for non-table objects
      const client = getClient(actualConnectionId)

      let sourceContent = ""
      let uriUsed = ""

      const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri)

      try {
        sourceContent = await client.getObjectSource(optimalUri)
        uriUsed = optimalUri
      } catch (optimizedError) {
        if (optimalUri !== objectInfo.uri) {
          try {
            sourceContent = await client.getObjectSource(objectInfo.uri)
            uriUsed = objectInfo.uri
          } catch (originalError) {
            const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId)
            const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri)

            try {
              sourceContent = await client.getObjectSource(finalUri)
              uriUsed = finalUri
            } catch (finalError) {
              throw new Error(
                `Could not get source content after trying multiple approaches. Last error: ${finalError}`
              )
            }
          }
        } else {
          const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId)
          const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri)

          try {
            sourceContent = await client.getObjectSource(finalUri)
            uriUsed = finalUri
          } catch (finalError) {
            try {
              let ddContent = ""
              if (objectInfo.type === "DTEL/DE" || objectInfo.type === "DTEL") {
                ddContent = await getDataElementFromDD(client, objectName)
              } else if (objectInfo.type === "DOMA/DD" || objectInfo.type === "DOMA") {
                ddContent = await getDomainFromDD(client, objectName)
              } else if (objectInfo.type === "TTYP/DA" || objectInfo.type === "TTYP") {
                ddContent = await getTableTypeFromDD(client, objectName)
              } else if (objectInfo.type === "TABL/DS") {
                ddContent = await getTableStructureFromDD(client, objectName)
              }

              if (ddContent) {
                sourceContent = ddContent
                uriUsed = "DD Tables Query"
              } else {
                throw new Error(
                  `Could not get source content. Optimized error: ${optimizedError}. Resolved error: ${finalError}`
                )
              }
            } catch (ddError) {
              throw new Error(
                `Could not get source content. Optimized error: ${optimizedError}. Resolved error: ${finalError}. DD fallback: ${ddError}`
              )
            }
          }
        }
      }

      if (!sourceContent) {
        throw new Error("Source content is empty")
      }

      const lines = sourceContent.split("\n")
      const totalLines = lines.length

      // Method extraction for classes
      if (
        methodName &&
        (objectInfo.type === "CLAS/OC" ||
          objectInfo.type === "CLAS" ||
          objectInfo.type?.startsWith("CLAS"))
      ) {
        const methodResult = this.extractMethod(lines, methodName)
        if (methodResult.found) {
          const resultText =
            `**Method ${methodName.toUpperCase()}** from class **${objectName}** (lines ${methodResult.startLine}-${methodResult.endLine}):\n\n` +
            `\`\`\`abap\n${methodResult.code}\n\`\`\`\n\n` +
            `• **Total lines in class:** ${totalLines}\n` +
            `• **Method lines:** ${methodResult.endLine - methodResult.startLine + 1}\n` +
            `• **URI used:** \`${uriUsed}\``

          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
        } else {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `❌ Method **${methodName}** not found in class **${objectName}**.\n\n` +
                `💡 Tip: Use search tool with regex \`^\\s*(CLASS-)?METHODS?\\s+\\w+\` to list all methods in this class.`
            )
          ])
        }
      }

      const arrayEndIndex = Math.min(arrayStartIndex + lineCount, totalLines)
      const actualLines = arrayEndIndex - arrayStartIndex

      const requestedLines = lines.slice(arrayStartIndex, arrayEndIndex)
      const content = requestedLines.join("\n")

      let enhancementInfo = ""
      try {
        const enhancements = await getObjectEnhancements(uriUsed, actualConnectionId, false)
        if (enhancements.hasEnhancements) {
          enhancementInfo = `\n\n**🔧 Enhancements Found:** ${enhancements.totalEnhancements}\n`
          for (const enh of enhancements.enhancements) {
            enhancementInfo += `• **${enh.name}** (line ${enh.startLine})\n`
          }
          enhancementInfo += `\n💡 Use the search tool to find specific enhancement code, or call this tool again with the enhancement line ranges.`
        }
      } catch (enhError) {
        // Ignore enhancement errors
      }

      const displayStartLine = startLine
      const displayEndLine = arrayStartIndex + actualLines

      const resultText =
        `Source code lines from **${objectName}** (lines ${displayStartLine}-${displayEndLine}):\n\n` +
        `\`\`\`abap\n${content.trim()}\n\`\`\`\n\n` +
        `• **Total lines in object:** ${totalLines}\n` +
        `• **URI used:** \`${uriUsed}\`\n` +
        `• **Lines retrieved:** ${actualLines}` +
        (arrayEndIndex < totalLines ? "\n• **(More lines available)**" : "") +
        enhancementInfo

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (docError) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Could not access content for ABAP object: ${objectName}. Error: ${docError}`
        )
      ])
    }
  }
  catch(error: any) {
    throw new Error(`Failed to get lines from ABAP object: ${String(error)}`)
  }
}

/**
 * Register the Get Object Lines tool
 */
export function registerGetObjectLinesTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool("get_abap_object_lines", new GetABAPObjectLinesTool())
  )
}
