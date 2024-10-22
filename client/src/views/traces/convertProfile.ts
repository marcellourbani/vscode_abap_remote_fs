import { TraceHitList, TraceRun, TraceStatementResponse } from "abap-adt-api/build/api/tracetypes"
import { Profile, ProfileNode } from "v8-inspect-profiler"

const total = (addendi: number[]) => addendi.reduce((a, b) => a + b, 0)
export const convertStatements = (run: TraceRun, resp: TraceStatementResponse): Profile => {
    // const parents = resp.statements.filter(s => s.hasDetailSubnodes).map(s => [s.id, s.calltreeAnchor])
    const startTime = run.published.getTime()
    const callLevels: ProfileNode[] = []
    const nodes = resp.statements.map((s, id) => {
        const { context = "", name = "", uri = "", objectReferenceQuery = "" } = s.callingProgram || {}
        const { hitCount, traceEventNetTime, index, grossTime } = s
        const node: ProfileNode = {
            id: id + 1,
            callFrame: {
                functionName: context || name,
                scriptId: "0",
                url: uri || objectReferenceQuery,
                lineNumber: -1,
                columnNumber: -1
            },
            hitCount,
            children: []
        }
        callLevels[s.callLevel] = node
        callLevels[s.callLevel - 1]?.children?.push(node.id)
        return node
        // TODO collect locations, parent-child relationships
    })
    const samples = nodes.map(n => n.id)
    const timeDeltas = resp.statements.map(n => n.traceEventNetTime.time)
    const selfTime = total(timeDeltas)
    const endTime = startTime + selfTime
    return { startTime, endTime, nodes, samples, timeDeltas }
}
export const convertRun = (run: TraceRun, hitlist: TraceHitList): Profile => {
    const startTime = run.published.getTime()
    const nodes = hitlist.entries.map((e, id) => {
        const { context = "", name = "", uri = "", objectReferenceQuery = "" } = e.callingProgram || {}
        const { hitCount, traceEventNetTime, index, grossTime } = e
        return {
            id: id + 1,
            callFrame: {
                functionName: context || name,
                scriptId: "0",
                url: uri || objectReferenceQuery,
                lineNumber: -1,
                columnNumber: -1
            },
            hitCount,
            children: [],
            locationId: 0
        }
        // TODO collect locations
    })
    const samples = nodes.map(n => n.id)
    const timeDeltas = hitlist.entries.map(n => n.traceEventNetTime.time)
    const selfTime = total(timeDeltas)
    const endTime = startTime + selfTime
    return { startTime, endTime, nodes, samples, timeDeltas }
}