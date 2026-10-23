// Fakes for SessionManager tests: an AgentManager, a ConnectionManager and one scriptable agent.
// Test files still declare their own vi.mock calls, which only take effect in test files.
import { EventEmitter } from "node:events"
import { vi } from "vitest"
import { SessionManager } from "../core/SessionManager"
import { SessionHistoryStore } from "../core/SessionHistoryStore"
import { vscodeFake } from "./vscodeFake"

import type { AgentCapabilities, AuthMethod, Implementation } from "@agentclientprotocol/sdk"

type Responder = (params: any) => unknown

export interface SessionFixtureOptions {
  capabilities?: AgentCapabilities
  authMethods?: AuthMethod[]
  agentInfo?: Partial<Implementation>
}

export const AGENTS = {
  Claude: { command: "claude-acp" },
  Gemini: { command: "gemini", args: ["--acp"] }
}

/** Settings plus fresh fakes; call after resetVscodeFake() */
export function createSessionFixture(options: SessionFixtureOptions = {}) {
  vscodeFake.settings.set("abapfs.acp.agents", AGENTS)
  vscodeFake.settings.set("abapfs.acp.defaultWorkingDirectory", "/work")

  let nextAgent = 1
  let nextSession = 1
  const running = new Map<string, { id: string; name: string; process: object }>()
  const agentManager = Object.assign(new EventEmitter(), {
    spawnAgent: vi.fn((name: string) => {
      const instance = { id: `agent_${nextAgent++}`, name, process: {} }
      running.set(instance.id, instance)
      return instance
    }),
    getAgent: vi.fn((id: string) => running.get(id)),
    getRunningAgents: vi.fn(() => [...running.values()]),
    killAgent: vi.fn((id: string) => running.delete(id)),
    killAll: vi.fn()
  })

  /** Agent replies by method; replace entries to script a test */
  const responses: Record<string, Responder> = {
    "session/new": () => ({ sessionId: `session_${nextSession++}` }),
    "session/prompt": () => ({ stopReason: "end_turn" }),
    "session/set_mode": () => ({}),
    "session/set_config_option": () => ({ configOptions: [] }),
    "session/list": () => ({ sessions: [] }),
    "session/load": () => ({}),
    "session/resume": () => ({}),
    authenticate: () => ({})
  }
  const agent = {
    request: vi.fn(async (method: string, params: unknown) => {
      const respond = responses[method]
      if (!respond) throw new Error(`Unexpected request ${method}`)
      return respond(params)
    }),
    notify: vi.fn(async () => {})
  }
  const initResponse = {
    protocolVersion: 1,
    agentCapabilities: options.capabilities ?? {},
    agentInfo: { name: "claude-code", version: "1.0.0", ...options.agentInfo },
    authMethods: options.authMethods ?? []
  }
  const connections = new Map<
    string,
    { connection: { close: () => void }; agent: typeof agent; initResponse: typeof initResponse }
  >()
  const connectionManager = {
    connect: vi.fn(async (agentId: string) => {
      const info = { connection: { close: vi.fn() }, agent, initResponse }
      connections.set(agentId, info)
      return info
    }),
    getConnection: vi.fn((agentId: string) => connections.get(agentId)),
    removeConnection: vi.fn((agentId: string) => connections.delete(agentId)),
    dispose: vi.fn()
  }

  const manager = new SessionManager(agentManager as any, connectionManager as any, {} as any)
  const state = new Map<string, unknown>()
  const history = new SessionHistoryStore({
    get: (key: string) => state.get(key),
    update: async (key: string, value: unknown) => void state.set(key, value),
    keys: () => [...state.keys()]
  } as any)
  manager.setHistoryStore(history)

  /** Every event the manager emitted, in order */
  const events: unknown[][] = []
  const emit = manager.emit.bind(manager)
  manager.emit = (event: string | symbol, ...args: unknown[]) => {
    events.push([event, ...args])
    return emit(event, ...args)
  }
  const requests = (method: string) =>
    agent.request.mock.calls.filter(([m]) => m === method).map(([, p]) => p as any)

  return {
    manager,
    agentManager,
    connectionManager,
    connections,
    agent,
    responses,
    initResponse,
    history,
    events,
    requests
  }
}

export const authRequired = () =>
  Object.assign(new Error("Authentication required"), { code: -32000 })
