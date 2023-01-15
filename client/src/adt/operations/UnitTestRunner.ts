import { Uri, tests, TestRunProfileKind, TestRunRequest, CancellationToken, TestController, TestItem, TestMessage, MarkdownString, commands, TestItemCollection, TestRun } from "vscode"
import { alertManagers } from "../../views/abapunit"
import { getClient, getRoot } from "../conections"
import { findAbapObject } from "./AdtObjectFinder"
import { IncludeService } from "../includes"
import { isAbapFile } from "abapfs"
import { UnitTestAlert, UnitTestAlertKind, UnitTestClass, UnitTestMethod, uriPartsToString } from "abap-adt-api"
import { cache, lineRange, log } from "../../lib"
import { MethodLocator } from "../../views/abapunit/locator"
import { AbapObject } from "abapobject"

const locators = cache((connId: string) => new MethodLocator(connId))
const classId = (cl: UnitTestClass) => `C_${cl["adtcore:type"]} ${cl["adtcore:name"]}`
const methodId = (meth: UnitTestMethod) => `M_${meth["adtcore:name"]}`
const objectKey = (object: AbapObject) => `O_${object.key}`
const splitKey = (k: string) => {
  const [_, key, value] = k.match(/^([CMO])_(.*)/) || []
  if (key && value) return { key, value }
}

const mergeTestItems = (coll: TestItemCollection, items: TestItem[]) => {
  const ids = new Set(items.map(i => i.id))
  const toRemove: string[] = []
  for (const [id, _] of coll) if (!ids.has(id)) toRemove.push(id)
  for (const id of toRemove) coll.delete(id)
  for (const item of items) coll.add(item)
}

const getObject = async (uri: Uri) => {
  const incl = IncludeService.get(uri.authority).current(uri.path)
  if (incl) {
    const mo = await getRoot(uri.authority).findByAdtUri(incl["adtcore:uri"], true)
    const file = mo?.file
    if (isAbapFile(file)) return file.object
  }
  return findAbapObject(uri)
}

const convertAlert = (alert: UnitTestAlert): TestMessage => new TestMessage(new MarkdownString(`${alert.details.join("<br>")}`, true))
const methodOutcome = (meth: UnitTestMethod) => {
  const passed = !meth.alerts.filter(a => a.kind !== UnitTestAlertKind.warning).length
  return ({ messages: meth.alerts.map(convertAlert), passed })
}

export async function abapUnit(uri: Uri) {
  const object = await getObject(uri)
  const testClasses = await getClient(uri.authority).unitTestRun(object.path)
  alertManagers.get(uri.authority).update(testClasses, true)
  commands.executeCommand("workbench.view.testing.focus")
  await UnitTestRunner.get(uri.authority).addResults(uri, object, testClasses)
}

const setMethodResult = (run: TestRun, meth: UnitTestMethod, item: TestItem) => {
  const outcome = methodOutcome(meth)
  if (outcome.passed)
    run.passed(item, meth.executionTime)
  else
    run.failed(item, outcome.messages, meth.executionTime)
}

const setClassResult = (run: TestRun, clas: UnitTestClass, item: TestItem) => {
  const ids = new Set(clas.testmethods.map(methodId))
  for (const m of clas.testmethods) {
    const mi = item.children.get(methodId(m))
    if (mi) {
      setMethodResult(run, m, mi)
    }
    // TODO
  }
  const toRemove = [...item.children].filter(c => !ids.has(c[0]))
  toRemove.forEach(i => item.children.delete(i[0]))
}

const setObjectResult = (run: TestRun, classes: UnitTestClass[], item: TestItem) => {
  const ids = new Set(classes.map(classId))
  for (const c of classes) {
    const ci = item.children.get(classId(c))
    if (ci) {
      setClassResult(run, c, ci)
    }
    // TODO
  }
  const toRemove = [...item.children].filter(c => !ids.has(c[0]))
  toRemove.forEach(i => item.children.delete(i[0]))
}

const setResults = (run: TestRun, classes: UnitTestClass[], item: TestItem) => {
  switch (splitKey(item.id)?.key) {
    case "O":
      return setObjectResult(run, classes, item)
    case "C":
      return setClassResult(run, classes[0], item)
    case "M":
      return setMethodResult(run, classes[0].testmethods[0], item)
  }
}


const runHandler = (runner: UnitTestRunner) => async (
  request: TestRunRequest,
  cancellation: CancellationToken
) => {
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
      await setResults(run, classes, i)
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
const dummyRunHandler = async (ctrl: TestController, root: TestItemCollection, classes: UnitTestClass[]) => {
  const runclasses = [...ctrl.items].map(c => c[1])
  const request = new TestRunRequest(runclasses)
  const run = ctrl.createTestRun(request, "initial", false)
  for (const clas of classes) {
    const clasTI = root.get(classId(clas))
    if (!clasTI) continue
    for (const meth of clas.testmethods) {
      const methTI = clasTI.children.get(methodId(meth))
      if (!methTI) continue
      run.started(methTI)
      setMethodResult(run, meth, methTI)
    }
  }
  run.end()
}

const createMethodItem = async (c: TestController, parent: TestItem, meth: UnitTestMethod, uri: Uri, source: string) => {
  const aunitUri = meth.navigationUri || meth["adtcore:uri"]
  const client = getClient(uri.authority)
  const marker = await client.unitTestOccurrenceMarkers(aunitUri, source)
  const adturi = marker[1] ? uriPartsToString(marker[1].location) : aunitUri
  const l = await locators.get(uri.authority).methodLocation(adturi)
  const muri = Uri.parse(l.uri)
  const item = parent.children.get(methodId(meth)) || c.createTestItem(methodId(meth), `${meth["adtcore:name"]}`, muri)
  if (l.line || l.line === 0) item.range = lineRange(l.line + 1)
  return item
}


const createClassItem = async (c: TestController, parent: TestItem, cl: UnitTestClass, uri: Uri) => {
  const client = getClient(uri.authority)
  const source = await client.getObjectSource(cl.navigationUri || cl["adtcore:uri"])
  const item = parent.children.get(classId(cl)) || c.createTestItem(classId(cl), `${cl["adtcore:type"]} ${cl["adtcore:name"]}`, uri)
  const children: TestItem[] = []
  for (const meth of cl.testmethods) children.push(await createMethodItem(c, item, meth, uri, source))
  mergeTestItems(item.children, children)
  return item
}

const getOrCreateObjectItem = async (c: TestController, object: AbapObject, classes: UnitTestClass[], uri: Uri) => {
  const item = c.items.get(objectKey(object)) || c.createTestItem(objectKey(object), object.key, uri)
  const children: TestItem[] = []
  for (const cl of classes) children.push(await createClassItem(c, item, cl, uri))
  c.items.add(item)
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

  async addResults(uri: Uri, object: AbapObject, classes: UnitTestClass[]) {
    const root = await getOrCreateObjectItem(this.controller, object, classes, uri)
    this.aunitPaths.set(objectKey(object), object.path)
    this.setAuPaths(classes)
    await dummyRunHandler(this.controller, root.children, classes)
  }
}