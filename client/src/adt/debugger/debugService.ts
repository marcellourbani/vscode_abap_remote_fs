import {
    ADTClient, Debuggee, DebugStepType, debugMetaIsComplex, session_types, DebugMetaType, DebugVariable,
    DebuggingMode, isAdtError
} from "abap-adt-api"
import { newClientFromKey } from "./functions"
import { log, caughtToString, ignore } from "../../lib"
import { DebugProtocol } from "vscode-debugprotocol"
import { Disposable, EventEmitter } from "vscode"
import { Handles, Scope, Source, StoppedEvent, ThreadEvent } from "vscode-debugadapter"
import { vsCodeUri } from "../../langClient"
import { THREAD_EXITED } from "./debugListener"
const STACK_THREAD_MULTIPLIER = 10000

const ATTACHTIMEOUT = "autoAttachTimeout"
const sessionNumbers = new Map<string, number>()

export interface DebuggerUI {
    Confirmator: (message: string) => Thenable<boolean>
    ShowError: (message: string) => any
}
interface Variable {
    id: string,
    threadId: number,
    name: string,
    meta?: DebugMetaType,
    lines?: number
}

const variableValue = (v: DebugVariable) => {
    if (v.META_TYPE === "table") return `${v.TECHNICAL_TYPE || v.META_TYPE} ${v.TABLE_LINES} lines`
    if (debugMetaIsComplex(v.META_TYPE)) return v.META_TYPE
    return `${v.VALUE}`
}


interface StackFrame extends DebugProtocol.StackFrame {
    stackPosition: number
    stackUri?: string
}

const errorType = (err: any): string | undefined => {
    try {
        const exceptionType = err?.properties?.["com.sap.adt.communicationFramework.subType"]
        if (!exceptionType && `${err.response.body}`.match(/Connection timed out/)) return ATTACHTIMEOUT
        return exceptionType
    } catch (error) {/**/ }
}

export const frameThread = (frameId: number) => Math.floor(frameId / STACK_THREAD_MULTIPLIER)

const isConflictError = (e: any) => (errorType(e) || "").match(/conflictNotification|conflictDetected/)
interface AdtEvent {
    adtEventType: "detached",
    threadId: number
}

const isDebugVariable = (v: DebugVariable | { id: string; name: string }): v is DebugVariable => "ID" in v

// tslint:disable-next-line:max-classes-per-file
export class DebugService {
    private killed = false
    private notifier: EventEmitter<DebugProtocol.Event> = new EventEmitter()
    private listeners: Disposable[] = []
    private stackTrace: StackFrame[] = []
    private currentStackId?: number
    private variableHandles = new Handles<Variable>(STACK_THREAD_MULTIPLIER * this.threadId)
    private readonly mode: DebuggingMode
    private doRefresh?: NodeJS.Timeout
    sessionNumber: number

    get client() {
        if (this.killed) throw new Error("Disconnected")
        return this._client
    }

    constructor(private connId: string, private _client: ADTClient, private terminalId: string, private ideId: string,
        private username: string, terminalMode: boolean, readonly debuggee: Debuggee, private threadId: number, private ui: DebuggerUI) {
        this.sessionNumber = (sessionNumbers.get(connId) || 0) + 1
        sessionNumbers.set(connId, this.sessionNumber)

        this.mode = terminalMode ? "terminal" : "user"
        if (!this.username) this.username = _client.username.toUpperCase()
    }

    public static async create(connId: string, ui: DebuggerUI, username: string, terminalMode: boolean, terminalId: string,
        ideId: string, debuggee: Debuggee, threadid: number) {
        const client = await newClientFromKey(connId)
        if (!client) throw new Error(`Unable to create client for${connId}`)
        client.stateful = session_types.stateful
        await client.adtCoreDiscovery()
        const service = new DebugService(connId, client, terminalId, ideId, username, terminalMode, debuggee, threadid, ui)
        return service
    }
    public async attach() {
        await this.client.debuggerAttach(this.mode, this.debuggee.DEBUGGEE_ID, this.username, true)
        await this.client.debuggerSaveSettings({})
        await this.updateStack()
    }

    addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
        return this.notifier.event(listener, thisArg, this.listeners)
    }

    getStack() {
        return this.stackTrace
    }

    createVariable(v: DebugVariable | { id: string, name: string }) {
        if (isDebugVariable(v))
            return this.variableHandles.create({ id: v.ID, name: v.NAME, lines: v.TABLE_LINES, meta: v.META_TYPE, threadId: this.threadId })
        return this.variableHandles.create({ id: v.id, name: v.name, threadId: this.threadId })
    }

    async getScopes(frameId: number) {
        this.variableHandles = new Handles(STACK_THREAD_MULTIPLIER * this.threadId)
        const currentStack = this.stackTrace.find(s => s.id === frameId)
        if (currentStack && !isNaN(currentStack.stackPosition) && frameId !== this.currentStackId) {
            await this.client.debuggerGoToStack(currentStack.stackUri || currentStack.stackPosition)
            this.currentStackId = frameId
        }
        const { hierarchies } = await this.client.debuggerChildVariables(["@ROOT"])
        const scopes = hierarchies.map(h => {
            const name = h.CHILD_NAME || h.CHILD_ID
            const handler = this.createVariable({ id: h.CHILD_ID, name })
            return new Scope(name, handler, true)
        })
        const syhandler = this.createVariable({ id: "SY", name: "SY" })
        scopes.push(new Scope("SY", syhandler, true))
        return scopes
    }

    private async childVariables(parent: Variable) {
        if (parent.meta === "table") {
            if (!parent.lines) return []
            const keys = [...Array(parent.lines).keys()].map(k => `${parent.id.replace(/\[\]$/, "")}[${k + 1}]`)
            return this.client.debuggerVariables(keys)
        }
        return this.client.debuggerChildVariables([parent.id]).then(r => r.variables)
    }

    async evaluate(expression: string) {
        const v = await this.client.debuggerVariables([expression])
        if (!v[0]) return
        const variablesReference = this.createVariable(v[0])
        return { result: variableValue(v[0]), variablesReference }
    }

    async getVariables(parentid: number) {
        const vari = this.variableHandles.get(parentid)
        if (vari) {
            const children = await this.childVariables(vari)
            const variables: DebugProtocol.Variable[] = children.map(v => ({
                name: `${v.NAME}`,
                value: variableValue(v),
                variablesReference: debugMetaIsComplex(v.META_TYPE) ? this.createVariable(v) : 0,
                memoryReference: `${v.ID}`
            }))
            return variables
        }
        return []
    }


    async setVariable(reference: number, name: string, inputValue: string) {
        try {
            const h = this.variableHandles.get(reference)
            const variable = h.id.match(/^@/) ? name : `${h?.name}-${name}`.toUpperCase()
            const value = await this.client.debuggerSetVariableValue(variable, inputValue)
            return { value, success: true }
        } catch (error) {
            return { value: "", success: false }
        }
    }

    private async baseDebuggerStep(stepType: DebugStepType, url?: string) {
        if (stepType === "stepRunToLine" || stepType === "stepJumpToLine") {
            if (!url) throw new Error(`Bebugger step${stepType} requires a target`)
            return this.client.debuggerStep(stepType, url)
        }
        return this.client.debuggerStep(stepType)
    }

    public async debuggerStep(stepType: DebugStepType, threadId: number, url?: string) {
        try {
            if (this.doRefresh) clearTimeout(this.doRefresh)
            this.doRefresh = undefined
            const res = await this.baseDebuggerStep(stepType, url)
            await this.updateStack()
            this.notifier.fire(new StoppedEvent("breakpoint", threadId))
            return res
        } catch (error) {
            if (!isAdtError(error)) {
                this.ui.ShowError(`Error in debugger stepping: ${caughtToString(error)}`)
            } else {
                if (error?.properties?.["com.sap.adt.communicationFramework.subType"] !== "debuggeeEnded")
                    this.ui.ShowError(error?.message || "unknown error in debugger stepping")
                this.notifier.fire(new ThreadEvent(THREAD_EXITED, threadId))
            }
        }
    }

    private async updateStack() {
        const stackInfo = await this.client.debuggerStackTrace(false).catch(() => undefined)
        this.currentStackId = STACK_THREAD_MULTIPLIER * this.threadId
        const createFrame = (path: string, line: number, id: number, stackPosition: number, stackUri?: string) => {
            const name = path.replace(/.*\//, "")
            const source = new Source(name, path)
            const frame: StackFrame = { id, name, source, line, column: 0, stackPosition }
            return frame
        }
        if (stackInfo) {
            const stackp = stackInfo.stack.map(async (s, id) => {
                id = id + this.threadId * STACK_THREAD_MULTIPLIER
                try {
                    const path = await vsCodeUri(this.connId, s.uri.uri, true, true)
                    const stackUri = "stackUri" in s ? s.stackUri : undefined
                    return createFrame(path, s.line, id, s.stackPosition, stackUri)
                } catch (error) {
                    log(caughtToString(error))
                    return createFrame("unknown", 0, id, NaN)
                }
            })
            this.stackTrace = (await Promise.all(stackp)).filter(s => !!s)
        }
    }

    public async logout() {
        if (this.killed) return
        const client = this.client
        this.killed = true
        await client.statelessClone.logout().catch(ignore)
        await client.logout()
    }
}


