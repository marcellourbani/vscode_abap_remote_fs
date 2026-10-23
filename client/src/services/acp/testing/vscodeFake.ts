// Shared `vscode` fake for the ACP tests. Use it as
//   vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
// and call resetVscodeFake() in beforeEach. The fake contains only the API surface the ACP code uses.
import * as nodePath from "node:path"
import { vi } from "vitest"

interface UriParts {
  scheme: string
  authority?: string
  path?: string
  query?: string
  fragment?: string
}

/** Enough of vscode.Uri for the ACP code: parsing, file paths and equality through toString */
export class FakeUri {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string

  constructor(parts: UriParts) {
    this.scheme = parts.scheme
    this.authority = parts.authority ?? ""
    this.path = parts.path ?? ""
    this.query = parts.query ?? ""
    this.fragment = parts.fragment ?? ""
  }
  static parse(value: string) {
    const match = /^([a-z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
      value
    )
    if (!match) throw new Error(`Invalid URI: ${value}`)
    const [, scheme, authority, path, query, fragment] = match
    return new FakeUri({
      scheme: scheme.toLowerCase(),
      authority,
      path: decodeURI(path || "/"),
      query,
      fragment
    })
  }
  static file(fsPath: string) {
    const slashed = fsPath.replace(/\\/g, "/")
    return new FakeUri({ scheme: "file", path: /^[a-z]:/i.test(slashed) ? `/${slashed}` : slashed })
  }
  static from(parts: UriParts) {
    return new FakeUri(parts)
  }
  static joinPath(base: FakeUri, ...segments: string[]) {
    return base.with({ path: nodePath.posix.join(base.path, ...segments) })
  }
  with(change: Partial<UriParts>) {
    return new FakeUri({ ...this, ...change })
  }
  get fsPath() {
    const path = /^\/[a-z]:/i.test(this.path) ? this.path.slice(1) : this.path
    return process.platform === "win32" ? path.replace(/\//g, "\\") : path
  }
  toString() {
    const authority = this.authority || this.scheme === "file" ? `//${this.authority}` : ""
    const query = this.query ? `?${this.query}` : ""
    const fragment = this.fragment ? `#${this.fragment}` : ""
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`
  }
  toJSON() {
    return this.toString()
  }
}

export type FakeEvent<T> = ReturnType<typeof vi.fn> & {
  fire(value: T): void
  listenerCount(): number
}

/** A vscode.Event the test can fire */
export function fakeEvent<T = unknown>(): FakeEvent<T> {
  const listeners = new Set<(value: T) => void>()
  const event = vi.fn((listener: (value: T) => void) => {
    listeners.add(listener)
    return { dispose: () => listeners.delete(listener) }
  }) as FakeEvent<T>
  event.fire = value => listeners.forEach(listener => listener(value))
  event.listenerCount = () => listeners.size
  return event
}

export class FakeEventEmitter<T = unknown> {
  readonly event = fakeEvent<T>()
  fire(value: T) {
    this.event.fire(value)
  }
  dispose() {}
}

export class FakeDisposable {
  constructor(readonly dispose: () => void = () => {}) {}
  static from(...items: { dispose(): unknown }[]) {
    return new FakeDisposable(() => items.forEach(item => item.dispose()))
  }
}

export class FakePosition {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class FakeRange {
  readonly start: FakePosition
  readonly end: FakePosition
  constructor(...args: [FakePosition, FakePosition] | [number, number, number, number]) {
    const [a, b, c, d] = args
    this.start = typeof a === "number" ? new FakePosition(a, b as number) : a
    this.end =
      typeof a === "number" ? new FakePosition(c as number, d as number) : (b as FakePosition)
  }
}

export class FakeWorkspaceEdit {
  readonly replacements: { uri: FakeUri; range: FakeRange; text: string }[] = []
  replace(uri: FakeUri, range: FakeRange, text: string) {
    this.replacements.push({ uri, range, text })
  }
}

function outputChannel(name: string) {
  return {
    name,
    lines: [] as string[],
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn()
  }
}

function build() {
  const values = new Map<string, unknown>()
  const workspaceValues = new Map<string, unknown>()
  const channels = new Map<string, ReturnType<typeof outputChannel>>()
  const update = vi.fn(async (key: string, value: unknown, _target?: number) => {
    values.set(key, value)
  })
  return {
    settings: {
      values,
      workspaceValues,
      update,
      /** Set a user setting, e.g. set("abapfs.acp.logTraffic", true) */
      set: (key: string, value: unknown) => values.set(key, value)
    },
    window: {
      channels,
      activeTextEditor: undefined as unknown,
      createOutputChannel: vi.fn((name: string) => {
        const channel = outputChannel(name)
        channel.appendLine.mockImplementation((line: string) => channel.lines.push(line))
        channels.set(name, channel)
        return channel
      }),
      createStatusBarItem: vi.fn(() => ({
        text: "",
        tooltip: "",
        command: undefined as unknown,
        backgroundColor: undefined as unknown,
        show: vi.fn(),
        dispose: vi.fn()
      })),
      createTerminal: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(),
      showInputBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showTextDocument: vi.fn(),
      withProgress: vi.fn(
        (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
          task(
            { report: vi.fn() },
            { isCancellationRequested: false, onCancellationRequested: fakeEvent() }
          )
      ),
      registerWebviewViewProvider: vi.fn(() => new FakeDisposable()),
      onDidChangeActiveTextEditor: fakeEvent(),
      onDidChangeTextEditorSelection: fakeEvent()
    },
    workspace: {
      workspaceFolders: undefined as unknown,
      textDocuments: [] as unknown[],
      fs: { readFile: vi.fn(), writeFile: vi.fn(), stat: vi.fn() },
      getConfiguration: vi.fn((section: string) => ({
        get: (key: string, fallback?: unknown) =>
          values.has(`${section}.${key}`) ? values.get(`${section}.${key}`) : fallback,
        inspect: (key: string) => ({ workspaceValue: workspaceValues.get(`${section}.${key}`) }),
        update: (key: string, value: unknown, target?: number) =>
          update(`${section}.${key}`, value, target)
      })),
      openTextDocument: vi.fn(async (uri: unknown) => ({ uri })),
      applyEdit: vi.fn(async (_edit: FakeWorkspaceEdit) => true),
      onDidChangeConfiguration: fakeEvent()
    },
    commands: {
      registered: new Map<string, (...args: any[]) => unknown>(),
      registerCommand: vi.fn(),
      executeCommand: vi.fn()
    },
    extensions: { getExtension: vi.fn() }
  }
}

export const vscodeFake = {
  ...build(),
  Uri: FakeUri,
  EventEmitter: FakeEventEmitter,
  Disposable: FakeDisposable,
  Position: FakePosition,
  Range: FakeRange,
  WorkspaceEdit: FakeWorkspaceEdit,
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 }
}

/** Replace all fakes in place: modules read `vscode.window.*` at call time, so the containers must survive */
export function resetVscodeFake() {
  const fresh = build()
  for (const key of Object.keys(fresh) as (keyof typeof fresh)[]) {
    const target = vscodeFake[key] as Record<string, unknown>
    for (const prop of Object.keys(target)) delete target[prop]
    Object.assign(target, fresh[key])
  }
  const { registered } = vscodeFake.commands
  vscodeFake.commands.registerCommand.mockImplementation(
    (id: string, handler: (...args: any[]) => unknown) => {
      registered.set(id, handler)
      return new FakeDisposable(() => registered.delete(id))
    }
  )
  // Mirrors real VS Code: executeCommand dispatches to whatever registerCommand registered.
  // Call-tracking assertions still work; mockResolvedValueOnce still overrides per-call as usual.
  vscodeFake.commands.executeCommand.mockImplementation(async (id: string, ...args: unknown[]) =>
    registered.get(id)?.(...args)
  )
}

resetVscodeFake()
