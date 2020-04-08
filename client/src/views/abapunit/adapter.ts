import {
  TestAdapter,
  TestSuiteEvent,
  TestEvent,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestSuiteInfo,
  TestInfo
} from "vscode-test-adapter-api"
import { EventEmitter, Diagnostic, Uri } from "vscode"
import { fromUri } from "../../adt/AdtServer"
import { UnitTestClass, UnitTestMethod, UnitTestAlert } from "abap-adt-api"
import { AbapObject } from "../../adt/abap/AbapObject"

// const convertTestAlert = (m: UnitTestMethod) => {
//   let num = 1
//   return (a: UnitTestAlert): TestInfo => {
//     return {
//       type: "test",
//       id: `${m["adtcore:name"]}${num++}`,
//       label: a.details.join("/"),
//       file: a.stack[0]!["adtcore:name"]
//     }
//   }
// }

const methodId = (c: UnitTestClass, m: UnitTestMethod) =>
  `${c["adtcore:name"]}.${m["adtcore:name"]}`

const classId = (c: UnitTestClass) => `${c["adtcore:name"]}`

const finished = (suite: TestSuiteInfo): TestLoadFinishedEvent => ({
  type: "finished",
  suite
})

interface AuMethod extends TestInfo {
  classId: string
}
interface AuClass extends TestSuiteInfo {
  children: AuMethod[]
}
interface AuRun extends TestSuiteInfo {
  children: AuClass[]
}
interface AuRoot extends TestSuiteInfo {
  children: AuRun[]
}
const convertTestMethod = (c: UnitTestClass) => (m: UnitTestMethod) => {
  const met: AuMethod = {
    type: "test",
    id: methodId(c, m),
    label: m["adtcore:name"],
    file: m["adtcore:uri"],
    classId: classId(c)
  }
  return met
}
const convertTestClass = (c: UnitTestClass) => {
  const cl: AuClass = {
    type: "suite",
    id: classId(c),
    label: c["adtcore:name"],
    children: c.testmethods.map(convertTestMethod(c))
  }
  return cl
}

const convertClasses = (
  obj: AbapObject,
  key: string,
  classes: UnitTestClass[]
) => {
  const suite: AuRun = {
    type: "suite",
    children: classes.map(convertTestClass),
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
  private testStateEm = new EventEmitter<TestSuiteEvent | TestEvent>()
  private testEm = new EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >()
  private aliases = new Map<string, string>()
  private root: AuRoot = {
    type: "suite",
    id: this.connId,
    label: this.connId,
    children: []
  }
  constructor(public connId: string) {}
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

  async runUnit(uri: Uri) {
    const key = uri.toString()
    this.testEm.fire({ type: "started" })
    try {
      const server = fromUri(uri)
      const object = await server.findAbapObject(uri)
      const testClasses = await server.client.runUnitTest(object.path)
      let suite = this.findSuite(key)
      if (!suite) {
        suite = convertClasses(object, key, testClasses)
        this.addSuite(key, suite, testClasses)
      }
      this.testEm.fire(finished(this.root))
      for (const c of testClasses)
        for (const t of c.testmethods) {
          const u = await server.objectFinder.vscodeRange(t["adtcore:uri"])
          // tslint:disable-next-line:no-console
          console.log(u)
          this.testStateEm.fire({
            type: "test",
            test: methodId(c, t),
            state: methodState(t)
          })
        }
    } catch (e) {
      this.testEm.fire({ type: "finished", errorMessage: e.toString() })
    }
  }

  async load(): Promise<void> {
    // nothing to do
  }

  async run(tests: string[]) {
    const roots = new Set<string>()

    if (tests.find(test => test === this.root.id))
      for (const c of this.root.children) this.runUnit(Uri.parse(c.id))
    else
      for (const test of tests) {
        const run = this.testRoot(test)
        if (run) roots.add(run.id)
      }

    for (const uri of roots) this.runUnit(Uri.parse(uri))
  }
  cancel(): void {
    // not implemented yet
  }
  get tests() {
    return this.testEm.event
  }
  //   retire?: Event<RetireEvent> | undefined
  //   autorun?: Event<void> | undefined
  get testStates() {
    return this.testStateEm.event
  }

  private testRoot(test: string) {
    const inClass = (clas: AuClass) =>
      test === clas.id || !!clas.children.find(m => m.id === test)

    const inRun = (run: AuRun) =>
      run.id === test || !!run.children.find(inClass)

    return this.root.children.find(inRun)
  }
}
