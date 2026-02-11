/**
 * ABAP Get Object Info Tool
 * Retrieve metadata and information about ABAP objects
 */

import * as vscode from "vscode"
import { funWindow as window } from "../funMessenger"
import { getSearchService } from "../abapSearchService"
import { abapUri } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { getClient } from "../../adt/conections"
import {
  getOptimalObjectURI,
  getObjectEnhancements,
  getTableTypeFromDD,
  getTableStructureFromDD,
  getAppendStructuresFromDD,
  getCompleteTableStructure
} from "./shared"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IGetABAPObjectInfoParameters {
  objectName: string
  connectionId?: string
}

// ============================================================================
// TOOL CLASS
// ============================================================================

export class GetABAPObjectInfoTool implements vscode.LanguageModelTool<IGetABAPObjectInfoParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetABAPObjectInfoParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, connectionId } = options.input

    const confirmationMessages = {
      title: "Get ABAP Object Info",
      message: new vscode.MarkdownString(
        `Get metadata information for ABAP object: \`${objectName}\`` +
          (connectionId ? ` (connection: ${connectionId})` : "")
      )
    }

    return {
      invocationMessage: `Getting info for: ${objectName}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetABAPObjectInfoParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, connectionId } = options.input
    logTelemetry("tool_get_abap_object_info_called", { connectionId })

    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    try {
      let actualConnectionId = connectionId

      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error(
            "No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter."
          )
        }
        actualConnectionId = activeEditor.document.uri.authority
      }

      const searcher = getSearchService(actualConnectionId)
      const searchResults = await searcher.searchObjects(objectName, undefined, 1)

      if (!searchResults || searchResults.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Could not find ABAP object: ${objectName}. The object may not exist or may not be accessible.`
          )
        ])
      }

      const objectInfo = searchResults[0]

      // Get client for DD queries
      const client = getClient(actualConnectionId)

      // Table/Structure/TableType-aware info
      if (
        objectInfo.type === "TABL/TA" ||
        objectInfo.type === "TABL" ||
        objectInfo.type === "TABL/DT" ||
        objectInfo.type === "TABL/DS" ||
        objectInfo.type === "TTYP/DA" ||
        objectInfo.type === "TTYP"
      ) {
        if (objectInfo.uri) {
          try {
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

            const structureLines = completeStructure.split("\n")

            // Count append structures from the structure content
            let appendCount = 0
            const appendMatches = completeStructure.match(/ALL APPEND STRUCTURES \((\d+)\):/)
            if (appendMatches) {
              appendCount = parseInt(appendMatches[1], 10)
            } else {
              // Fallback: count individual append structure markers
              const individualAppends = (completeStructure.match(/• [A-Z_]+ \(\d+ fields\)/g) || [])
                .length
              appendCount = individualAppends
            }

            let mainTableLines = 0
            let inMainSection = false

            for (const line of structureLines) {
              if (line.includes("MAIN TABLE STRUCTURE:")) {
                inMainSection = true
              } else if (line.includes("APPEND STRUCTURES")) {
                inMainSection = false
              } else if (inMainSection && line.trim().length > 0) {
                mainTableLines++
              }
            }

            const hasAppendStructures = appendCount > 0

            const tableResultText =
              `**${objectName}** Enhanced Table Information:\n\n` +
              `• **Object Type:** ${objectInfo.type} (Database Table)\n` +
              `• **Description:** ${objectInfo.description || "No description available"}\n` +
              `• **Package:** ${objectInfo.package || "Unknown"}\n` +
              `• **System Type:** ${objectInfo.systemType}\n` +
              `• **Total Lines:** ${structureLines.length}\n` +
              `• **Append Structures:** ${appendCount}\n` +
              `• **Has Custom Fields/Append Structures:** ${hasAppendStructures ? "✅ Yes" : "❌ No"}\n` +
              `• **SE11-like Structure Access:** ✅ Available\n` +
              `• **URI:** \`${objectInfo.uri}\`\n\n` +
              `💡 **Enhanced Table Info:** This table ${hasAppendStructures ? `includes ${appendCount} custom append structure(s) with additional fields` : "has no append structures"}. `

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(tableResultText)
            ])
          } catch {
            // Continue with standard approach
          }
        }
      }

      // Standard object info
      let totalLines = "Unknown"
      let uriUsed = "Not determined"
      let enhancementInfo = ""

      if (objectInfo.uri) {
        const client = getClient(actualConnectionId)

        const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri)

        try {
          const sourceContent = await client.getObjectSource(optimalUri)
          const lines = sourceContent.split("\n")
          totalLines = lines.length.toString()
          uriUsed = optimalUri
        } catch {
          if (optimalUri !== objectInfo.uri) {
            try {
              const sourceContent = await client.getObjectSource(objectInfo.uri)
              const lines = sourceContent.split("\n")
              totalLines = lines.length.toString()
              uriUsed = objectInfo.uri
            } catch {
              uriUsed = "Access failed"
            }
          } else {
            uriUsed = "Access failed"
          }
        }

        try {
          const enhancementResult = await getObjectEnhancements(
            optimalUri,
            actualConnectionId,
            false
          )
          if (enhancementResult.hasEnhancements) {
            enhancementInfo =
              `\n• **Enhancements:** ${enhancementResult.totalEnhancements} enhancement(s) found\n` +
              enhancementResult.enhancements
                .map(enh => `  - ${enh.name} (line ${enh.startLine})`)
                .join("\n")
          } else {
            enhancementInfo = "\n• **Enhancements:** No enhancements found"
          }
        } catch {
          enhancementInfo = "\n• **Enhancements:** Could not check enhancements"
        }
      }

      const resultText =
        `**${objectName}** Information:\n\n` +
        `• **Object Type:** ${objectInfo.type}\n` +
        `• **Description:** ${objectInfo.description || "No description available"}\n` +
        `• **Package:** ${objectInfo.package || "Unknown"}\n` +
        `• **System Type:** ${objectInfo.systemType}\n` +
        `• **Total Lines:** ${totalLines}\n` +
        `• **URI:** \`${objectInfo.uri || "Not available"}\`\n` +
        `• **URI Used:** \`${uriUsed}\`` +
        enhancementInfo

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      throw new Error(`Failed to get info for ABAP object: ${String(error)}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetObjectInfoTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool("get_abap_object_info", new GetABAPObjectInfoTool())
  )
}
