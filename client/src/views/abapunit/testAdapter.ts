import {
  TestAdapter,
  TestSuiteEvent,
  TestEvent,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestSuiteInfo,
  TestInfo,
  RetireEvent,
  TestRunFinishedEvent,
  TestRunStartedEvent
} from "vscode-test-adapter-api"
import {
  EventEmitter,
  Uri,
  Diagnostic,
  Range,
  Position,
  DiagnosticSeverity,
  DiagnosticCollection,
  languages
} from "vscode"
import { fromUri, AdtServer, getServer } from "../../adt/AdtServer"
import {
  UnitTestClass,
  UnitTestMethod,
  UnitTestSeverity,
  UnitTestAlert
} from "abap-adt-api"
import { AbapObject } from "../../adt/abap/AbapObject"
import { isAbapNode } from "../../fs/AbapNode"
import { ActivationEvent } from "../../adt/operations/AdtObjectActivator"
import { cache } from "../../lib"

const convertSeverity = (s: UnitTestSeverity) => {
  switch (s) {
    case UnitTestSeverity.critical:
    case UnitTestSeverity.fatal:
      return DiagnosticSeverity.Error
    case UnitTestSeverity.tolerable:
      return DiagnosticSeverity.Warning
    case UnitTestSeverity.tolerant:
      return DiagnosticSeverity.Information
  }
}

const convertTestAlert = async (
  server: AdtServer,
  alrt: UnitTestAlert,
  maxSeverity = DiagnosticSeverity.Warning
) => {
  const severity = convertSeverity(alrt.severity)
  if (severity > maxSeverity) return
  const [error, ...parents] = alrt.stack
  const { uri, start } = await server.objectFinder.vscodeRange(
    error["adtcore:uri"]
  )
  if (!start) return
  const range = new Range(start, new Position(start.line, 1000))
  const diagnostic = new Diagnostic(range, alrt.details.join("\n"), severity)
  diagnostic.source = `Abap Unit ${server.connectionId}`
  return { uri, diagnostic }
}

const classId = (c: UnitTestClass) => `${c["adtcore:uri"]}`

const methodId = (c: UnitTestClass, m: UnitTestMethod) =>
  `${classId(c)}.${m["adtcore:name"]}`

const finished = (suite?: TestSuiteInfo): TestLoadFinishedEvent => ({
  type: "finished",
  suite
})

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

interface TestLookup {
  run: AuRun
  clas?: AuClass
  method?: AuMethod
}

const convertTestMethod = async (
  server: AdtServer,
  c: UnitTestClass,
  meth: UnitTestMethod
) => {
  const u = await server.objectFinder.vscodeRange(meth["adtcore:uri"])
  const met: AuMethod = {
    type: "test",
    id: methodId(c, meth),
    label: meth["adtcore:name"],
    file: u.uri,
    classId: classId(c),
    aunitUri: meth["adtcore:uri"]
  }
  if (u.start) {
    const node = server.findNode(Uri.parse(u.uri))
    if (isAbapNode(node)) {
      try {
        if (!node.abapObject.structure)
          await node.abapObject.loadMetadata(server.client)
        const fu = node.abapObject.getContentsUri()
        const source = (await node.fetchContents(server.client)).toString()
        const result = await server.client.findDefinition(
          fu,
          source,
          u.start.line + 1,
          u.start.character,
          u.start.character,
          true
        )
        if (result.line) met.line = result.line - 1
      } catch (error) {
        throw error
      }
    }
  }
  return met
}
const convertTestClass = async (server: AdtServer, c: UnitTestClass) => {
  const children: AuMethod[] = []

  for (const um of c.testmethods)
    children.push(await convertTestMethod(server, c, um))
  const cl: AuClass = {
    type: "suite",
    id: classId(c),
    label: c["adtcore:name"],
    children,
    aunitUri: c["adtcore:uri"]
  }
  return cl
}

const convertClasses = async (
  server: AdtServer,
  obj: AbapObject,
  key: string,
  classes: UnitTestClass[]
) => {
  const children = []
  for (const clas of classes)
    children.push(await convertTestClass(server, clas))
  const suite: AuRun = {
    type: "suite",
    children,
    id: key,
    label: obj.name.replace(/\..*/, "")
  }
  return suite
}

const methodState = (m: UnitTestMethod) => {
  let state: "passed" | "failed" = "passed"
  for (const a of m.alerts)
    if (a.severity === "critical" || a.severity === "fatal") state = "failed"
  return state
}

