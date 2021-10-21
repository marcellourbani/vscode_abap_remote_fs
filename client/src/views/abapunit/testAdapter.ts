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
import { EventEmitter, Uri } from "vscode"
import {
  ActivationEvent,
  AdtObjectActivator
} from "../../adt/operations/AdtObjectActivator"
import { UnitTestModel } from "./model"
import { caughtToString, isString } from "../../lib"

const finished = (suite?: TestSuiteInfo): TestLoadFinishedEvent => ({
  type: "finished",
  suite
})

const runFinished: TestRunFinishedEvent = { type: "finished" }
const extractTestId = (e: string | TestInfo) => (isString(e) ? e : e.id)

export class Adapter implements TestAdapter {
  private testStateEm = new EventEmitter<
    TestSuiteEvent | TestEvent | TestRunStartedEvent | TestRunFinishedEvent
  >()
  private testEm = new EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >()
  private retireEm = new EventEmitter<RetireEvent>()
  private model: UnitTestModel

  constructor(public connId: string) {
    this.model = new UnitTestModel(connId)
    AdtObjectActivator.get(connId).onActivate(this.onActivate.bind(this))
  }

  private async onActivate(e: ActivationEvent) {
    const key = this.model.objectTestId(e.activated)
    if (key) {
      this.model.updateUri(key)
      this.testEm.fire({ type: "finished", suite: this.model.root })
      this.retireEm.fire({ tests: [key] })
    }
  }

  async runUnit(uri: Uri) {
    this.testEm.fire({ type: "started" })
    try {
      const { events } = await this.model.run(uri)
      this.testEm.fire(finished(this.model.root))
      const tests = events.map(e => extractTestId(e.test))
      this.testStateEm.fire({ type: "started", tests })
      for (const e of events) this.testStateEm.fire(e)
      this.testStateEm.fire(runFinished)
    } catch (e) {
      this.testEm.fire({ type: "finished", errorMessage: caughtToString(e) })
      throw e
    }
  }

  async load(): Promise<void> {
    // nothing to do, load happens on run really. Bit weird...
  }

  async run(tests: string[]) {
    this.testStateEm.fire({ type: "started", tests })
    for (const test of tests)
      this.testStateEm.fire({ type: "test", test, state: "running" })
    try {
      const { events } = await this.model.runTests(tests)
      this.testEm.fire({ type: "finished", suite: this.model.root })
      for (const e of events) this.testStateEm.fire(e)
      this.testStateEm.fire(runFinished)
    } catch (e) {
      // do nothing
    }
    this.testStateEm.fire(runFinished)
  }
  cancel(): void {
    // can't stop running unit tests yet
  }
  get tests() {
    return this.testEm.event
  }

  get retire() {
    return this.retireEm.event
  }

  get testStates() {
    return this.testStateEm.event
  }
}
