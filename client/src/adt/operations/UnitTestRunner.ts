import { Uri, tests, TestRunProfileKind, TestRunRequest, TestController, TestItem, TestMessage, MarkdownString, commands, TestItemCollection, TestRun } from "vscode"
import { getClient, getRoot, uriRoot } from "../conections"
import { IncludeService } from "../includes"
import { isAbapFile, isAbapStat, isFolder } from "abapfs"
import { UnitTestAlert, UnitTestAlertKind, UnitTestClass, UnitTestMethod, uriPartsToString } from "abap-adt-api"
import { lineRange } from "../../lib"
import { AbapObject, isAbapClassInclude } from "abapobject"
import { AdtObjectFinder } from "./AdtObjectFinder"

const classId = (cl: UnitTestClass) => `C_${cl["adtcore:type"]} ${cl["adtcore:name"]}`
const className = (cl: UnitTestClass) => `Class ${cl["adtcore:name"]}`
const methodId = (meth: UnitTestMethod) => `M_${meth["adtcore:name"]}`
const objectKey = (object: AbapObject) => `O_${object.key}`
const splitKey = (k: string) => {
  const [_, key, value] = k.match(/^([CMO])_(.*)/) || []
  if (key && value) return { key, value }
}

const mergeTestItems = (coll: TestItemCollection, items: TestItem[], removeOld = true) => {
  const ids = new Set(items.map(i => i.id))
  const toRemove: string[] = []
  if (removeOld) {
    for (const [id, _] of coll) if (!ids.has(id)) toRemove.push(id)
    for (const id of toRemove) coll.delete(id)
  }
  for (const item of items) coll.add(item)
}

const getObject = async (uri: Uri) => {
  const incl = IncludeService.get(uri.authority).current(uri.path)
  if (incl) {
    const mo = await getRoot(uri.authority).findByAdtUri(incl["adtcore:uri"], true)
    const file = mo?.file
    if (isAbapFile(file)) return file.object
  }
  const nodepath = uriRoot(uri).getNodePath(uri.path)
  const last = nodepath[0]
  if (!isAbapStat(last.file)) throw new Error("Failed to retrieve object for test path")
  const obj = last.file.object

  if (isAbapClassInclude(last.file.object)) {
    if (last.file.object.path.match(/main$/)) return last.file.object
    const prev = nodepath[1]
    if (isFolder(prev.file))
      return [...prev.file]
        .map(x => x.file)
        .filter(isAbapStat)
        .find(x => x.object.path.match(/main$/))?.object || obj
  }

  return obj
}

interface AlertCollection { alerts: UnitTestAlert[], executionTime?: number }
const convertAlert = (alert: UnitTestAlert): TestMessage => new TestMessage(new MarkdownString(`${alert.title}<br>${alert.details.join("<br>")}`, true))
const itemOutcome = (meth: AlertCollection) => {
  const passed = !meth.alerts.filter(a => a.kind !== UnitTestAlertKind.warning).length
  return ({ messages: meth.alerts.map(convertAlert), passed })
}

const setMethodResult = (run: TestRun, meth: UnitTestMethod, item: TestItem) => {
  const outcome = itemOutcome(meth)
  if (outcome.passed)
    run.passed(item, meth.executionTime * 1000)
  else
    run.failed(item, outcome.messages, meth.executionTime * 1000)
}

const setClassResult = async (run: TestRun, clas: UnitTestClass, parent: TestItem, ctrl: TestController) => {
  const ids = new Set(clas.testmethods.map(methodId))
  let source: string | undefined
  if (clas.alerts?.length) {
    const outcome = itemOutcome(clas)
    if (outcome.passed)
      run.passed(parent)
    else
      run.failed(parent, outcome.messages)
  }
  for (const m of clas.testmethods) {
    const mi = parent.children.get(methodId(m))
    if (mi) {
      setMethodResult(run, m, mi)
    } else {
      if (!source) {
        const client = getClient(parent.uri!.authority)
        source = await client.getObjectSource(clas.navigationUri || clas["adtcore:uri"])
      }
      const nmi = await createMethodItem(ctrl, parent, m, parent.uri!, source)
      parent.children.add(nmi)
      setMethodResult(run, m, nmi)
    }
  }
  const toRemove = [...parent.children].filter(c => !ids.has(c[0]))
  toRemove.forEach(i => parent.children.delete(i[0]))
}

const setObjectResult = async (run: TestRun, classes: UnitTestClass[], parent: TestItem, ctrl: TestController) => {
  const ids = new Set(classes.map(classId))
  for (const c of classes) {
    const ci = parent.children.get(classId(c))
    if (ci) {
      await setClassResult(run, c, ci, ctrl)
    } else {
      const nci = await createClassItem(ctrl, parent, c, parent.uri!)
      parent.children.add(nci)
      await setClassResult(run, c, nci, ctrl)
    }
  }
  const toRemove = [...parent.children].filter(c => !ids.has(c[0]))
  toRemove.forEach(i => parent.children.delete(i[0]))
}

