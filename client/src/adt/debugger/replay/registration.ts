import { commands, debug, DebugConfigurationProviderTriggerKind, ExtensionContext, Uri } from "vscode"
import { ReplayAdapterFactory, ReplayConfigurationProvider, REPLAY_DEBUG_TYPE } from "./replayAdapterFactory"
import { DEBUGTYPE } from "../abapConfigurationProvider"
import { DebugRecorder } from "./debugRecorder"
import { saveRecording, loadRecordingFromUri } from "./recordingIO"
import { funWindow as window } from "../../../services/funMessenger"
import { log } from "../../../lib"

/** Singleton recorder shared across debug sessions */
let activeRecorder: DebugRecorder | undefined

export function getActiveRecorder(): DebugRecorder | undefined {
  return activeRecorder
}

export function setActiveRecorder(recorder: DebugRecorder | undefined) {
  activeRecorder = recorder
}

/**
 * Registers the replay debugger adapter, configuration provider, and commands.
 */
export function registerReplayDebugger(context: ExtensionContext) {
  const factory = ReplayAdapterFactory.instance
  const provider = new ReplayConfigurationProvider()

  const factoryReg = debug.registerDebugAdapterDescriptorFactory(REPLAY_DEBUG_TYPE, factory)
  const providerReg = debug.registerDebugConfigurationProvider(
    REPLAY_DEBUG_TYPE,
    provider,
    DebugConfigurationProviderTriggerKind.Dynamic
  )

  context.subscriptions.push(
    factoryReg,
    providerReg,
    commands.registerCommand("abapfs.startRecording", startRecordingCommand),
    commands.registerCommand("abapfs.stopRecording", stopRecordingCommand),
    commands.registerCommand("abapfs.replaySession", replaySessionCommand),
    // Auto-stop recording when the live ABAP debug session terminates
    debug.onDidTerminateDebugSession(session => {
      if (session.type === DEBUGTYPE && activeRecorder?.isRecording) {
        log("ABAP debug session ended, auto-stopping recording")
        autoStopRecording()
      }
    })
  )
}

async function startRecordingCommand() {
  if (activeRecorder?.isRecording) {
    window.showInformationMessage("Already recording")
    return
  }

  // Find the active ABAP debug session
  const session = debug.activeDebugSession
  if (!session || session.type !== DEBUGTYPE) {
    window.showErrorMessage("No active ABAP debug session. Start debugging first.")
    return
  }

  const connId = session.configuration.connId
  if (!connId) {
    window.showErrorMessage("Cannot determine connection ID from debug session")
    return
  }

  activeRecorder = new DebugRecorder()
  activeRecorder.startRecording(connId)
  window.showInformationMessage("⏺ Recording started")
}

async function stopRecordingCommand() {
  if (!activeRecorder?.isRecording) {
    window.showInformationMessage("No active recording")
    return
  }

  const recording = await activeRecorder.stopRecording()
  activeRecorder = undefined

  if (!recording || recording.totalSteps === 0) {
    window.showInformationMessage("No steps recorded")
    return
  }

  const action = await window.showInformationMessage(
    `Recording complete: ${recording.totalSteps} steps. Save?`,
    "Save",
    "Discard"
  )
  if (action === "Save") {
    await saveRecording(recording)
  }
}

async function replaySessionCommand(fileUri?: Uri) {
  let recording
  if (fileUri) {
    recording = await loadRecordingFromUri(fileUri)
    if (!recording) return // load failed, error already shown
  }

  if (recording) {
    ReplayAdapterFactory.instance.setPendingRecording(recording)
  }

  const started = await debug.startDebugging(undefined, {
    type: REPLAY_DEBUG_TYPE,
    request: "launch",
    name: "Replay ABAP Recording"
  })
  if (!started) {
    ReplayAdapterFactory.instance.clearPendingRecording()
  }
}

async function autoStopRecording() {
  if (!activeRecorder) return
  const recording = await activeRecorder.stopRecording()
  activeRecorder = undefined
  if (!recording || recording.totalSteps === 0) return
  const action = await window.showInformationMessage(
    `Debug session ended. Save recording (${recording.totalSteps} steps)?`,
    "Save",
    "Discard"
  )
  if (action === "Save") {
    await saveRecording(recording)
  }
}
