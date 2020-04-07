import {
  TestAdapter,
  TestSuiteEvent,
  TestEvent,
  TestLoadStartedEvent,
  TestLoadFinishedEvent
} from "vscode-test-adapter-api"
import { EventEmitter, Diagnostic } from "vscode"
import { after } from "../../lib"

export class Adapter implements TestAdapter {
  private testStateEm = new EventEmitter<TestSuiteEvent | TestEvent>()
  private testEm = new EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >()
  constructor(public connId: string) {}
  dispose() {
    //
  }

  async load(futureDiag?: Promise<Map<string, Diagnostic[]>>): Promise<void> {
    if (!futureDiag) return
    this.testEm.fire({ type: "started" })
    const suite: TestLoadFinishedEvent = {
      type: "finished",
      suite: {
        type: "suite",
        children: [],
        id: this.connId,
        label: this.connId
      }
    }
    for (const d of await futureDiag) {
      suite.suite!.children.push({
        type: "suite",
        id: d[0],
        label: d[0],
        children: d[1].map(c => {
          return {
            type: "test",
            id: `${c.code}`,
            label: c.message,
            file: d[0],
            line: c.range.start.line,
            description: c.source
          }
        })
      })
    }
    const diag = await futureDiag
    this.testEm.fire(suite)
  }
  async run(tests: string[]): Promise<void> {
    // console.log(tests)
  }
  cancel(): void {
    // console.log("cancel")
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