const setResults = (run: TestRun, classes: UnitTestClass[], item: TestItem, ctrl: TestController) => {
  switch (splitKey(item.id)?.key) {
    case "C":
      if (classes.length === 1)
        return setClassResult(run, classes[0], item, ctrl)
    case "M":
      if (classes.length === 1 && classes[0].testmethods.length === 1)
        return setMethodResult(run, classes[0].testmethods[0], item)
  }
  let obj = item
  while (obj.parent) obj = obj.parent
  return setObjectResult(run, classes, obj, ctrl)
}


const runHandler = (runner: UnitTestRunner) => async (request: TestRunRequest) => {
  const included = request.include || [...runner.controller.items].map(x => x[1])
  const connId = included[0].uri?.authority
  if (!connId) {
    throw new Error("No valid test found in request")
  }
  const run = runner.controller.createTestRun(request, undefined, false)
  const excluded = (i: TestItem) => request.exclude?.find(ii => i === ii)
  try {
    runonTestTree(included, t => run.enqueued(t))
    runonTestTree(included.filter(x => !excluded(x)), t => run.started(t))
    runonTestTree(included.filter(excluded), t => run.skipped(t))
    for (const i of included) {
      if (excluded(i)) continue
      const tuPath = runner.aunitPath(i.id)
      if (!tuPath) throw new Error("Unit test Uri not found")
      const classes = await getClient(connId).unitTestRun(tuPath)
      runner.setAuPaths(classes)
      await setResults(run, classes, i, runner.controller)
    }
  } finally {
    run.end()
  }
}

const runonTestTree = (root: Readonly<TestItem[]>, cb: (i: TestItem) => unknown) => {
  for (const i of root) {
    cb(i)
    runonTestTree([...i.children].map(c => c[1]), cb)
  }
}
const methodLocation = async (connId: string, objectUri: string) => {
  const finder = new AdtObjectFinder(connId)
  const { uri, start } = await finder.vscodeRange(objectUri)
  if (start) return { uri, line: start.line }
  return { uri }
}

const createMethodItem = async (c: TestController, parent: TestItem, meth: UnitTestMethod, uri: Uri, source: string) => {
  const aunitUri = meth.navigationUri || meth["adtcore:uri"]
  const client = getClient(uri.authority)
  const marker = await client.unitTestOccurrenceMarkers(aunitUri, source)
  const adturi = marker[1] ? uriPartsToString(marker[1].location) : aunitUri
  const l = await methodLocation(uri.authority, adturi)
  const muri = Uri.parse(l.uri)
  const item = parent.children.get(methodId(meth)) || c.createTestItem(methodId(meth), `${meth["adtcore:name"]}`, muri)
  if (l.line || l.line === 0) item.range = lineRange(l.line + 1)
  return item
}


const createClassItem = async (c: TestController, parent: TestItem, cl: UnitTestClass, uri: Uri) => {
  const client = getClient(uri.authority)
  const source = await client.getObjectSource(cl.navigationUri || cl["adtcore:uri"])
  const aunitUri = cl.navigationUri || cl["adtcore:uri"]
  const l = await methodLocation(uri.authority, aunitUri)
  const muri = Uri.parse(l.uri)
  const item = parent.children.get(classId(cl)) || c.createTestItem(classId(cl), className(cl), muri)
  if (l.line || l.line === 0) item.range = lineRange(l.line + 1)
  const children: TestItem[] = []
  for (const meth of cl.testmethods) children.push(await createMethodItem(c, item, meth, uri, source))
  mergeTestItems(item.children, children)
  return item
}

export class UnitTestRunner {
  private static instances = new Map<string, UnitTestRunner>()
  readonly controller
  private aunitPaths = new Map<string, string>()
  aunitPath(key: string) {
    return this.aunitPaths.get(key)
  }
  static get(connId: string) {
    const old = this.instances.get(connId)
    if (old) return old
    const instance = new UnitTestRunner(connId)
    this.instances.set(connId, instance)
    return instance
  }

  private constructor(readonly connId: string) {
    this.controller = tests.createTestController(`ABAP${connId}`, `ABAP ${connId}`)
    this.controller.createRunProfile(`ABAP ${connId}`, TestRunProfileKind.Run, runHandler(this), true)
  }

  setAuPaths(classes: UnitTestClass[]) {
    for (const c of classes) {
      this.aunitPaths.set(classId(c), c["adtcore:uri"])
      for (const m of c.testmethods)
        this.aunitPaths.set(methodId(m), m.navigationUri || m["adtcore:uri"])
    }
  }

  async addResults(uri: Uri) {
    commands.executeCommand("workbench.view.testing.focus")
    const object = await getObject(uri)
    const current = this.controller.items.get(objectKey(object)) || this.controller.createTestItem(objectKey(object), object.key, uri)
    this.controller.items.add(current)
    this.aunitPaths.set(objectKey(object), object.path)
    await runHandler(this)(new TestRunRequest([current]))
  }
}