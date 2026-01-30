import { TraceHitList, TraceRun, TraceStatementResponse } from "abap-adt-api/build/api/tracetypes"
import { Profile, ProfileNode } from "v8-inspect-profiler"
import { log } from "../../lib"
// import { splitAdtUri } from "../../lib"

const objectLink = (connId: string, uri: string, id: number) => `command:abapfs.showObject?${encodeURIComponent(JSON.stringify({ connId, uri }))}`
const total = (addendi: number[]) => addendi.reduce((a, b) => a + b, 0)
// const uriLine = (uri: string) => splitAdtUri(uri).start?.line ?? -1
const uriLine = (uri: string) => -1
export const convertStatements = (run: TraceRun, resp: TraceStatementResponse, connId: string): Profile => {
    const startTime = run.published.getTime()
    const callLevels: ProfileNode[] = []
    const nodes = resp.statements.map((s, id) => {
        const { context = "", name = "", uri = "", objectReferenceQuery = "" } = s.callingProgram || {}
        const { hitCount, traceEventNetTime, index, grossTime, description, callingProgram } = s
        const url = objectLink(connId, uri || objectReferenceQuery, id)
        const lineNumber = uriLine(uri)
        const node: ProfileNode = {
            id: id + 1,
            callFrame: {
                functionName: description || context || name,
                scriptId: "0",
                url,
                lineNumber,
                columnNumber: -1
            },
            hitCount,
            children: []
        }
        callLevels[s.callLevel] = node
        callLevels[s.callLevel - 1]?.children?.push(node.id)
        // const child = callLevels[s.callLevel - 1]
        // if (child) node.children = [child.id]
        // callLevels[s.callLevel] = node        
        return node
    })
    const maxnodeId = nodes[nodes.length - 1]?.id || 0
    const samples = [1, ...nodes.map(n => n.id < maxnodeId ? n.id + 1 : n.id)]
    const timeDeltas = [0, ...resp.statements.map(n => n.traceEventNetTime.time)]
    // const samples = nodes.map(n => n.id) 
    // const timeDeltas = resp.statements.map(n => n.traceEventNetTime.time)
    const selfTime = total(timeDeltas)
    const endTime = startTime + selfTime
    for (const n of nodes) if (n.children?.find(c => c < n.id)) log(`Unexpected child ID in profile`)
    return { startTime, endTime, nodes, samples, timeDeltas }
}


export const convertRun = (run: TraceRun, hitlist: TraceHitList, connId: string): Profile => {
    const startTime = run.published.getTime()
    const nodes = hitlist.entries.map((e, id) => {
        const { context = "", name = "", uri = "", objectReferenceQuery = "" } = e.callingProgram || {}
        const { hitCount, traceEventNetTime, index, grossTime, description } = e
        const url = objectLink(connId, uri || objectReferenceQuery, id)
        const lineNumber = uriLine(uri)
        const node: ProfileNode = {
            id: id + 1,
            callFrame: {
                functionName: description,//context || name,
                scriptId: "0",
                url,
                lineNumber,
                columnNumber: -1
            },
            hitCount,
            children: []
        }
        return node
    }).map(c => {
        if (c.children?.length) return c
        return { ...c, children: undefined }
    })

    const maxnodeId = nodes[nodes.length - 1]?.id || 0
    const samples = [1, ...nodes.map(n => n.id < maxnodeId ? n.id + 1 : n.id)]
    const timeDeltas = [0, ...hitlist.entries.map(n => n.traceEventNetTime.time)]
    const selfTime = total(timeDeltas)
    const endTime = startTime + selfTime
    return { startTime, endTime, nodes, samples, timeDeltas }
}