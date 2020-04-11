import { UnitTestClass, UnitTestMethod } from "abap-adt-api"
import { TestSuiteInfo, TestInfo, TestEvent } from "vscode-test-adapter-api"
import { AdtServer, getServer, fromUri } from "../../adt/AdtServer"
import { Uri, Position } from "vscode"
import { isAbapNode, AbapObjectNode } from "../../fs/AbapNode"
import { AbapObject } from "../../adt/abap/AbapObject"
import { alertManagers } from "./alerts"

const classId = (c: UnitTestClass) => `${c["adtcore:uri"]}`

const methodId = (c: UnitTestClass, m: UnitTestMethod) =>
  `${classId(c)}.${m["adtcore:name"]}`

interface AuMethod extends TestInfo {
  classId: string
  aunitUri: string
}
interface AuClass extends TestSuiteInfo {
  children: AuMethod[]
  aunitUri: string
}
interface AuRun extends TestSuiteInfo {
  children: AuClass[]
}
interface AuRoot extends TestSuiteInfo {
  children: AuRun[]
}

interface RunResult {
  testClasses: UnitTestClass[]
  events: TestEvent[]
}

interface TestLookup {
  run: AuRun
  clas?: AuClass
  method?: AuMethod
}

const objLabel = (o: AbapObject) =>
  `${o.type.replace(/\/.*/, "")} ${o.name.replace(/\..*/, "")}`

const methodState = (m: UnitTestMethod) => {
  let state: "passed" | "failed" = "passed"
  for (const a of m.alerts)
    if (a.severity === "critical" || a.severity === "fatal") state = "failed"
  return state
}

export class UnitTestModel {
  public readonly root: AuRoot
  private server: AdtServer
  private objSource = new Map<string, string>()
  private aliases = new Map<string, string>()

  constructor(private connId: string) {
    this.server = getServer(connId)
    this.root = {
      type: "suite",
      id: this.connId,
      label: this.connId,
      children: []
    }
  }

  public objectTestId(object: AbapObject) {
    return this.aliases.get(object.key)
  }

  private async convertClasses(
    obj: AbapObject,
    key: string,
    classes: UnitTestClass[]
  ) {
    this.objSource.clear()
    const children = []
    for (const clas of classes) children.push(await this.convertTestClass(clas))
    const suite: AuRun = {
      type: "suite",
      children,
      id: key,
      label: objLabel(obj)
    }
    return suite
  }

  private async convertTestClass(c: UnitTestClass) {
    const children: AuMethod[] = []

    for (const um of c.testmethods)
      children.push(await this.convertTestMethod(c, um))
    const cl: AuClass = {
      type: "suite",
      id: classId(c),
      label: c["adtcore:name"],
      children,
      aunitUri: c["adtcore:uri"]
    }
    return cl
  }

  private async getSource(node: AbapObjectNode) {
    const cached = this.objSource.get(node.abapObject.key)
    if (cached) return cached
    const source = (await node.fetchContents(this.server.client)).toString()
    this.objSource.set(node.abapObject.key, source)
    return source
  }

  private async methodImplementation(
    method: AuMethod,
    uri: string,
    pos: Position
  ) {
    const node = this.server.findNode(Uri.parse(uri))
    if (isAbapNode(node)) {
      if (!node.abapObject.structure)
        await node.abapObject.loadMetadata(this.server.client)
      const fu = node.abapObject.getContentsUri()
      const source = await this.getSource(node)
      return this.server.client.findDefinition(
        fu,
        source,
        pos.line + 1,
        pos.character,
        pos.character + method.label.length,
        false
      )
    }
  }

  private async convertTestMethod(c: UnitTestClass, meth: UnitTestMethod) {
    const u = await this.server.objectFinder.vscodeRange(meth["adtcore:uri"])
    const met: AuMethod = {
      type: "test",
      id: methodId(c, meth),
      label: meth["adtcore:name"],
      file: u.uri,
      classId: classId(c),
      aunitUri: meth["adtcore:uri"]
    }
    if (u.start)
      if (meth["adtcore:type"] === "PROG/OLI") met.line = u.start.line
      else {
        const impl = await this.methodImplementation(met, u.uri, u.start)
        if (impl) met.line = impl.line - 1
      }
    return met
  }

  private mergeSuite(key: string, classes: UnitTestClass[], suite: AuRun) {
    const alias = [...this.aliases].find(a =>
      classes.find(cl => classId(cl) === a[0])
    )?.[1]

    if (!alias) this.root.children.push(suite)
    for (const cl of classes) this.aliases.set(classId(cl), alias || key)
  }

  public findSuite(key: string) {
    return this.root.children.find(c => c.id === key)
  }

  private async runAbapUnit(uri: Uri, clas?: AuClass, method?: AuMethod) {
    const key = uri.toString()
    const server = fromUri(uri)
    const path = method?.aunitUri || clas?.aunitUri
    let suite = this.findSuite(key)
    let testClasses
    if (path) testClasses = await server.client.runUnitTest(path)
    else {
      const object = await server.findAbapObject(uri)
      this.aliases.set(object.getActivationSubject().key, key)
      testClasses = await server.client.runUnitTest(object.path)
      if (!suite) {
        suite = await this.convertClasses(object, key, testClasses)
        this.mergeSuite(key, testClasses, suite)
      }
    }
    return testClasses
  }

  private classesEvents(testClasses: UnitTestClass[]) {
    const events: TestEvent[] = []
    for (const c of testClasses)
      for (const t of c.testmethods) {
        events.push({
          type: "test",
          test: methodId(c, t),
          state: methodState(t)
        })
      }
    return events
  }

  public run(uris: Uri[]): Promise<RunResult>
  public run(uri: Uri, clas?: AuClass, method?: AuMethod): Promise<RunResult>
  public async run(
    uri: Uri | Uri[],
    clas?: AuClass,
    method?: AuMethod
  ): Promise<RunResult> {
    const testClasses: UnitTestClass[] = []
    if (Array.isArray(uri))
      for (const u of uri) testClasses.push(...(await this.runAbapUnit(u)))
    else testClasses.push(...(await this.runAbapUnit(uri, clas, method)))

    alertManagers.get(this.connId).update(testClasses)
    const events = this.classesEvents(testClasses)

    return { testClasses, events }
  }

  public async runTests(tests: string[]) {
    const testClasses = []
    if (tests.find(test => test === this.root.id))
      return this.run(this.root.children.map(c => Uri.parse(c.id)))
    else
      for (const test of tests) {
        const hit = this.testLookup(test)
        if (hit)
          testClasses.push(
            ...(await this.runAbapUnit(
              Uri.parse(hit?.run.id),
              hit.clas,
              hit.method
            ))
          )
      }
    const events = this.classesEvents(testClasses)
    return { testClasses, events }
  }

  private testLookup(test: string): TestLookup | undefined {
    const inClass = (clas: AuClass) => {
      if (test === clas.id) return { clas }
      const method = clas.children.find(m => m.id === test)
      if (method) return { clas, method }
    }

    const inRun = (run: AuRun) => {
      if (test === run.id) return { run }
      for (const clas of run.children) {
        const found = inClass(clas)
        if (found) return { run, ...found }
      }
    }

    for (const root of this.root.children) {
      const found = inRun(root)
      if (found) return found
    }
  }
}
