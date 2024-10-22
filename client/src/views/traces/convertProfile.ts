import { TraceHitList, TraceRun } from "abap-adt-api/build/api/tracetypes"
import { Profile } from "v8-inspect-profiler"
export const convertRun = (run: TraceRun, hitlist: TraceHitList): Profile => {
    const startTime = new Date(run.published).getTime()
    const endTime = new Date(run.updated).getTime()
    const nodes = hitlist.entries.map((e, id) => {
        const { context: functionName = "", uri = "", objectReferenceQuery = "" } = e.callingProgram || {}
        const { hitCount, traceEventNetTime, index, grossTime } = e
        return {
            id,
            callFrame: {
                functionName,
                scriptId: "0",
                url: uri || objectReferenceQuery,
                lineNumber: -1,
                columnNumber: -1
            },
            hitCount,
            children: [],
            locationId: 0
        }
        // TODO collect samples, deltas,locations
    })
    return { startTime, endTime, nodes, samples: [], timeDeltas: [] }
}