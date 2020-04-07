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

const convertTestMethod = (c: UnitTestClass) => (
  m: UnitTestMethod
): TestInfo => {
  return {
    type: "test",
    id: methodId(c, m),
    label: m["adtcore:name"],
    file: m["adtcore:uri"]
  }
}
const convertTestClass = (c: UnitTestClass): TestSuiteInfo => {
  return {
    type: "suite",
    id: classId(c),
    label: c["adtcore:name"],
    children: c.testmethods.map(convertTestMethod(c))
  }
}

const convertClasses = (
  obj: AbapObject,
  key: string,
  classes: UnitTestClass[]
) => {
  const suite: TestSuiteInfo = {
    type: "suite",
    children: classes.map(convertTestClass),
    id: key,
    label: obj.name
  }
  return suite
}

const methodState = (m: UnitTestMethod) => {
  let state: "passed" | "failed" = "passed"
  for (const a of m.alerts)
    if (a.severity === "critical" || a.severity === "fatal") state = "failed"
  return state
}

const isSuite = (x: any): x is TestSuiteInfo => x?.type === "suite"

export class Adapter implements TestAdapter {
  private testStateEm = new EventEmitter<TestSuiteEvent | TestEvent>()
  private testEm = new EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >()
  private root: TestSuiteInfo = {
    type: "suite",
    id: this.connId,
    label: this.connId,
    children: []
  }
  constructor(public connId: string) {}
  dispose() {
    //
  }

  async runUnit(uri: Uri) {
    const key = uri.toString()
    this.testEm.fire({ type: "started" })
    try {
      const server = fromUri(uri)
      const object = await server.findAbapObject(uri)
      const testClasses = await server.client.runUnitTest(object.path)
      let suite = this.root.children.find(c => c.id === key)
      if (!isSuite(suite)) {
        suite = convertClasses(object, key, testClasses)
        this.root.children.push(suite)
      }
      this.testEm.fire(finished(this.root))
      for (const c of testClasses)
        for (const t of c.testmethods) {
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
    for (const test of tests)
      if (test === this.root.id) {
        for (const c of this.root.children) this.runUnit(Uri.parse(c.id))
      } else
        for (const suite of [...this.root.children].filter(isSuite)) {
          let found = false
          if (suite.id === test) found = true
          else
            for (const clas of suite.children || [])
              if (clas.id === test) found = true
              else if (isSuite(clas))
                for (const met of clas.children)
                  if (met.id === test) found = true
          if (found) roots.add(suite?.id!)
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
}
