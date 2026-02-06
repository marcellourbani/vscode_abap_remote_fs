/**
 * 💓 Heartbeat LM Client
 *
 * Handles Language Model API calls for heartbeat runs.
 * Uses vscode.lm API to call the model with all registered tools.
 *
 * Reads tasks from heartbeat.json and instructs the LLM to check each one.
 * The LLM can also update task status and add/remove tasks.
 */

import * as vscode from "vscode"
import { HeartbeatConfig, parseHeartbeatResponse, HEARTBEAT_OK_TOKEN } from "./heartbeatTypes"
import { HeartbeatWatchlist } from "./heartbeatWatchlist"
import { log } from "../../lib"

/**
 * Result from running a single heartbeat
 */
export interface HeartbeatLMResult {
  status: "ok" | "alert" | "error"
  response: string
  toolsUsed: string[]
  durationMs: number
  error?: string
}

/**
 * Build the heartbeat prompt from config and watchlist
 */
function buildHeartbeatPrompt(config: HeartbeatConfig): string {
  // If custom prompt is configured, use it directly
  if (config.prompt) {
    return config.prompt
  }

  // Get tasks from watchlist (only due tasks, not future-scheduled ones)
  const watchlistPrompt = HeartbeatWatchlist.formatForPrompt()
  const dueTasks = HeartbeatWatchlist.getDueTasks()
  const hasAnyDueTasks = dueTasks.length > 0

  const lines = [
    "# Heartbeat Check",
    "",
    "You are a background assistant checking on SAP systems and other tasks.",
    "Your response will be PARSED BY A SYSTEM, not read directly by the user.",
    "You must follow the rules precisely, or your notifications will not reach the user.",
    "",
    `## CRITICAL: About ${HEARTBEAT_OK_TOKEN}`,
    `If your response contains "${HEARTBEAT_OK_TOKEN}" ANYWHERE, NO ALERT will be shown to the user.`,
    `Only include ${HEARTBEAT_OK_TOKEN} when there is genuinely NOTHING to notify.`,
    `If you have something to tell the user but accidentally include ${HEARTBEAT_OK_TOKEN}, they will MISS IT.`,
    "",
    "---",
    "",
    watchlistPrompt,
    "",
    "---",
    ""
  ]

  if (hasAnyDueTasks) {
    lines.push("## REQUIRED ACTIONS FOR EACH TASK:")
    lines.push("")
    lines.push("**You MUST process each task listed above. Do not skip tasks!**")
    lines.push("")
    lines.push("### For Reminders (category: reminder):")
    lines.push("1. Notify the user with the reminder message in your response")
    lines.push('2. Call manage_heartbeat with action "remove_task" to delete it')
    lines.push("")
    lines.push("### For Monitoring Tasks with SQL:")
    lines.push("1. Call execute_data_query with the provided sampleQuery")
    lines.push("2. Follow the checkInstructions to interpret results")
    lines.push('3. Call manage_heartbeat "update_task" to save your findings in lastResult')
    lines.push("4. If new issues found AND not in cooldown → include alert in your response")
    lines.push("")
    lines.push("### For Tasks using analyze_abap_dumps:")
    lines.push('1. Call analyze_abap_dumps with action "list_dumps"')
    lines.push("2. Compare against lastNotifiedFindings for new dumps")
    lines.push("3. Update task with findings")
    lines.push("")
    lines.push("### Cooldown Handling:")
    lines.push('- If "⏸️ Cooldown Active" is shown, still CHECK and UPDATE the task')
    lines.push("- Just don't include an alert for that task in your response")
    lines.push("")
    lines.push("---")
    lines.push("")
    lines.push("## YOUR RESPONSE:")
    lines.push("")
    lines.push(
      `If ALL tasks were checked and there's NOTHING to tell the user → respond with EXACTLY: ${HEARTBEAT_OK_TOKEN}`
    )
    lines.push("(No quotes, no markdown, no punctuation, no extra text - just that single token)")
    lines.push("")
    lines.push(
      "If there ARE things to tell the user (reminders, new issues) → write a helpful message describing them."
    )
    lines.push(`Do NOT include ${HEARTBEAT_OK_TOKEN} in alert messages.`)
    lines.push("")
    lines.push("**Remember: Check every task, update every task, but only ALERT when needed.**")
  } else {
    lines.push(`No tasks are due right now. Respond with: ${HEARTBEAT_OK_TOKEN}`)
  }

  return lines.join("\n")
}

// Tag used to identify ABAP FS tools
const ABAP_FS_TAG = "abap-fs"

/**
 * Get the configured language model
 * REQUIRES model to be set in settings - does not auto-select
 */
async function getLanguageModel(
  configuredModel?: string
): Promise<vscode.LanguageModelChat | null> {
  try {
    // Model must be configured in settings
    if (!configuredModel || configuredModel.trim().length === 0) {
      log("💓 No model configured. Set abapfs.heartbeat.model in settings.")
      return null
    }

    const models = await vscode.lm.selectChatModels({})

    if (models.length === 0) {
      log("💓 No language models available")
      return null
    }

    const searchTerm = configuredModel.trim().toLowerCase()

    // Find the configured model - try exact match first, then partial
    let model = models.find(
      m => m.name.toLowerCase() === searchTerm || m.id.toLowerCase() === searchTerm
    )

    // If no exact match, try partial match on name only
    if (!model) {
      model = models.find(m => m.name.toLowerCase().includes(searchTerm))
    }

    if (!model) {
      const available = models.map(m => `"${m.name}"`).join(", ")
      log(`💓 Model '${configuredModel}' not found. Available: ${available}`)
      return null
    }

    return model
  } catch (error) {
    log(`💓 Error getting language model: ${error}`)
    return null
  }
}

