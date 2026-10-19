import * as vscode from "vscode"

import { AgentManager } from "./core/AgentManager"
import { ConnectionManager } from "./core/ConnectionManager"
import { SessionManager } from "./core/SessionManager"
import { SessionHistoryStore } from "./core/SessionHistoryStore"
import { SessionUpdateHandler } from "./handlers/SessionUpdateHandler"
import { StatusBarManager } from "./ui/StatusBarManager"
import { ChatWebviewProvider } from "./ui/ChatWebviewProvider"
import { showSessionHistory } from "./ui/SessionHistoryPicker"
import {
  ACP_CONFIG_SECTION,
  addAgentInteractive,
  getAgentNames,
  removeAgentInteractive
} from "./config/AgentConfig"
import { log, logError, disposeChannels, getOutputChannel, getTrafficChannel } from "./utils/Logger"
import { sendEvent } from "./utils/TelemetryManager"
import { initAgentRoot } from "./fs/AbapPathMapper"

const ENABLED_KEY = "enabled"
const CONNECTED_CONTEXT = "abapfs.acp.connected"

function isAcpEnabled(): boolean {
  return vscode.workspace.getConfiguration(ACP_CONFIG_SECTION).get<boolean>(ENABLED_KEY, false)
}

/**
 * Optional ACP agent chat. Everything is started only while `abapfs.acp.enabled` is set,
 * and torn down (agents killed) as soon as it is cleared.
 */
export function registerAcpFeature(context: vscode.ExtensionContext): void {
  let running: vscode.Disposable | undefined
  const sync = () => {
    const enabled = isAcpEnabled()
    if (enabled && !running) {
      running = startAcp(context)
    }
    if (!enabled && running) {
      running.dispose()
      running = undefined
    }
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(`${ACP_CONFIG_SECTION}.${ENABLED_KEY}`)) {
        return
      }
      const wasRunning = !!running
      sync()
      if (running && !wasRunning) {
        void vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`)
      }
    }),
    { dispose: () => running?.dispose() }
  )
  sync()
}

const ADD_AGENT_ITEM = "$(add) Add agent..."

/** Pick a configured agent, offering to add one; returns undefined when cancelled */
async function pickAgentName(): Promise<string | undefined> {
  const names = getAgentNames()
  if (!names.length) {
    return addAgentInteractive()
  }
  if (names.length === 1) {
    return names[0]
  }
  const picked = await vscode.window.showQuickPick([...names, ADD_AGENT_ITEM], {
    placeHolder: "Select an ACP agent"
  })
  return picked === ADD_AGENT_ITEM ? addAgentInteractive() : picked
}

function registerAgentManagementCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand("abapfs.acp.addAgent", async () => {
      const name = await addAgentInteractive()
      if (!name) {
        return
      }
      const choice = await vscode.window.showInformationMessage(`Agent "${name}" added.`, "Connect")
      if (choice) {
        await vscode.commands.executeCommand("abapfs.acp.connectAgent", name)
      }
    }),
    vscode.commands.registerCommand("abapfs.acp.removeAgent", async () => {
      const name = await removeAgentInteractive()
      if (name) {
        vscode.window.showInformationMessage(`Agent "${name}" removed.`)
      }
    }),
    vscode.commands.registerCommand("abapfs.acp.manageAgents", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${ACP_CONFIG_SECTION}.agents`
      )
    )
  )
}

