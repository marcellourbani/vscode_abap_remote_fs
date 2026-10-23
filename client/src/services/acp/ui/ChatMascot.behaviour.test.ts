import { createMascotHarness, type MascotHarness } from "./ChatMascot.testHarness"

const IDLE_TRICKS = [
  "sniff",
  "stretch",
  "scratch",
  "shake",
  "shakeoff",
  "bow",
  "look",
  "tilt",
  "roll",
  "belly",
  "paw",
  "sit",
  "sneeze",
  "pounce"
]

describe("ACP Max agent activity", () => {
  it("runs back and forth between the walls while connecting, then celebrates", () => {
    const harness = createMascotHarness()
    harness.pet.setActivity("connecting")
    expect(harness.row.dataset.activity).toBe("connecting")
    expect(harness.pose()).toBe("run")
    harness.until(() => harness.dog.style.left === "89%")
    harness.until(() => harness.dog.style.left === "11%")
    harness.pet.setActivity("idle")
    expect(harness.pose()).toBe("celebrate")
    expect(harness.sparks()).toHaveLength(6)
  })

  it("looks concerned after a failure, without any celebration", () => {
    const harness = createMascotHarness()
    harness.pet.setActivity("working")
    harness.pet.setActivity("error")
    expect(harness.row.dataset.activity).toBe("error")
    expect(harness.pose()).toBe("sad")
    expect(harness.mark.textContent).toBe("?")
    expect(harness.sparks()).toHaveLength(0)
  })

  it("abandons a trick to beg while a turn is running and celebrates when it ends", () => {
    const harness = createMascotHarness()
    harness.pet.react("sit")
    harness.pet.setActivity("working")
    harness.advance(32)
    expect(harness.pose()).toBe("beg")
    expect(harness.row.dataset.activity).toBe("working")
    harness.pet.setActivity("idle")
    expect(harness.pose()).toBe("celebrate")
    expect(harness.sparks()).toHaveLength(6)
  })

  it("begs the instant a prompt is sent and gives up if the host never confirms", () => {
    const harness = createMascotHarness()
    harness.clickAt(70)
    harness.pet.submit()
    harness.advance(32)
    expect(harness.pose()).toBe("beg")
    expect(harness.row.dataset.activity).toBe("talking")
    harness.advance(2300)
    expect(harness.row.dataset.activity).toBe("talking")
    harness.advance(300)
    expect(harness.row.dataset.activity).toBe("idle")
    expect(harness.pose()).not.toBe("beg")
  })

  it("barks along with streamed text, moving the jaw", () => {
    const harness = createMascotHarness()
    harness.pet.speak()
    expect(harness.row.dataset.activity).toBe("talking")
    const jaws = harness.trace(400, () => harness.attr("jawG", "transform"))
    expect(jaws.size).toBeGreaterThan(5)
    expect(harness.attr("jawG", "transform")).toMatch(/ 10 3\.8\)$/)
  })

  it("interrupts only attention tricks when talking", () => {
    const harness = createMascotHarness()
    harness.pet.react("look")
    harness.pet.speak()
    harness.advance(32)
    expect(harness.pose()).toBe("beg")
    harness.pet.react("sit")
    harness.pet.speak()
    harness.advance(32)
    expect(harness.pose()).toBe("sit")
  })

  it("stays quiet while hidden", () => {
    const harness = createMascotHarness()
    harness.advance(16)
    harness.pet.setEnabled(false)
    harness.pet.speak()
    harness.pet.submit()
    expect(harness.row.dataset.activity).toBe("idle")
  })
})

