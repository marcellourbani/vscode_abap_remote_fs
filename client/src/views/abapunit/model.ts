import { UnitTestClass, UnitTestMethod } from "abap-adt-api"
import { Uri } from "vscode"
import { TestEvent, TestInfo, TestSuiteInfo } from "vscode-test-adapter-api"
import { AbapObject } from "../../adt/abap/AbapObject"
import { AdtServer, fromUri, getServer } from "../../adt/AdtServer"
import { alertManagers } from "./alerts"
import { MethodLocator } from "./locator"

const classId = (c: UnitTestClass) => `${c["adtcore:uri"]}`

const methodId = (c: UnitTestClass, m: UnitTestMethod) =>
  `${classId(c)}.${m["adtcore:name"]}`

interface AuMethod extends TestInfo {
  classId: string
  aunitUri: string
  objType: string
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

interface AuMethodEvent extends TestEvent {
  test: AuMethod
}

interface RunResult {
  testClasses: UnitTestClass[]
  events: AuMethodEvent[]
}

interface TestLookup {
  run?: AuRun
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
  private aliases = new Map<string, string>()

  private locator: MethodLocator

  constructor(private connId: string) {
    this.locator = new MethodLocator(this.connId)
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

  private async convertTestMethod(c: UnitTestClass, meth: UnitTestMethod) {
    const loc = await this.locator.methodLocation(
      meth["adtcore:uri"],
      meth["adtcore:type"]
    )
    const met: AuMethod = {
      type: "test",
      id: methodId(c, meth),
      label: meth["adtcore:name"],
      file: loc.uri,
      line: loc.line,
      classId: classId(c),
      aunitUri: meth["adtcore:uri"],
      objType: meth["adtcore:type"]
    }
    return met
  }

  private mergeSuite(key: string, classes: UnitTestClass[], run: AuRun) {
    const alias = [...this.aliases].find(a =>
      classes.find(cl => classId(cl) === a[0])
    )?.[1]

    const replaceSuite = (r: AuRun) => (r.id === alias ? run : r)

    if (alias) this.root.children = this.root.children.map(replaceSuite)
    else this.root.children.push(run)
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
      suite = await this.convertClasses(object, key, testClasses)
      this.mergeSuite(key, testClasses, suite)
    }
    return testClasses
  }

  private async classesEvents(testClasses: UnitTestClass[], partial = false) {
    const events: AuMethodEvent[] = []
    for (const testclas of testClasses)
      for (const testmet of testclas.testmethods) {
        const event = this.methodEvent(testclas, testmet)

        if (event) {
          const loc = await this.locator.methodLocation(
            testmet["adtcore:uri"],
            testmet["adtcore:type"]
          )
          event.test.line = loc.line
          event.test.file = loc.uri
          events.push(event)
        }
      }
    if (partial) this.updateSkipped(events)
    return events
  }

  private async updateSkipped(ev: AuMethodEvent[]) {
    const files = new Set<string>()
    const runs = new Set<AuRun>()
    // ev[0]!.test
    for (const e of ev) {
      if (e.test.file) files.add(e.test.file)
      const { run } = this.testLookup(e.test.id)
      if (run) runs.add(run)
    }
    for (const run of runs)
      for (const clas of run.children)
        for (const test of clas.children)
          if (
            test.file &&
            files.has(test.file) &&
            !ev.find(e => e.test.id === test.id)
          ) {
            const loc = await this.locator.methodLocation(
              test.aunitUri,
              test.objType
            )
            test.file = loc.uri
            test.line = loc.line
          }
  }

  private methodEvent(
    testclas: UnitTestClass,
    testmet: UnitTestMethod
  ): AuMethodEvent | undefined {
    const { method } = this.testLookup(methodId(testclas, testmet))
    if (method)
      return {
        type: "test",
        test: method,
        state: methodState(testmet)
      }
  }

  public run(uris: Uri[]): Promise<RunResult>
  public run(uri: Uri, clas?: AuClass, method?: AuMethod): Promise<RunResult>
  public async run(
    uri: Uri | Uri[],
    clas?: AuClass,
    method?: AuMethod
  ): Promise<RunResult> {
    this.locator.clear()
    const testClasses: UnitTestClass[] = []
    if (Array.isArray(uri))
      for (const u of uri) testClasses.push(...(await this.runAbapUnit(u)))
    else testClasses.push(...(await this.runAbapUnit(uri, clas, method)))

    alertManagers.get(this.connId).update(testClasses)
    const events = await this.classesEvents(testClasses, !!clas)

    return { testClasses, events }
  }

  public async runTests(tests: string[]) {
    this.locator.clear()
    const testClasses = []
    let partial = false
    if (tests.find(test => test === this.root.id))
      return this.run(this.root.children.map(c => Uri.parse(c.id)))
    else
      for (const test of tests) {
        const { run, clas, method } = this.testLookup(test)
        if (run) {
          if (clas) partial = true
          testClasses.push(
            ...(await this.runAbapUnit(Uri.parse(run.id), clas, method))
          )
        }
      }
    const events = await this.classesEvents(testClasses, partial)
    return { testClasses, events }
  }

  private testLookup(test: string): TestLookup {
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
    return {}
  }
}
