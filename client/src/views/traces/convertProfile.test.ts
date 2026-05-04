// Tests for views/traces/convertProfile.ts
import { convertStatements, convertRun } from "./convertProfile"
import { TraceHitList, TraceRun, TraceStatementResponse } from "abap-adt-api/build/api/tracetypes"

jest.mock("../../lib", () => ({ log: jest.fn() }))

const makeRun = (publishedMs = 1000000): TraceRun =>
  ({
    published: new Date(publishedMs),
    id: "trace-1",
    title: "Test Trace",
    author: "DEV",
    type: "ABAP",
    extendedData: {
      runtime: 500,
      host: "server01",
      objectName: "ZREPORT",
      runtimeABAP: 300,
      runtimeDatabase: 100,
      runtimeSystem: 100,
      isAggregated: false,
      state: { text: "OK", value: "S" },
      system: "DEV"
    }
  } as any)

const makeStatement = (
  id: number,
  callLevel: number,
  netTime: number
) => ({
  index: id,
  callLevel,
  hitCount: 1,
  traceEventNetTime: { time: netTime },
  grossTime: netTime + 10,
  description: `stmt_${id}`,
  callingProgram: {
    context: `ctx_${id}`,
    name: `prog_${id}`,
    uri: `/sap/bc/adt/prog/${id}`,
    objectReferenceQuery: ""
  }
})

const makeStatementResponse = (statements: any[]): TraceStatementResponse =>
  ({ statements } as any)

const makeHitlistEntry = (id: number, netTime: number) => ({
  index: id,
  hitCount: id + 1,
  traceEventNetTime: { time: netTime },
  grossTime: netTime + 5,
  description: `hit_${id}`,
  callingProgram: {
    context: `ctx_${id}`,
    name: `prog_${id}`,
    uri: `/sap/bc/adt/prog/${id}`,
    objectReferenceQuery: ""
  }
})

const makeHitList = (entries: any[]): TraceHitList => ({ entries } as any)

describe("convertStatements", () => {
  const run = makeRun(1_000_000)
  const connId = "DEV100"

  it("returns a Profile with correct startTime from run.published", () => {
    const resp = makeStatementResponse([makeStatement(0, 0, 100)])
    const profile = convertStatements(run, resp, connId)
    expect(profile.startTime).toBe(run.published.getTime())
  })

  it("computes endTime = startTime + sum of timeDeltas", () => {
    const resp = makeStatementResponse([
      makeStatement(0, 0, 100),
      makeStatement(1, 1, 200)
    ])
    const profile = convertStatements(run, resp, connId)
    const expectedSelfTime = 0 + 100 + 200 // timeDeltas: [0, ...statement times]
    expect(profile.endTime).toBe(profile.startTime + expectedSelfTime)
  })

  it("creates one node per statement", () => {
    const resp = makeStatementResponse([
      makeStatement(0, 0, 50),
      makeStatement(1, 1, 50),
      makeStatement(2, 1, 50)
    ])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes.length).toBe(3)
  })

  it("assigns sequential node ids starting from 1", () => {
    const resp = makeStatementResponse([makeStatement(0, 0, 10), makeStatement(1, 1, 20)])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].id).toBe(1)
    expect(profile.nodes[1].id).toBe(2)
  })

  it("uses statement description as functionName", () => {
    const resp = makeStatementResponse([makeStatement(0, 0, 10)])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].callFrame.functionName).toBe("stmt_0")
  })

  it("encodes connId and uri in node url as command uri", () => {
    const resp = makeStatementResponse([makeStatement(0, 0, 10)])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].callFrame.url).toContain("abapfs.showObject")
    expect(profile.nodes[0].callFrame.url).toContain(encodeURIComponent(connId))
  })

  it("sets hitCount from statement", () => {
    const stmt = makeStatement(0, 0, 10)
    stmt.hitCount = 5
    const resp = makeStatementResponse([stmt])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].hitCount).toBe(5)
  })

  it("builds parent-child relationships based on callLevel", () => {
    const resp = makeStatementResponse([
      makeStatement(0, 0, 10),
      makeStatement(1, 1, 20) // child of level 0
    ])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].children).toContain(2) // id of node at index 1
  })

  it("returns empty profile for empty statement list", () => {
    const resp = makeStatementResponse([])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes).toHaveLength(0)
    expect(profile.samples).toEqual([1]) // always has initial sample
    expect(profile.timeDeltas).toEqual([0]) // always has initial delta
  })

  it("sets scriptId to '0' for all nodes", () => {
    const resp = makeStatementResponse([makeStatement(0, 0, 10)])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].callFrame.scriptId).toBe("0")
  })

  it("uses objectReferenceQuery when uri is empty", () => {
    const stmt = makeStatement(0, 0, 10)
    stmt.callingProgram.uri = ""
    stmt.callingProgram.objectReferenceQuery = "/sap/bc/adt/fallback"
    const resp = makeStatementResponse([stmt])
    const profile = convertStatements(run, resp, connId)
    expect(profile.nodes[0].callFrame.url).toContain("fallback")
  })
})

describe("convertRun", () => {
  const run = makeRun(2_000_000)
  const connId = "QA100"

  it("returns a Profile with correct startTime from run.published", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 100)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.startTime).toBe(run.published.getTime())
  })

  it("computes endTime = startTime + sum of timeDeltas", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 100), makeHitlistEntry(1, 200)])
    const profile = convertRun(run, hitlist, connId)
    const selfTime = 0 + 100 + 200
    expect(profile.endTime).toBe(profile.startTime + selfTime)
  })

  it("creates nodes for each hitlist entry", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10), makeHitlistEntry(1, 20)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.nodes).toHaveLength(2)
  })

  it("sets node id starting from 1", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.nodes[0].id).toBe(1)
  })

  it("uses entry description as functionName", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.nodes[0].callFrame.functionName).toBe("hit_0")
  })

  it("sets children to undefined for leaf nodes", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.nodes[0].children).toBeUndefined()
  })

  it("builds samples array starting with 1", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10), makeHitlistEntry(1, 20)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.samples![0]).toBe(1)
  })

  it("builds timeDeltas starting with 0", () => {
    const hitlist = makeHitList([makeHitlistEntry(0, 10)])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.timeDeltas![0]).toBe(0)
    expect(profile.timeDeltas![1]).toBe(10)
  })

  it("handles empty hitlist", () => {
    const hitlist = makeHitList([])
    const profile = convertRun(run, hitlist, connId)
    expect(profile.nodes).toHaveLength(0)
    expect(profile.samples).toEqual([1])
    expect(profile.timeDeltas).toEqual([0])
  })
})
