/**
 * ABAP Transport Management Tool
 * Manage transport requests - view user transports, get details, list objects, compare
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { funWindow as window } from "../funMessenger"
import { abapUri, getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { readTransports } from "../../views/transports"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IManageTransportRequestsParameters {
  action:
    | "get_user_transports"
    | "get_transport_details"
    | "get_transport_objects"
    | "compare_transports"
  connectionId?: string
  user?: string
  transportNumber?: string
  transportNumbers?: string[]
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🚚 MANAGE TRANSPORT REQUESTS TOOL - Direct ADT API access
 *
 * IMPORTANT: Some SAP systems (older versions) may not support
 * direct transport lookup via ADT API. In such cases, the tool may return incorrect transport
 * data. The AI model should ALWAYS verify that the returned transport number matches the
 * requested transport number. If they don't match, inform the user that this feature is not
 * available on their system.
 */
export class ManageTransportRequestsTool implements vscode.LanguageModelTool<IManageTransportRequestsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IManageTransportRequestsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, connectionId, transportNumber, transportNumbers, user } = options.input

    // Validate required parameters based on action
    switch (action) {
      case "get_transport_details":
      case "get_transport_objects":
        if (!transportNumber) {
          throw new Error(`transportNumber is required for ${action} action`)
        }
        break
      case "compare_transports":
        if (!transportNumbers || transportNumbers.length < 2) {
          throw new Error("At least 2 transport numbers are required for compare_transports action")
        }
        break
    }

    let actionDescription = ""
    switch (action) {
      case "get_user_transports":
        actionDescription = `Get transport requests for ${user ? `user ${user}` : "current user"}`
        break
      case "get_transport_details":
        actionDescription = `Get details for transport ${transportNumber}`
        break
      case "get_transport_objects":
        actionDescription = `Get objects in transport ${transportNumber}`
        break
      case "compare_transports":
        actionDescription = `Compare transports: ${transportNumbers?.join(", ")}`
        break
    }

    const confirmationMessages = {
      title: "Manage Transport Requests",
      message: new vscode.MarkdownString(
        actionDescription + (connectionId ? ` (connection: ${connectionId})` : "")
      )
    }

    return {
      invocationMessage: `Managing transport requests: ${action}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IManageTransportRequestsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { action, connectionId, transportNumber, transportNumbers, user } = options.input
    logTelemetry("tool_manage_transport_requests_called", { connectionId })

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

      if (actualConnectionId) {
        actualConnectionId = actualConnectionId.toLowerCase()
      }

      const client = getClient(actualConnectionId)

      switch (action) {
        case "get_user_transports":
          return await this.getUserTransports(client, actualConnectionId, user)

        case "get_transport_details":
          if (!transportNumber) {
            throw new Error("transportNumber is required for get_transport_details action")
          }
          return await this.getTransportDetails(client, transportNumber)

        case "get_transport_objects":
          if (!transportNumber) {
            throw new Error("transportNumber is required for get_transport_objects action")
          }
          return await this.getTransportObjects(client, transportNumber)

        case "compare_transports":
          if (!transportNumbers || transportNumbers.length < 2) {
            throw new Error(
              "At least 2 transport numbers are required for compare_transports action"
            )
          }
          return await this.compareTransports(client, transportNumbers)

        default:
          throw new Error(`Unknown action: ${action}`)
      }
    } catch (error) {
      throw new Error(`Failed to manage transport requests: ${String(error)}`)
    }
  }

  private async getUserTransports(
    client: any,
    connectionId: string,
    user?: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const targetUser = user || client.username

      const transports = await readTransports(connectionId, targetUser)

      let result = `Transport Requests for User: ${targetUser.toUpperCase()}\n`
      result += `${"=".repeat(60)}\n\n`

      let totalCount = 0

      for (const category of ["workbench", "customizing", "transportofcopies"]) {
        const targets = (transports as any)[category]
        if (!targets?.length) continue

        result += `📦 **${category.toUpperCase()}**\n`

        for (const target of targets) {
          result += `  Target: ${target["tm:name"]} - ${target["tm:desc"]}\n`

          for (const status of ["modifiable", "released"]) {
            const transportList = (target as any)[status]
            if (!transportList?.length) continue

            result += `    ${status === "modifiable" ? "🔓" : "🔒"} **${status.toUpperCase()}**:\n`

            for (const transport of transportList) {
              totalCount++
              result += `      • **${transport["tm:number"]}** - ${transport["tm:owner"]} - ${transport["tm:desc"]}\n`
              result += `        Status: ${transport["tm:status"]} | Tasks: ${transport.tasks?.length || 0} | Objects: ${transport.objects?.length || 0}\n`
            }
          }
        }
        result += "\n"
      }

      result += `\n📊 **Summary**: Found ${totalCount} transport requests for user ${targetUser}`

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to get transport requests: ${String(error)}`)
    }
  }

  private async getTransportDetails(
    client: any,
    transportNumber: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const transportData = await client.transportDetails(transportNumber)

      let result = `Transport Details: ${transportNumber}\n`
      result += `${"=".repeat(60)}\n`
      result += `📋 **Number**: ${transportData["tm:number"]}\n`
      result += `👤 **Owner**: ${transportData["tm:owner"]}\n`
      result += `📝 **Description**: ${transportData["tm:desc"]}\n`
      result += `📊 **Status**: ${transportData["tm:status"]}\n`
      result += `📦 **Objects**: ${transportData.objects.length}\n\n`

      if (transportData.tasks.length > 0) {
        result += `📋 **Tasks** (${transportData.tasks.length}):\n`
        for (const task of transportData.tasks) {
          result += `  • **${task["tm:number"]}** - ${task["tm:owner"]} - ${task["tm:desc"]}\n`
          result += `    Status: ${task["tm:status"]} | Objects: ${task.objects.length}\n`
        }
        result += "\n"
      }

      if (transportData.objects.length > 0) {
        result += `📦 **Objects** (${transportData.objects.length}):\n`
        for (const obj of transportData.objects) {
          result += `  • **${obj["tm:name"]}** (${obj["tm:type"]}) - ${obj["tm:obj_info"]}\n`
        }
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      if (String(error).includes("404") || String(error).includes("not found")) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Transport ${transportNumber} not found or your SAP system may not support this ADT feature. This requires newer SAP systems with transport ADT support. Please try using the Transport Organizer view instead.`
          )
        ])
      }

      throw new Error(`Failed to get transport details: ${String(error)}`)
    }
  }

  private async getTransportObjects(
    client: any,
    transportNumber: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const transportData = await client.transportDetails(transportNumber)

      const allObjects: any[] = []

      allObjects.push(
        ...transportData.objects.map((obj: any) => ({ ...obj, source: "main_transport" }))
      )

      for (const task of transportData.tasks) {
        allObjects.push(
          ...task.objects.map((obj: any) => ({ ...obj, source: `task_${task["tm:number"]}` }))
        )
      }

      let result = `Objects in Transport: ${transportNumber}\n`
      result += `${"=".repeat(60)}\n`
      result += `👤 **Main Owner**: ${transportData["tm:owner"]}\n`
      result += `📝 **Description**: ${transportData["tm:desc"]}\n`
      result += `📦 **Total Objects**: ${allObjects.length} (includes main transport + all task objects)\n`
      result += `📋 **Tasks**: ${transportData.tasks.length}\n\n`

      if (allObjects.length === 0) {
        result += "⚠️ No objects found in this transport.\n"
      } else {
        if (transportData.objects.length > 0) {
          result += `📋 **MAIN TRANSPORT** (${transportData.objects.length} objects):\n`
          result += `  👤 Owner: ${transportData["tm:owner"]}\n`
          result += `  📊 Status: ${transportData["tm:status"]}\n\n`

          const mainObjectsByType = transportData.objects.reduce((acc: any, obj: any) => {
            const type = obj["tm:type"]
            if (!acc[type]) acc[type] = []
            acc[type].push(obj)
            return acc
          }, {})

          for (const [type, objects] of Object.entries(mainObjectsByType)) {
            result += `  🗂️ **${type}** (${(objects as any[]).length} objects):\n`
            for (const obj of objects as any[]) {
              result += `    • **${obj["tm:name"]}** - ${obj["tm:obj_info"]}\n`
            }
          }
          result += "\n"
        }

        for (const task of transportData.tasks) {
          result += `📋 **TASK ${task["tm:number"]}** (${task.objects.length} objects):\n`
          result += `  👤 Owner: ${task["tm:owner"]}\n`
          result += `  📝 Description: ${task["tm:desc"]}\n`
          result += `  📊 Status: ${task["tm:status"]}\n\n`

          if (task.objects.length > 0) {
            const taskObjectsByType = task.objects.reduce((acc: any, obj: any) => {
              const type = obj["tm:type"]
              if (!acc[type]) acc[type] = []
              acc[type].push(obj)
              return acc
            }, {})

            for (const [type, objects] of Object.entries(taskObjectsByType)) {
              result += `  🗂️ **${type}** (${(objects as any[]).length} objects):\n`
              for (const obj of objects as any[]) {
                result += `    • **${obj["tm:name"]}** - ${obj["tm:obj_info"]}\n`
              }
            }
          } else {
            result += `  ⚠️ No objects in this task\n`
          }
          result += "\n"
        }
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      if (String(error).includes("404") || String(error).includes("not found")) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Transport ${transportNumber} not found or your SAP system may not support this ADT feature.`
          )
        ])
      }

      throw new Error(`Failed to get transport objects: ${String(error)}`)
    }
  }

  private async compareTransports(
    client: any,
    transportNumbers: string[]
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const transports: any[] = []
      const notFound: string[] = []

      for (const transportNumber of transportNumbers) {
        try {
          const transportData = await client.transportDetails(transportNumber)
          if (transportData["tm:number"] !== transportNumber)
            throw new Error(
              `Transport number mismatch: requested ${transportNumber} but got ${transportData["tm:number"]}. This may indicate that your SAP system does not support transport ADT features.`
            )
          transports.push(transportData)
        } catch (error) {
          notFound.push(transportNumber)
        }
      }

      let result = `Transport Comparison: ${transportNumbers.join(" vs ")}\n`
      result += `${"=".repeat(60)}\n\n`

      if (notFound.length > 0) {
        result += `⚠️ **Not Found**: ${notFound.join(", ")}\n\n`
      }

      if (transports.length < 2) {
        result += `❌ Need at least 2 valid transports for comparison. Found: ${transports.length}\n`
        if (notFound.length > 0) {
          result += `💡 Note: Some transports may not be found if your SAP system doesn't support transport ADT features.\n`
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
      }

      const transportObjects = transports.map(transport => {
        const objects: any[] = []
        objects.push(...transport.objects)
        for (const task of transport.tasks) {
          objects.push(...task.objects)
        }
        return {
          number: transport["tm:number"],
          owner: transport["tm:owner"],
          description: transport["tm:desc"],
          objects: objects
        }
      })

      const allUniqueObjects = new Set<string>()
      transportObjects.forEach(tr => {
        tr.objects.forEach((obj: any) => {
          allUniqueObjects.add(`${obj["tm:pgmid"]}.${obj["tm:type"]}.${obj["tm:name"]}`)
        })
      })

      result += `📊 **Summary**:\n`
      transportObjects.forEach(tr => {
        result += `  • **${tr.number}** (${tr.owner}): ${tr.objects.length} objects\n`
      })
      result += `  • **Total Unique Objects**: ${allUniqueObjects.size}\n\n`

      const commonObjects: any[] = []
      const uniqueObjects: { [key: string]: any[] } = {}

      Array.from(allUniqueObjects).forEach(objKey => {
        const transportsWithObject: string[] = []
        let sampleObject: any = null

        transportObjects.forEach(tr => {
          const hasObject = tr.objects.some(
            (obj: any) => `${obj["tm:pgmid"]}.${obj["tm:type"]}.${obj["tm:name"]}` === objKey
          )
          if (hasObject) {
            transportsWithObject.push(tr.number)
            if (!sampleObject) {
              sampleObject = tr.objects.find(
                (obj: any) => `${obj["tm:pgmid"]}.${obj["tm:type"]}.${obj["tm:name"]}` === objKey
              )
            }
          }
        })

        if (transportsWithObject.length === transports.length) {
          commonObjects.push({ ...sampleObject, transports: transportsWithObject })
        } else {
          transportsWithObject.forEach(trNum => {
            if (!uniqueObjects[trNum]) uniqueObjects[trNum] = []
            uniqueObjects[trNum].push({ ...sampleObject, transports: transportsWithObject })
          })
        }
      })

      if (commonObjects.length > 0) {
        result += `🤝 **COMMON OBJECTS** (${commonObjects.length}) - Objects in ALL transports:\n`
        commonObjects.forEach(obj => {
          result += `  • **${obj["tm:name"]}** (${obj["tm:type"]}) - ${obj["tm:obj_info"]}\n`
        })
        result += "\n"
      } else {
        result += `🤝 **COMMON OBJECTS**: None - No objects appear in all transports\n\n`
      }

      Object.entries(uniqueObjects).forEach(([trNum, objects]) => {
        if (objects.length > 0) {
          result += `🔹 **Unique to ${trNum}** (${objects.length} objects):\n`
          objects.forEach(obj => {
            result += `  • **${obj["tm:name"]}** (${obj["tm:type"]}) - ${obj["tm:obj_info"]}\n`
          })
          result += "\n"
        }
      })

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to compare transports: ${String(error)}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerTransportTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("manage_transport_requests", new ManageTransportRequestsTool())
  )
}
