import { DebugBreakpoint, isDebuggerBreakpoint } from "abap-adt-api"
import { AbapFile, isAbapFile } from "abapfs"
import { Uri } from "vscode"
import { Breakpoint, Source } from "@vscode/debugadapter"
import { DebugProtocol } from "@vscode/debugprotocol"
import { ignore, isDefined } from "../../lib"
import { getClient, getRoot } from "../conections"
import { DebugListener } from "./debugListener"
import { DebugService } from "./debugService"

class AdtBreakpoint extends Breakpoint {
    constructor(verified: boolean, readonly adtBp?: DebugBreakpoint, line?: number, column?: number, source?: Source) {
        super(verified, line, column, source)
    }
}

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
        //log(`[DEBUG-BP] setBreakpoints called - source.path: ${source.path}, breakpoints: ${JSON.stringify(breakpoints)}`)
        const bps = await this.setBreakpointsInt(source, breakpoints)
       // log(`[DEBUG-BP] setBreakpointsInt returned ${bps.length} breakpoints, verified: ${bps.filter(b => b.verified).length}`)
        if (source.path) this.breakpoints.set(source.path, bps)
        return bps
    }
    private async setBreakpointsInt(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
        breakpoints ||= []
        if (!source.path) {
            return []
        }
        const uri = Uri.parse(source.path)
        //log(`[DEBUG-BP] Parsed URI - scheme: ${uri.scheme}, path: ${uri.path}`)
        const root = getRoot(this.listener.connId)
        //log(`[DEBUG-BP] Got root for connection ${this.listener.connId}`)
        const node = await root.getNodeAsync(uri.path)
       // log(`[DEBUG-BP] Got node - isAbapFile: ${isAbapFile(node)}, node type: ${node?.constructor?.name}`)
        if (isAbapFile(node)) {
            try {
                return await this.syncBreakpoints(node, breakpoints, source.path, source.name)
            } catch (error) {
            }
        } else {
        }
        return []

    }
    async removeAllBreakpoints(thread: DebugService) {
        for (const path of this.breakpoints.keys()) {
            const oldbps = this.getBreakpoints(path)
            for (const bp of oldbps)
                if (bp.adtBp) await thread.client.debuggerDeleteBreakpoints(bp.adtBp, "user", this.terminalId, this.ideId, this.username, "debugger").catch(ignore)
        }
    }
    private async syncBreakpoints(node: AbapFile, breakpoints: DebugProtocol.SourceBreakpoint[], path: string, name?: string) {
        if (!node.object.structure) {
            await node.object.loadStructure()
        }
        const objuri = node.object.contentsPath()
        
        // For includes, we need to use VIT URI format with main program + include
        // SAP expects object_name as: <MAIN_PROGRAM padded 40 chars><INCLUDE padded 40 chars>
        // object_type is wbobjtype: objtype_tr (4 chars) + subtype_wb (3 chars) = 7 chars total
        // For includes: objtype_tr = 'PROG', subtype_wb = 'I  ' (swbm_c_type_prg_include)
        // So object_type = 'PROGI  ' (7 chars)
        let bpUri = objuri
        let isInclude = false
        try {
            const mainProgs = await node.object.mainPrograms()
            if (mainProgs && mainProgs.length > 0) {
                isInclude = true
                const mainProg = mainProgs[0]
                const mainProgName = mainProg["adtcore:name"].toUpperCase().padEnd(40, ' ')
                const includeName = node.object.name.toUpperCase().padEnd(40, ' ')
                const combinedName = `${mainProgName}${includeName}`
                // VIT URI format: /sap/bc/adt/vit/wb/object_type/<type>/object_name/<combined>
                // Type = 'PROGI  ' (4 chars objtype_tr + 3 chars subtype_wb)
                // SAP uses: url_escape(type) CASE = LOWER, url_escape(name)
                const objectType = 'PROGI  '  // PROG + I + 2 spaces = 7 chars
                const escapedType = encodeURIComponent(objectType).toLowerCase()
                const escapedName = encodeURIComponent(combinedName)
                bpUri = `/sap/bc/adt/vit/wb/object_type/${escapedType}/object_name/${escapedName}`

            }
        } catch (error) {
        }
        
        const bps = breakpoints.map(b => `${bpUri}#start=${b.line}`)
        const uri = Uri.parse(path)
        const clientId = `24:${this.listener.connId}${uri.path}`
        const oldbps = this.getBreakpoints(path)
        const client = getClient(this.listener.connId)
        const deleted = oldbps.map(o => o.adtBp).filter(isDefined).filter(o => !breakpoints.find(b => b.line === o.uri.range.start.line))
        for (const bp of deleted)
            await client.statelessClone.debuggerDeleteBreakpoints(bp, "user", this.terminalId, this.ideId, this.username).catch(ignore)
        let actualbps: any[] = []
        try {
            actualbps = await client.statelessClone.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, bps, this.username, "external", false, false, objuri)

        } catch (error) {
            actualbps = []
        }
        const conditional = breakpoints.filter(b => b.condition)
        let newbps: (string | DebugBreakpoint)[] = bps
        if (conditional.length) {
            newbps = actualbps.filter(isDebuggerBreakpoint).map(b => {
                const cond = conditional.find(c => c.line === b.uri.range.start.line)
                if (cond?.condition) return { ...b, condition: cond.condition }
                return b
            })
            actualbps = await client.statelessClone.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, newbps, this.username, "external", false, false, objuri)
        }
        for (const [id, conn] of this.listener.activeServices()) {
            for (const bp of deleted)
                await conn.client.debuggerDeleteBreakpoints(bp, "user", this.terminalId, this.ideId, this.username, "debugger").catch(ignore)
            try {
                await conn.client.debuggerSetBreakpoints(this.mode, this.terminalId, this.ideId, clientId, newbps, this.username, "debugger", false, false, objuri)
            } catch (error) {
            }
        }

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