describe("ACP Max tool tracking", () => {
  it("investigates only once a tool has been running for a while", () => {
    const harness = createMascotHarness()
    harness.pet.toolUpdate("lookup", "pending")
    expect(harness.row.dataset.activity).toBe("tool")
    harness.advance(500)
    expect(harness.pose()).not.toBe("investigate")
    harness.advance(400)
    expect(harness.pose()).toBe("investigate")
  })

  it("ignores instant tool calls", () => {
    const harness = createMascotHarness()
    harness.pet.toolUpdate("quick", "pending")
    harness.advance(200)
    harness.pet.toolUpdate("quick", "completed")
    expect(harness.trace(2000, harness.pose)).not.toContain("investigate")
  })

  it("keeps investigating until every overlapping tool is back, then lingers briefly", () => {
    const harness = createMascotHarness()
    harness.pet.setActivity("working")
    harness.pet.toolUpdate("first", "pending")
    harness.pet.toolUpdate("second", "in_progress")
    harness.advance(900)
    harness.pet.toolUpdate("first", "completed")
    harness.advance(1500)
    expect(harness.row.dataset.activity).toBe("tool")
    expect(harness.pose()).toBe("investigate")
    harness.pet.toolUpdate("second", "failed")
    expect(harness.row.dataset.activity).toBe("working")
    harness.advance(1000)
    expect(harness.pose()).toBe("investigate")
    harness.advance(400)
    expect(harness.pose()).toBe("beg")
  })

  it("forgets pending tools when the turn ends and ignores updates without an id", () => {
    const harness = createMascotHarness()
    harness.advance(16)
    harness.pet.toolUpdate("", "pending")
    expect(harness.row.dataset.activity).toBe("idle")
    harness.pet.setActivity("working")
    harness.pet.toolUpdate("orphan", "pending")
    harness.pet.setActivity("error")
    harness.advance(32)
    expect(harness.row.dataset.activity).toBe("idle")
  })
})

describe("ACP Max watching the prompt", () => {
  const facingRight = (harness: MascotHarness) => harness.facing.style.transform !== "scaleX(-1)"
  const caretPercent = (harness: MascotHarness) => (harness.prompt!.selectionEnd * 8) / 4
  /** The caret is laid out in an off-screen mirror, created on the first measurement */
  const mirror = (harness: MascotHarness) => harness.body.children[0]
  const settleWatching = (harness: MascotHarness) =>
    harness.until(() => harness.pose() === "watch", 3000)

  it("walks over and stands left of the caret, looking at it", () => {
    const harness = createMascotHarness()
    harness.type("x".repeat(30))
    harness.advance(32)
    expect(harness.pose()).toBe("run")
    settleWatching(harness)
    expect(harness.position()).toBeGreaterThan(30)
    expect(harness.position()).toBeLessThan(caretPercent(harness))
    expect(facingRight(harness)).toBe(true)
  })

  it("measures the caret in one hidden mirror element", () => {
    const harness = createMascotHarness()
    harness.type("hello")
    harness.advance(32)
    harness.type("hello world")
    harness.advance(32)
    const mirrors = harness.body.children.filter(c => c.getAttribute("aria-hidden") === "true")
    expect(mirrors).toHaveLength(1)
    expect(mirrors[0].style.width).toBe("400px")
    expect(mirrors[0].textContent).toBe("hello world")
  })

  it("stands right of the caret and looks back when it is too close to the left wall", () => {
    const harness = createMascotHarness()
    harness.type("xxx")
    harness.until(() => harness.facing.style.transform === "scaleX(-1)", 1500)
    harness.advance(800)
    expect(harness.position()).toBeGreaterThan(caretPercent(harness))
  })

  it("turns toward a caret when Max starts to its right on a wide stage", () => {
    const harness = createMascotHarness()
    harness.stage.clientWidth = 2800
    harness.stage.rect.width = 2800
    harness.prompt!.clientWidth = 2800
    harness.prompt!.rect.width = 2800
    harness.pet.setState({ position: 90 })
    harness.type("x".repeat(25))
    harness.until(() => harness.facing.style.transform === "scaleX(-1)", 1500)
    harness.advance(800)
    expect(harness.position()).toBeLessThan(90)
    expect(harness.facing.style.transform).toBe("scaleX(-1)")
  })

  it("uses the start of a backwards selection as the caret", () => {
    const harness = createMascotHarness()
    harness.prompt!.focus()
    harness.prompt!.value = "x".repeat(40)
    harness.prompt!.selectionStart = 2
    harness.prompt!.selectionEnd = 40
    harness.prompt!.selectionDirection = "backward"
    harness.prompt!.dispatch("input")
    harness.advance(32)
    expect(mirror(harness).textContent).toBe("xx")
  })

  it("notices caret moves that fire no events while the prompt has focus", () => {
    const harness = createMascotHarness()
    harness.prompt!.value = "some text"
    harness.prompt!.selectionStart = harness.prompt!.selectionEnd = 4
    harness.advance(100)
    expect(mirror(harness)).toBeUndefined()
    harness.prompt!.focus()
    harness.prompt!.selectionStart = harness.prompt!.selectionEnd = 9
    harness.advance(32)
    expect(mirror(harness).textContent).toBe("some text")
    settleWatching(harness)
  })

  it("re-aims on navigation keys and clicks but not on other keys", () => {
    const harness = createMascotHarness()
    harness.prompt!.value = "some text"
    harness.prompt!.dispatch("keyup", { key: "a" })
    harness.advance(32)
    expect(mirror(harness)).toBeUndefined()
    harness.prompt!.selectionStart = harness.prompt!.selectionEnd = 9
    harness.prompt!.dispatch("keyup", { key: "End" })
    harness.advance(32)
    expect(mirror(harness).textContent).toBe("some text")
    harness.prompt!.dispatch("blur")
    harness.advance(32)
    harness.prompt!.selectionStart = harness.prompt!.selectionEnd = 4
    harness.prompt!.dispatch("click")
    harness.advance(32)
    expect(mirror(harness).textContent).toBe("some")
  })

  it("stops watching after a pause in typing or when the prompt loses focus", () => {
    const harness = createMascotHarness()
    harness.type("x".repeat(30))
    harness.advance(2900)
    expect(harness.pose()).toBe("watch")
    harness.onChange.mockClear()
    harness.advance(200)
    expect(harness.pose()).not.toBe("watch")
    expect(harness.onChange).toHaveBeenCalledWith({ enabled: true, position: harness.position() })
    harness.type("x".repeat(31))
    settleWatching(harness)
    harness.prompt!.dispatch("blur")
    harness.advance(32)
    expect(harness.pose()).not.toBe("watch")
  })

  it("ignores an empty prompt, a pending connection and reduced motion", () => {
    const empty = createMascotHarness()
    empty.type("   ")
    empty.advance(32)
    expect(mirror(empty)).toBeUndefined()

    const connecting = createMascotHarness()
    connecting.pet.setActivity("connecting")
    connecting.type("hello")
    connecting.advance(500)
    expect(mirror(connecting)).toBeUndefined()

    const still = createMascotHarness({ reducedMotion: true })
    still.type("hello")
    expect(mirror(still)).toBeUndefined()
  })

  it("drops a trick to watch as soon as typing starts", () => {
    const harness = createMascotHarness()
    harness.pet.react("nap")
    harness.type("x".repeat(30))
    expect(harness.mark.textContent).toBe("")
    harness.advance(32)
    expect(harness.pose()).not.toBe("nap")
    settleWatching(harness)
  })
})

