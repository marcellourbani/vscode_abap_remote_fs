import * as vscode from "vscode"
import { log, logError } from "../utils/Logger"
import { agentWorkspaceRoot, isLocalPath } from "../fs/AbapPathMapper"

import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse
} from "@agentclientprotocol/sdk"

import { spawn, ChildProcess } from "node:child_process"

interface ManagedTerminal {
  id: string
  process: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode: number | null
  exitSignal: string | null
  exited: boolean
  exitPromise: Promise<void>
  vsTerminal?: vscode.Terminal
}

/**
 * Manages terminals that ACP agents request (terminal/create, terminal/output, etc.).
 * Uses real child processes for capturing output, with VS Code terminals for display.
 */
export class TerminalHandler {
  private terminals: Map<string, ManagedTerminal> = new Map()
  private nextId = 1

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term_${this.nextId++}`
    const outputByteLimit = params.outputByteLimit ?? 1024 * 1024 // 1MB default

    log(`createTerminal: ${params.command} ${(params.args || []).join(" ")} (id=${terminalId})`)

    const env: Record<string, string> = { ...process.env } as Record<string, string>
    if (params.env) {
      for (const v of params.env) {
        env[v.name] = v.value
      }
    }

    // A cwd inside the ADT mount has no local directory behind it
    const cwd =
      params.cwd && isLocalPath(params.cwd) ? params.cwd : agentWorkspaceRoot() || undefined
    const child = spawn(params.command, params.args || [], {
      cwd,
      env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    })

    let output = ""
    let truncated = false

    const appendOutput = (data: Buffer) => {
      const text = data.toString()
      output += text
      // Truncate from beginning if over limit
      const byteLength = Buffer.byteLength(output, "utf-8")
      if (byteLength > outputByteLimit) {
        const excess = byteLength - outputByteLimit
        // Find a safe character boundary to truncate at
        let cutPoint = 0
        let bytes = 0
        for (let i = 0; i < output.length; i++) {
          bytes += Buffer.byteLength(output[i], "utf-8")
          if (bytes >= excess) {
            cutPoint = i + 1
            break
          }
        }
        output = output.substring(cutPoint)
        truncated = true
      }
    }

    child.stdout?.on("data", appendOutput)
    child.stderr?.on("data", appendOutput)

    const exitPromise = new Promise<void>(resolve => {
      child.on("close", (code, signal) => {
        const managed = this.terminals.get(terminalId)
        if (managed) {
          managed.exitCode = code
          managed.exitSignal = signal
          managed.exited = true
        }
        resolve()
      })
      child.on("error", () => {
        resolve()
      })
    })

    // Also create a VS Code terminal for visual output
    const writeEmitter = new vscode.EventEmitter<string>()
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open() {
        writeEmitter.fire(`$ ${params.command} ${(params.args || []).join(" ")}\r\n`)
      },
      close() {
        /* no-op */
      }
    }
    const vsTerminal = vscode.window.createTerminal({
      name: `Agent: ${params.command}`,
      pty
    })

    // Stream output to VS Code terminal
    child.stdout?.on("data", (data: Buffer) => {
      writeEmitter.fire(data.toString().replace(/\n/g, "\r\n"))
    })
    child.stderr?.on("data", (data: Buffer) => {
      writeEmitter.fire(data.toString().replace(/\n/g, "\r\n"))
    })

    const managed: ManagedTerminal = {
      id: terminalId,
      process: child,
      output: "",
      truncated: false,
      outputByteLimit,
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise,
      vsTerminal
    }

    // Keep output reference updated
    const timer = setInterval(() => {
      managed.output = output
      managed.truncated = truncated
    }, 100)

    child.on("close", () => {
      managed.output = output
      managed.truncated = truncated
      clearInterval(timer)
    })

    this.terminals.set(terminalId, managed)

    return { terminalId }
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const managed = this.terminals.get(params.terminalId)
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    const response: TerminalOutputResponse = {
      output: managed.output,
      truncated: managed.truncated
    }

    if (managed.exited) {
      response.exitStatus = {
        exitCode: managed.exitCode,
        signal: managed.exitSignal
      }
    }

    return response
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    const managed = this.terminals.get(params.terminalId)
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    await managed.exitPromise

    return {
      exitCode: managed.exitCode,
      signal: managed.exitSignal
    }
  }

  async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const managed = this.terminals.get(params.terminalId)
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    try {
      managed.process.kill("SIGTERM")
    } catch (e) {
      logError(`Failed to kill terminal ${params.terminalId}`, e)
    }

    return {}
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const managed = this.terminals.get(params.terminalId)
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    log(`releaseTerminal: ${params.terminalId}`)

    // Kill if still running
    if (!managed.exited) {
      try {
        managed.process.kill("SIGTERM")
      } catch {
        // ignore
      }
    }

    // Don't dispose VS Code terminal — keep output visible per ACP spec
    this.terminals.delete(params.terminalId)

    return {}
  }

  dispose(): void {
    for (const [, managed] of this.terminals) {
      try {
        if (!managed.exited) {
          managed.process.kill("SIGKILL")
        }
        managed.vsTerminal?.dispose()
      } catch {
        // ignore
      }
    }
    this.terminals.clear()
  }
}
