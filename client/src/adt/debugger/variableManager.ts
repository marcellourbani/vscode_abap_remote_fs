import { debugMetaIsComplex, DebugMetaType, DebugVariable } from "abap-adt-api"
import { Handles, Scope } from "vscode-debugadapter"
import { DebugProtocol } from "vscode-debugprotocol"
import { DebugListener } from "./debugListener"
import { idThread, STACK_THREAD_MULTIPLIER } from "./debugService"

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

const isDebugVariable = (v: DebugVariable | { id: string; name: string }): v is DebugVariable => "ID" in v

export class VariableManager {
    private handles = new Map<number, Handles<Variable>>()// will be overwritten at first use
    private currentStackId = 0

    private variableHandles(threadId: number) {
        const handle = this.handles.get(threadId)
        if (handle) return handle
        return this.resetHandle(threadId)
    }
    public resetHandle(threadId: number) {
        const handle = new Handles<Variable>(STACK_THREAD_MULTIPLIER * threadId)
        this.handles.set(threadId, handle)
        return handle
    }

    private client(threadId: number) {
        try {
            return this.listener.service(threadId).client
        } catch (error) {/* */ }
    }
    private stackTrace(threadId: number) {
        return this.listener.service(threadId).stackTrace
    }
    constructor(private readonly listener: DebugListener) { }
    createVariable(threadId: number, v: DebugVariable | { id: string, name: string }) {
        if (isDebugVariable(v))
            return this.variableHandles(threadId).create({ id: v.ID, name: v.NAME, lines: v.TABLE_LINES, meta: v.META_TYPE, threadId })
        return this.variableHandles(threadId).create({ id: v.id, name: v.name, threadId })
    }
    async getScopes(frameId: number) {
        const threadId = idThread(frameId)
        const client = this.client(threadId)
        if (!client) return []
        const currentStack = this.stackTrace(threadId).find(s => s.id === frameId)
        if (currentStack && !isNaN(currentStack.stackPosition) && frameId !== this.currentStackId) {
            await client.debuggerGoToStack(currentStack.stackUri || currentStack.stackPosition)
            this.currentStackId = frameId
        }
        const { hierarchies } = await client.debuggerChildVariables(["@ROOT"])
        const scopes = hierarchies.map(h => {
            const name = h.CHILD_NAME || h.CHILD_ID
            const handler = this.createVariable(threadId, { id: h.CHILD_ID, name })
            return new Scope(name, handler, true)
        })
        const syhandler = this.createVariable(threadId, { id: "SY", name: "SY" })
        scopes.push(new Scope("SY", syhandler, true))
        return scopes
    }

    private async childVariables(parent: Variable) {
        const client = this.client(parent.threadId)
        if (!client) return []
        if (parent.meta === "table") {
            if (!parent.lines) return []
            const keys = [...Array(parent.lines).keys()].map(k => `${parent.id.replace(/\[\]$/, "")}[${k + 1}]`)
            return client.debuggerVariables(keys)
        }
        return client.debuggerChildVariables([parent.id]).then(r => r.variables)
    }
    async evaluate(expression: string, frameId?: number): Promise<DebugProtocol.EvaluateResponse["body"] | undefined> {
        try {
            const threadId = frameId && idThread(frameId)
            if (!threadId) return
            const client = this.client(threadId)
            if (!client) return
            const v = await client.debuggerVariables([expression])
            if (!v[0]) return
            return { result: variableValue(v[0]), variablesReference: this.variableReference(v[0], threadId) }
        } catch (error) {
            return
        }
    }

    private variableReference(v: DebugVariable, threadId: number) {
        return debugMetaIsComplex(v.META_TYPE) ? this.createVariable(threadId, v) : 0
    }

    async getVariables(parentid: number) {
        const threadId = idThread(parentid)
        const vari = this.variableHandles(threadId).get(parentid)
        if (vari) {
            const children = await this.childVariables(vari)
            const variables: DebugProtocol.Variable[] = children.map(v => ({
                name: `${v.NAME}`,
                value: variableValue(v),
                variablesReference: this.variableReference(v, vari.threadId),
                memoryReference: `${v.ID}`
            }))
            return variables
        }
        return []
    }


    async setVariable(reference: number, name: string, inputValue: string) {
        try {
            const threadId = idThread(reference)
            const client = this.client(threadId)
            if (!client) return { value: "", success: false }
            const h = this.variableHandles(threadId).get(reference)
            const variable = h.id.match(/^@/) ? name : `${h?.name}-${name}`.toUpperCase()
            const value = await client.debuggerSetVariableValue(variable, inputValue)
            return { value, success: true }
        } catch (error) {
            return { value: "", success: false }
        }
    }


}