export class Adapter implements TestAdapter {
  private testStateEm = new EventEmitter<
    TestSuiteEvent | TestEvent | TestRunStartedEvent | TestRunFinishedEvent
  >()
  private testEm = new EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >()
  private retireEm = new EventEmitter<RetireEvent>()
  private aliases = new Map<string, string>()
  private root: AuRoot = {
    type: "suite",
    id: this.connId,
    label: this.connId,
    children: []
  }
  onActivate(e: ActivationEvent) {
    const key = this.aliases.get(e.activated.key)
    if (key) this.retireEm.fire({ tests: [key] })
  }
  constructor(public connId: string) {
    getServer(connId).activator.onActivate(this.onActivate.bind(this))
  }
  dispose() {
    //
  }

  private findSuite(key: string) {
    return this.root.children.find(c => c.id === key)
  }
  private addSuite(key: string, suite: AuRun, classes: UnitTestClass[]) {
    const alias = [...this.aliases].find(a =>
      classes.find(cl => classId(cl) === a[0])
    )?.[1]

    if (!alias) this.root.children.push(suite)
    for (const cl of classes) this.aliases.set(classId(cl), alias || key)
  }

  async runUnit(uri: Uri, clas?: AuClass, method?: AuMethod) {
    const key = uri.toString()
    this.testEm.fire({ type: "started" })
    try {
      const server = fromUri(uri)
      const path = method?.aunitUri || clas?.aunitUri
      const suite = this.findSuite(key)
      let testClasses
      if (path) {
        this.testStateEm.fire({ type: "started", tests: [path] })
        testClasses = await server.client.runUnitTest(path)
      } else {
        this.testStateEm.fire({ type: "started", tests: [key] })
        const object = await server.findAbapObject(uri)
        this.aliases.set(object.getActivationSubject().key, key)
        testClasses = await server.client.runUnitTest(object.path)
        if (!suite) {
          const newSuite = await convertClasses(
            server,
            object,
            key,
            testClasses
          )
          this.addSuite(key, newSuite, testClasses)
        }
      }
      if (suite)
        this.testEm.fire(finished(this.root.children.find(c => c.id === key)))
      else this.testEm.fire(finished(this.root))
      this.testStateEm.fire({
        type: "started",
        tests: testClasses.flatMap(c => c.testmethods.map(m => methodId(c, m)))
      })

      await this.updateTestStatus(testClasses)
      this.testStateEm.fire({ type: "finished" })
      await this.refreshAlerts(testClasses, server)
    } catch (e) {
      this.testEm.fire({ type: "finished", errorMessage: e.toString() })
    }
  }

  private updateTestStatus(testClasses: UnitTestClass[]) {
    for (const c of testClasses)
      for (const t of c.testmethods) {
        this.testStateEm.fire({
          type: "test",
          test: methodId(c, t),
          state: methodState(t)
        })
      }
  }
  private alerts = languages.createDiagnosticCollection(
    `Abap Unit ${this.connId}`
  )
  private async refreshAlerts(testClasses: UnitTestClass[], server: AdtServer) {
    this.alerts.clear()
    const newAlerts = new Map<string, Diagnostic[]>()
    for (const clas of testClasses)
      for (const method of clas.testmethods) {
        for (const alrt of method.alerts) {
          const { uri, diagnostic } =
            (await convertTestAlert(server, alrt)) || {}
          if (uri && diagnostic) {
            const fileDiags = newAlerts.get(uri) || []
            if (fileDiags.length === 0) newAlerts.set(uri, fileDiags)
            fileDiags.push(diagnostic)
          }
        }
      }
    for (const [uri, diags] of newAlerts) this.alerts.set(Uri.parse(uri), diags)
  }

  async load(): Promise<void> {
    // nothing to do
  }

  async run(tests: string[]) {
    if (tests.find(test => test === this.root.id))
      for (const c of this.root.children) this.runUnit(Uri.parse(c.id))
    else
      for (const test of tests) {
        const hit = this.testLookup(test)
        if (hit) this.runUnit(Uri.parse(hit?.run.id), hit.clas, hit.method)
      }
  }
  cancel(): void {
    // not implemented yet
  }
  get tests() {
    return this.testEm.event
  }

  get retire() {
    return this.retireEm.event
  }
  //   autorun?: Event<void> | undefined
  get testStates() {
    return this.testStateEm.event
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