describe("ACP Max idle life", () => {
  it("strolls somewhere after a short pause, then does a trick there", () => {
    const harness = createMascotHarness()
    harness.advance(1300)
    expect(harness.pose()).toBe("idle")
    harness.advance(100)
    expect(harness.pose()).toBe("run")
    harness.until(() => harness.pose() !== "run")
    expect(Math.abs(harness.position() - 18) * 4).toBeGreaterThanOrEqual(70)
    harness.until(() => harness.pose() !== "idle", 3000)
    expect(IDLE_TRICKS).toContain(harness.pose())
  })

  it("does not repeat a recent trick", () => {
    const harness = createMascotHarness()
    const tricks: string[] = []
    harness.random = 0.99
    for (let n = 0; n < 4; n++) {
      harness.until(
        () => IDLE_TRICKS.includes(harness.pose()) && !tricks.includes(harness.pose()),
        15000
      )
      tricks.push(harness.pose())
      harness.until(() => !IDLE_TRICKS.includes(harness.pose()), 15000)
    }
    expect(new Set(tricks).size).toBe(4)
  })

  it("ends a trick after its duration", () => {
    const harness = createMascotHarness()
    harness.pet.react("sneeze")
    harness.advance(1500)
    expect(harness.pose()).toBe("sneeze")
    harness.advance(200)
    expect(harness.pose()).not.toBe("sneeze")
  })

  it("naps after a minute alone and stretches on waking", () => {
    const harness = createMascotHarness()
    harness.jump(61000)
    expect(harness.pose()).toBe("nap")
    expect(harness.mark.textContent).toBe("z z z")
    harness.advance(14100)
    expect(harness.pose()).toBe("stretch")
    expect(harness.mark.textContent).toBe("")
  })

  it("stays awake while being played with", () => {
    const harness = createMascotHarness()
    harness.jump(50000)
    harness.clickAt(60)
    harness.jump(15000)
    expect(harness.pose()).not.toBe("nap")
  })

  it("waits for a running turn before starting idle tricks", () => {
    const harness = createMascotHarness()
    harness.pet.setActivity("working")
    harness.advance(5000)
    expect(harness.pose()).toBe("beg")
  })
})
