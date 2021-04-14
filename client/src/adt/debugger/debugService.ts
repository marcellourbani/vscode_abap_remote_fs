import { ADTClient, DebugAttach, DebugBreakpoint, Debuggee, DebugStep, DebugStepType, isDebugListenerError, session_types } from "abap-adt-api";
import { newClientFromKey, md5 } from "./functions";
import { readFileSync } from "fs";
import { log } from "../../lib";
import { DebugProtocol } from "vscode-debugprotocol";
import { Uri } from "vscode";
import { getRoot } from "../conections";
import { isAbapFile } from "abapfs";
import { homedir } from "os";
import { join } from "path";

let breakpointId = 1

const convertBreakpoints = (name: string) => (bp: DebugBreakpoint): DebugProtocol.Breakpoint =>
    ({ verified: true, id: breakpointId++, line: bp.uri.range.start.line })


export class DebugService {
    private active: boolean = false;
    private ideId: string;
    private username: string

    constructor(private connId: string, private client: ADTClient, private terminalId: string) {
        // this.terminalId = "71999B60AA6349CF91D0A23773B3C728"
        this.ideId = md5(connId)// "796B6D15B9A1BEC388DA0C50010D2F62"
        this.username = client.username.toUpperCase()
    }

    public static async create(connId: string) {
        const client = await newClientFromKey(connId)
        if (!client) throw new Error(`Unable to create client for${connId}`);
        client.stateful = session_types.stateful
        await client.adtCoreDiscovery()
        const cfgfile = join(homedir(), ".SAP/ABAPDebugging/terminalId")
        const terminalId = readFileSync(cfgfile).toString("utf8")// "71999B60AA6349CF91D0A23773B3C728"
        return new DebugService(connId, client, terminalId)
    }

    public async mainLoop() {
        while (this.active) {
            try {
                const debuggee = await this.client.statelessClone.debuggerListen("user", this.terminalId, this.ideId, this.username)
                if (!debuggee) continue
                if (isDebugListenerError(debuggee)) {
                    // reconnect
                    break
                }
                await this.onBreakpointReached(debuggee)
            } catch (error) {
                log(`Error listening to debugger: ${error}`)
                this.active = false
            }
        }
    }

    public async setBreakpoints(path: string, breakpoints: DebugProtocol.SourceBreakpoint[] = []) {
        const uri = Uri.parse(path)
        const root = getRoot(this.connId)
        const node = await root.getNodeAsync(uri.path)
        if (isAbapFile(node)) {
            const objuri = node.object.contentsPath()
            const clientId = `24:${this.connId}${uri.path}` // `582:/A4H_001_developer_en/.adt/programs/programs/ztest/ztest.asprog`
            const bps = breakpoints.map(b => `${objuri}#start=${b.line}`)
            const actualbps = await this.client.statelessClone.debuggerSetBreakpoints(
                "user", this.terminalId, this.ideId, clientId, bps, this.username)
            return actualbps.map(convertBreakpoints(path))
        }
        return []

    }

    private async onBreakpointReached(debuggee: Debuggee) {
        try {
            const attach = await this.client.debuggerAttach("user", debuggee.DEBUGGEE_ID, this.username, true)
            const bp = attach.reachedBreakpoints[0]
            log(JSON.stringify(bp))
            const stack = await this.client.debuggerStackTrace()
            log(JSON.stringify(stack))
            const variables = await this.client.debuggerVariables(["SY-SUBRC", "SY"])
            log(JSON.stringify(variables))
            const cvariables = await this.client.debuggerChildVariables()
            log(JSON.stringify(cvariables))
            await this.client.debuggerStep("stepContinue")
        } catch (error) {
            log(`${error}`)
            this.stopDebugging()
        }
    }

    private async baseDebuggerStep(stepType: DebugStepType, url?: string) {
        if (stepType === "stepRunToLine" || stepType === "stepJumpToLine") {
            if (!url) throw new Error(`Bebugger step${stepType} requires a target`)
            return this.client.debuggerStep(stepType, url)
        }
        return this.client.debuggerStep(stepType)

    }

    public async debuggerStep(stepType: DebugStepType, url?: string) {
        const res = await this.baseDebuggerStep(stepType, url)
        if (res.reachedBreakpoints?.length) await this.updateDebugState(res)
        return res
    }
    private async updateDebugState(state: DebugStep | DebugAttach) {
        const bp = state.reachedBreakpoints?.[0]
        if (!bp) return
        const stack = await this.client.debuggerStackTrace()
        log(JSON.stringify(stack))
        const variables = await this.client.debuggerVariables(["SY-SUBRC", "SY"])
        log(JSON.stringify(variables))
        const cvariables = await this.client.debuggerChildVariables()
        log(JSON.stringify(cvariables))
    }

    public async stopDebugging() {
        this.active = false
        await this.client.dropSession()
        await this.client.statelessClone.debuggerDeleteListener("user", this.terminalId, this.ideId, this.username)
    }
}