/**
 * Get ABAP FS tools only (filtered by tag)
 */
function getAbapFsTools(): vscode.LanguageModelToolInformation[] {
  try {
    const allTools = Array.from(vscode.lm.tools)
    const abapTools = allTools.filter(tool => tool.tags.includes(ABAP_FS_TAG))
    return abapTools
  } catch (error) {
    log(`💓 Error getting LM tools: ${error}`)
    return []
  }
}

/**
 * Run a single heartbeat using the Language Model API
 */
export async function runHeartbeatLM(
  config: HeartbeatConfig,
  cancellationToken?: vscode.CancellationToken
): Promise<HeartbeatLMResult> {
  const startTime = Date.now()
  const toolsUsed: string[] = []

  try {
    // Get language model
    const model = await getLanguageModel(config.model)
    if (!model) {
      const errorMsg = config.model
        ? `Model '${config.model}' not found. Check abapfs.heartbeat.model setting.`
        : "No model configured. Set abapfs.heartbeat.model in settings."
      return {
        status: "error",
        response: "",
        toolsUsed: [],
        durationMs: Date.now() - startTime,
        error: errorMsg
      }
    }

    // Build the prompt
    const prompt = buildHeartbeatPrompt(config)

    // Get ABAP FS tools only (filtered by tag)
    const tools = getAbapFsTools()

    // Create the message
    const messages = [vscode.LanguageModelChatMessage.User(prompt)]

    // Prepare request options with tools
    const requestOptions: vscode.LanguageModelChatRequestOptions = {
      tools: tools.length > 0 ? tools : undefined
    }

    // Send request and collect response
    let fullResponse = ""
    const token = cancellationToken || new vscode.CancellationTokenSource().token

    // Handle tool calls in a loop
    let currentMessages = [...messages]
    let maxIterations = 10 // Prevent infinite loops

    while (maxIterations > 0) {
      maxIterations--

      const response = await model.sendRequest(currentMessages, requestOptions, token)

      let hasToolCalls = false
      let textParts: string[] = []

      // Process the response stream
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value)
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          hasToolCalls = true
          const toolName = part.name
          toolsUsed.push(toolName)

          try {
            // Execute the tool
            const toolResult = await vscode.lm.invokeTool(
              toolName,
              {
                input: part.input,
                toolInvocationToken: undefined
              },
              token
            )

            // Add assistant message with tool call
            currentMessages.push(vscode.LanguageModelChatMessage.Assistant([part]))

            // Extract text from tool result
            let resultText = ""
            if (toolResult && typeof toolResult === "object" && "content" in toolResult) {
              const content = (toolResult as { content: unknown }).content
              if (Array.isArray(content)) {
                resultText = content
                  .filter(
                    (p: unknown) =>
                      p &&
                      typeof p === "object" &&
                      "value" in (p as Record<string, unknown>) &&
                      typeof (p as Record<string, unknown>).value === "string"
                  )
                  .map((p: unknown) => (p as { value: string }).value)
                  .join("\n")
              }
            } else if (typeof toolResult === "string") {
              resultText = toolResult
            } else {
              resultText = JSON.stringify(toolResult)
            }

            currentMessages.push(
              vscode.LanguageModelChatMessage.User([
                new vscode.LanguageModelToolResultPart(part.callId, [
                  new vscode.LanguageModelTextPart(resultText)
                ])
              ])
            )
          } catch (toolError) {
            log(`💓 Tool error (${toolName}): ${toolError}`)

            // Add error result
            currentMessages.push(vscode.LanguageModelChatMessage.Assistant([part]))
            currentMessages.push(
              vscode.LanguageModelChatMessage.User([
                new vscode.LanguageModelToolResultPart(part.callId, [
                  new vscode.LanguageModelTextPart(`Error: ${toolError}`)
                ])
              ])
            )
          }
        }
      }

      // Collect text response
      if (textParts.length > 0) {
        fullResponse += textParts.join("")
      }

      // If no tool calls, we're done
      if (!hasToolCalls) {
        break
      }
    }

    const durationMs = Date.now() - startTime

    // Parse the response
    const parsed = parseHeartbeatResponse(fullResponse, config.ackMaxChars)

    if (parsed.isAck) {
      return {
        status: "ok",
        response: parsed.cleanedResponse || HEARTBEAT_OK_TOKEN,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs
      }
    } else {
      return {
        status: "alert",
        response: parsed.cleanedResponse || fullResponse,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs
      }
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    log(`💓 Heartbeat error: ${errorMessage}`)

    return {
      status: "error",
      response: "",
      toolsUsed: [...new Set(toolsUsed)],
      durationMs,
      error: errorMessage
    }
  }
}
