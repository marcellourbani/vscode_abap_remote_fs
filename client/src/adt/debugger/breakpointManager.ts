import { DebugBreakpoint, isDebuggerBreakpoint } from "abap-adt-api"
import { AbapFile, isAbapFile } from "abapfs"
import { Uri } from "vscode"
import { Breakpoint, Source } from "vscode-debugadapter"
import { DebugProtocol } from "vscode-debugprotocol"
import { log, caughtToString } from "../../lib"
import { getClient, getRoot } from "../conections"
import { DebugListener } from "./debugListener"

class AdtBreakpoint extends Breakpoint {
    constructor(verified: boolean, readonly adtBp?: DebugBreakpoint, line?: number, column?: number, source?: Source) {
        super(verified, line, column, source)
    }
}

// tslint:disable-next-line:max-classes-per-file
export class BreakpointManager {
    private breakpoints = new Map<string, AdtBreakpoint[]>()
    constructor(private readonly listener: DebugListener) { }
    private get mode() {
        return this.listener.mode
    }
    private get ideId() {
        return this.listener.ideId
    }
    private get terminalId() {
        return this.listener.terminalId
    } private get username() {
        return this.listener.username
    }
    public getBreakpoints(path: string) {
        return this.breakpoints.get(path) || []
    }
    public async setBreakpoints(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
        const bps = await this.setBreakpointsInt(source, breakpoints)
        if (source.path) this.breakpoints.set(source.path, bps)
        return bps
    }
    private async setBreakpointsInt(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
        breakpoints ||= []
        if (!source.path) return []
        const uri = Uri.parse(source.path)
        const root = getRoot(this.listener.connId)
        const node = await root.getNodeAsync(uri.path)
        if (isAbapFile(node)) {
            try {
                return await this.syncBreakpoints(node, breakpoints, source.path, source.name)
            } catch (error) {
                log(caughtToString(error))
            }
        }
        return []

    }
    private async syncBreakpoints(node: AbapFile, breakpoints: DebugProtocol.SourceBreakpoint[], path: string, name?: string) {
        const objuri = node.object.contentsPath()
        const bps = breakpoints.map(b => `${objuri}#start=${b.line}`)
        const uri = Uri.parse(path)
        const clientId = `24:${this.listener.connId}${uri.path}`
        const oldbps = this.getBreakpoints(path)
        const client = getClient(this.listener.connId)
        let actualbps = await client.statelessClone.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, bps, this.username)
        const conditional = breakpoints.filter(b => b.condition)
        if (conditional.length) {
            const newbps = actualbps.filter(isDebuggerBreakpoint).map(b => {
                const cond = conditional.find(c => c.line === b.uri.range.start.line)
                if (cond?.condition) return { ...b, condition: cond.condition }
                return b
            })
            actualbps = await client.statelessClone.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, newbps, this.username)
        }
        const confbps = actualbps.filter(isDebuggerBreakpoint)
        await client.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, confbps, this.username, "debugger")
        const deleted = oldbps.map(o => o.adtBp).filter(o => o && !breakpoints.find(b => b.line === o.uri.range.start.line))
        for (const bp of deleted)
            await client.statelessClone.debuggerDeleteBreakpoints(bp!, "user", this.terminalId, this.ideId, this.username)
        for (const [id, conn] of this.listener.activeServices())
            for (const bp of deleted)
                await conn.client.debuggerDeleteBreakpoints(bp!, "user", this.terminalId, this.ideId, this.username, "debugger")

        const confirmed = breakpoints.map(bp => {
            const actual = actualbps.find(a => isDebuggerBreakpoint(a) && a.uri.range.start.line === bp.line)
            if (actual && isDebuggerBreakpoint(actual)) {
                const src = new Source(name || "", path)
                return new AdtBreakpoint(true, actual, bp.line, 0, src)
            }
            return new AdtBreakpoint(false)
        })
        return confirmed
    }

}