function startAcp(context: vscode.ExtensionContext): vscode.Disposable {
  log("ACP agent chat starting...")
  initAgentRoot(context.globalStorageUri.fsPath)

  // --- Core services ---
  const sessionUpdateHandler = new SessionUpdateHandler()
  const agentManager = new AgentManager()
  const connectionManager = new ConnectionManager(sessionUpdateHandler)
  const sessionManager = new SessionManager(agentManager, connectionManager, sessionUpdateHandler)
  const historyStore = new SessionHistoryStore(context.workspaceState)
  sessionManager.setHistoryStore(historyStore)

  // --- UI ---
  const chatWebviewProvider = new ChatWebviewProvider(
    context.extensionUri,
    sessionManager,
    sessionUpdateHandler
  )
  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    ChatWebviewProvider.viewType,
    chatWebviewProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  )

  const statusBarManager = new StatusBarManager(sessionManager)

  // Notify chat webview when active session changes
  sessionManager.on("active-session-changed", () => {
    chatWebviewProvider.notifyActiveSessionChanged()
    void vscode.commands.executeCommand(
      "setContext",
      CONNECTED_CONTEXT,
      !!sessionManager.getActiveSessionId()
    )
  })

  // The conversation stays in history; a disconnected chat shows only the welcome screen
  sessionManager.on("agent-disconnected", () => {
    if (!sessionManager.getActiveSessionId()) {
      chatWebviewProvider.clearChat()
    }
  })

  // Clear chat when new conversation is started
  sessionManager.on("clear-chat", () => {
    chatWebviewProvider.clearChat()
  })

  // session/load replays the conversation; the webview shows a loading state meanwhile
  sessionManager.on("session-load-start", () => chatWebviewProvider.notifyLoadSessionStart())
  sessionManager.on("session-load-end", (_sessionId: string, _agentName: string, ok: boolean) => {
    chatWebviewProvider.notifyLoadSessionEnd(ok)
  })

  // Forward mode/model changes to webview
  sessionManager.on("mode-changed", (_sessionId: string, _modeId: string) => {
    const session = sessionManager.getActiveSession()
    if (session?.modes) {
      chatWebviewProvider.notifyModesUpdate(session.modes)
    }
  })

  sessionManager.on("model-changed", (_sessionId: string, _modelId: string) => {
    const session = sessionManager.getActiveSession()
    if (session?.models) {
      chatWebviewProvider.notifyModelsUpdate(session.models)
    }
  })

  // Session metadata (title) update — forward to chat banner.
  sessionManager.on("session-info-changed", (sessionId: string, update: any) => {
    if (sessionId !== sessionManager.getActiveSessionId()) {
      return
    }
    chatWebviewProvider.notifySessionInfoUpdate(update?.title)
  })

  // --- Commands ---

  // Connect to the requested agent, asking the user when several are configured.
  const connectAgentCmd = vscode.commands.registerCommand(
    "abapfs.acp.connectAgent",
    async (agentNameOrItem?: string | any) => {
      const agentName =
        typeof agentNameOrItem === "string"
          ? agentNameOrItem
          : agentNameOrItem?.agentName || (await pickAgentName())
      if (!agentName) {
        return
      }

      // If switching agents and there's chat content, confirm
      const currentAgent = sessionManager.getActiveAgentName()
      if (currentAgent && currentAgent !== agentName && chatWebviewProvider.hasChatContent) {
        const choice = await vscode.window.showWarningMessage(
          `Switch to ${agentName}? This will disconnect ${currentAgent} and clear the chat history.`,
          "Switch Agent",
          "Cancel"
        )
        if (choice !== "Switch Agent") {
          return
        }
        chatWebviewProvider.clearChat()
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${agentName}...`,
            cancellable: false
          },
          async () => {
            await sessionManager.connectToAgent(agentName!)
          }
        )
      } catch (e: any) {
        logError("Failed to connect to agent", e)
        vscode.window.showErrorMessage(`Failed to connect: ${e.message}`)
      }
    }
  )

  // New Conversation (disconnect + clear chat + reconnect same agent)
  const newConversationCmd = vscode.commands.registerCommand(
    "abapfs.acp.newConversation",
    async () => {
      const activeSession = sessionManager.getActiveSession()
      if (!activeSession) {
        // No active agent — fall back to connect
        await vscode.commands.executeCommand("abapfs.acp.connectAgent")
        return
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Starting new conversation with ${activeSession.agentDisplayName}...`,
            cancellable: false
          },
          async () => {
            await sessionManager.newConversation()
          }
        )
      } catch (e: any) {
        logError("Failed to start new conversation", e)
        vscode.window.showErrorMessage(`Failed to start new conversation: ${e.message}`)
      }
    }
  )

  const showHistoryCmd = vscode.commands.registerCommand("abapfs.acp.showHistory", () =>
    showSessionHistory(sessionManager, chatWebviewProvider)
  )

  // Disconnect Agent
  const disconnectAgentCmd = vscode.commands.registerCommand(
    "abapfs.acp.disconnectAgent",
    async (item?: any) => {
      const agentName = item?.agentName || sessionManager.getActiveAgentName()
      if (!agentName) {
        vscode.window.showInformationMessage("No agent connected.")
        return
      }
      await sessionManager.disconnectAgent(agentName)
      vscode.window.showInformationMessage(`Disconnected from ${agentName}.`)
    }
  )

  // Open Chat
  const openChatCmd = vscode.commands.registerCommand("abapfs.acp.openChat", () => {
    vscode.commands.executeCommand("abapfs.views.agentChat.focus")
  })

  // Send Prompt (from keybinding — just focus chat)
  const sendPromptCmd = vscode.commands.registerCommand("abapfs.acp.sendPrompt", async () => {
    vscode.commands.executeCommand("abapfs.views.agentChat.focus")
  })

  // Cancel Turn
  const cancelTurnCmd = vscode.commands.registerCommand("abapfs.acp.cancelTurn", async () => {
    const activeId = sessionManager.getActiveSessionId()
    if (activeId) {
      try {
        await sessionManager.cancelTurn(activeId)
      } catch (e) {
        logError("Cancel failed", e)
      }
    }
  })

  // Restart Agent
  const restartAgentCmd = vscode.commands.registerCommand("abapfs.acp.restartAgent", async () => {
    const activeSession = sessionManager.getActiveSession()
    if (!activeSession) {
      return
    }

    const agentName = activeSession.agentName
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restarting ${activeSession.agentDisplayName}...`,
          cancellable: false
        },
        async () => {
          await sessionManager.disconnectAgent(agentName)
          await sessionManager.connectToAgent(agentName)
        }
      )
      vscode.window.showInformationMessage(`Restarted ${agentName}`)
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to restart: ${e.message}`)
    }
  })

  // Show Log
  const showLogCmd = vscode.commands.registerCommand("abapfs.acp.showLog", () => {
    sendEvent("command/showLog")
    getOutputChannel().show()
  })

  // Show Traffic
  const showTrafficCmd = vscode.commands.registerCommand("abapfs.acp.showTraffic", () => {
    sendEvent("command/showTraffic")
    getTrafficChannel().show()
  })

  // Set Mode
  const setModeCmd = vscode.commands.registerCommand(
    "abapfs.acp.setMode",
    async (modeId?: string) => {
      const activeId = sessionManager.getActiveSessionId()
      if (!activeId) {
        return
      }

      if (!modeId) {
        modeId =
          (await vscode.window.showInputBox({
            placeHolder: 'Enter mode ID (e.g., "plan", "code")',
            title: "Set Agent Mode"
          })) || undefined
      }
      if (modeId) {
        try {
          await sessionManager.setMode(activeId, modeId)
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to set mode: ${e.message}`)
        }
      }
    }
  )

  // Set Model
  const setModelCmd = vscode.commands.registerCommand(
    "abapfs.acp.setModel",
    async (modelId?: string) => {
      const activeId = sessionManager.getActiveSessionId()
      if (!activeId) {
        return
      }

      if (!modelId) {
        modelId =
          (await vscode.window.showInputBox({
            placeHolder: "Enter model ID",
            title: "Set Agent Model"
          })) || undefined
      }
      if (modelId) {
        try {
          await sessionManager.setModel(activeId, modelId)
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to set model: ${e.message}`)
        }
      }
    }
  )

  // Attach File
  const attachFileCmd = vscode.commands.registerCommand("abapfs.acp.attachFile", async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach",
      title: "Attach Files to Chat"
    })
    for (const uri of uris || []) {
      chatWebviewProvider.attachFile(uri)
    }
  })

  log("ACP agent chat started.")
  return vscode.Disposable.from(
    registerAgentManagementCommands(),
    chatViewRegistration,
    statusBarManager,
    connectAgentCmd,
    newConversationCmd,
    showHistoryCmd,
    disconnectAgentCmd,
    openChatCmd,
    sendPromptCmd,
    cancelTurnCmd,
    restartAgentCmd,
    showLogCmd,
    showTrafficCmd,
    setModeCmd,
    setModelCmd,
    attachFileCmd,
    {
      dispose: () => {
        sessionManager.dispose()
        sessionUpdateHandler.dispose()
        chatWebviewProvider.dispose()
        historyStore.dispose()
        void vscode.commands.executeCommand("setContext", CONNECTED_CONTEXT, false)
        disposeChannels()
      }
    }
  )
}
