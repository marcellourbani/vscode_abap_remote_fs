import { runInNewContext } from "node:vm"
import { CHAT_MASCOT_HTML, CHAT_MASCOT_SCRIPT } from "./ChatMascot"

function createPetHarness() {
  let now = 0
  let nextFrame = 0
  const frames = new Map<number, (timestamp: number) => void>()
  const animations: Array<{ cancel: ReturnType<typeof vi.fn> }> = []
  const elements = new Map<string, ReturnType<typeof createElement>>()
  function createElement() {
    return {
      dataset: {} as Record<string, string>,
      style: { setProperty: vi.fn(), left: "", transform: "" },
      hidden: false,
      clientWidth: 400,
      textContent: "",
      classList: { toggle: vi.fn() },
      listeners: new Map<string, (event: any) => void>(),
      addEventListener(type: string, listener: (event: any) => void) {
        this.listeners.set(type, listener)
      },
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, width: 400 }),
      querySelector: (selector: string) =>
        elements.get(
          selector === ".chat-mascot-head"
            ? "head"
            : selector === ".chat-mascot-ear"
              ? "ear"
              : selector === ".chat-mascot-jaw"
                ? "jaw"
                : selector === ".chat-mascot-face"
                  ? "facing"
                  : "art"
        ),
      querySelectorAll: () => [
        {
          dataset: { leg: "hind-near" },
          querySelector: (selector: string) => elements.get("hind" + selector)
        },
        {
          dataset: { leg: "front-near" },
          querySelector: (selector: string) => elements.get("front" + selector)
        }
      ],
      animate: vi.fn(() => {
        const animation = { cancel: vi.fn(), onfinish: null }
        animations.push(animation)
        return animation
      })
    }
  }
  for (const id of [
    "chatMascotRow",
    "chatMascotStage",
    "chatMascotDog",
    "chatMascotMark",
    "promptInput",
    "art",
    "head",
    "ear",
    "jaw",
    "facing",
    "hind[data-upper]",
    "hind[data-lower]",
    "hind[data-paw]",
    "front[data-upper]",
    "front[data-lower]",
    "front[data-paw]"
  ]) {
    elements.set(id, createElement())
  }
  const document = {
    hidden: false,
    getElementById: (id: string) => elements.get(id),
    createElement,
    addEventListener: vi.fn()
  }
  const motion = { matches: false, addEventListener: vi.fn() }
  const onChange = vi.fn()
  const context = {
    document,
    window: { matchMedia: () => motion, setTimeout: vi.fn(() => 1), addEventListener: vi.fn() },
    performance: { now: () => now },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    clearTimeout: vi.fn(),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    onChange,
    pet: null as any
  }
  runInNewContext(`${CHAT_MASCOT_SCRIPT}; pet = createAcpChatMascot(onChange);`, context)
  function advance(timestamp: number) {
    now = timestamp
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(now))
  }
  function click(position: number, type = "click") {
    elements.get("chatMascotStage")!.listeners.get(type)!({
      clientX: position * 4,
      target: { closest: () => null }
    })
  }
  context.pet.setState({ enabled: true, position: 18 })
  return { ...context, elements, frames, motion, animations, advance, click }
}

describe("ACP Max animation controller", () => {
  it("keeps gentle head and joint motion between idle actions and stops when hidden", () => {
    const harness = createPetHarness()
    harness.advance(300)
    const head = harness.elements.get("head")!.setAttribute
    const knee = harness.elements.get("front[data-lower]")!.setAttribute
    const firstHead = head.mock.lastCall![1]
    const firstKnee = knee.mock.lastCall![1]
    harness.advance(1000)
    expect(head.mock.lastCall![1]).not.toBe(firstHead)
    expect(knee.mock.lastCall![1]).not.toBe(firstKnee)
    expect(harness.frames.size).toBe(1)
    harness.pet.setEnabled(false)
    expect(harness.frames.size).toBe(0)
  })

  it("hops rather than showing hearts when clicking directly on Max", () => {
    const harness = createPetHarness()
    harness.elements.get("chatMascotStage")!.listeners.get("click")!({
      clientX: 80,
      target: { closest: () => harness.elements.get("chatMascotDog") }
    })
    expect(harness.elements.get("chatMascotRow")!.dataset.pose).toBe("run")
    expect(harness.elements.get("chatMascotStage")!.appendChild).not.toHaveBeenCalled()
    expect(CHAT_MASCOT_HTML).not.toContain("codicon-search")
    expect(CHAT_MASCOT_HTML).not.toContain("click Max to pet")
  })

  it("hops to a clicked destination and lands instead of sliding", () => {
    const harness = createPetHarness()
    harness.click(80)
    harness.advance(200)
    const dog = harness.elements.get("chatMascotDog")!
    expect(Number.parseFloat(dog.style.left)).toBeGreaterThan(18)
    expect(harness.elements.get("art")!.style.transform).toMatch(/translateY\(-[1-9]/)
    expect(Number.parseFloat(dog.style.left)).toBeLessThan(27)
    harness.advance(10000)
    expect(dog.style.left).toBe("80%")
    expect(harness.elements.get("art")!.style.transform).toBe("")
    expect(harness.onChange).toHaveBeenCalled()
  })

  it("articulates front and back knees through each short hop with a grounded pause", () => {
    const harness = createPetHarness()
    harness.click(80)
    const dog = harness.elements.get("chatMascotDog")!
    const row = harness.elements.get("chatMascotRow")!
    const hind = harness.elements.get("hind[data-lower]")!.setAttribute
    const front = harness.elements.get("front[data-lower]")!.setAttribute
    harness.advance(60)
    expect(dog.style.left).toBe("18%")
    expect(row.dataset.gait).toBe("crouch")
    const crouchedHind = hind.mock.lastCall![1]
    const crouchedFront = front.mock.lastCall![1]
    harness.advance(200)
    expect(row.dataset.gait).toBe("tuck")
    expect(hind.mock.lastCall![1]).not.toBe(crouchedHind)
    expect(front.mock.lastCall![1]).not.toBe(crouchedFront)
    harness.advance(460)
    expect(row.dataset.gait).toBe("land")
    const landing = Number.parseFloat(dog.style.left)
    expect((landing - 18) * 4).toBeLessThanOrEqual(26)
    harness.advance(540)
    expect(Number.parseFloat(dog.style.left)).toBe(landing)
    harness.advance(620)
    expect(row.dataset.gait).toBe("crouch")
    expect(Number.parseFloat(dog.style.left)).toBe(landing)
    harness.advance(760)
    expect(row.dataset.gait).toBe("tuck")
    expect(Number.parseFloat(dog.style.left)).toBeGreaterThan(landing)
  })

  it("reverses direction while a connection is pending", () => {
    const harness = createPetHarness()
    harness.pet.setActivity("connecting")
    harness.advance(10000)
    expect(harness.elements.get("chatMascotDog")!.style.left).toBe("91.5%")
    harness.advance(20000)
    expect(harness.elements.get("chatMascotDog")!.style.left).toBe("8.5%")
    harness.pet.setActivity("idle")
    expect(harness.elements.get("chatMascotRow")!.dataset.pose).toBe("celebrate")
  })

  it("plays at a double-click destination without creating target markers", () => {
    const harness = createPetHarness()
    harness.click(70, "dblclick")
    harness.advance(10000)
    expect(harness.elements.get("chatMascotRow")!.dataset.pose).toBe("celebrate")
    expect(CHAT_MASCOT_HTML).not.toContain("chatMascotTarget")
  })

  it("cancels pending animation work and collapses the row when disabled", () => {
    const harness = createPetHarness()
    harness.pet.react("stretch")
    harness.pet.setEnabled(false)
    expect(harness.elements.get("chatMascotRow")!.hidden).toBe(true)
    expect(harness.frames.size).toBe(0)
    expect(harness.elements.get("art")!.style.transform).toBe("")
    harness.pet.setEnabled(true)
    expect(harness.elements.get("chatMascotRow")!.hidden).toBe(false)
  })

  it("does not animate travel or poses with reduced motion", () => {
    const harness = createPetHarness()
    harness.pet.setEnabled(false)
    harness.motion.matches = true
    harness.pet.setEnabled(true)
    harness.click(75)
    harness.pet.react("spin")
    expect(harness.elements.get("chatMascotDog")!.style.left).toBe("75%")
    expect(harness.frames.size).toBe(0)
    expect(harness.animations).toHaveLength(0)
  })

  it("preserves globally controlled visibility when restoring a saved position", () => {
    const harness = createPetHarness()
    harness.pet.setEnabled(false)
    harness.pet.setState({ position: 70 })
    expect(harness.elements.get("chatMascotRow")!.hidden).toBe(true)
    expect(harness.frames.size).toBe(0)
    harness.pet.setEnabled(true)
    expect(harness.elements.get("chatMascotRow")!.hidden).toBe(false)
    expect(harness.elements.get("chatMascotDog")!.style.left).toBe("70%")
  })

  it("settles into a concerned pose after failures without success effects", () => {
    const harness = createPetHarness()
    harness.pet.setActivity("working")
    harness.pet.setActivity("error")
    expect(harness.elements.get("chatMascotRow")!.dataset.pose).toBe("sad")
    expect(harness.elements.get("chatMascotStage")!.appendChild).not.toHaveBeenCalled()
  })

  it("hinges the jaw at the muzzle and moves the head during barking", () => {
    const harness = createPetHarness()
    harness.pet.setActivity("working")
    harness.pet.speak()
    harness.advance(80)
    const jaw = harness.elements.get("jaw")!.setAttribute
    const head = harness.elements.get("head")!.setAttribute
    const firstJaw = jaw.mock.lastCall![1]
    const firstHead = head.mock.lastCall![1]
    expect(firstJaw).toMatch(/ 78 32\)/)
    harness.advance(176)
    expect(jaw.mock.lastCall![1]).not.toBe(firstJaw)
    expect(head.mock.lastCall![1]).not.toBe(firstHead)
    expect(CHAT_MASCOT_HTML).not.toContain("chat-mascot-mouth-open")
  })

  it("investigates until all overlapping tool calls return", () => {
    const harness = createPetHarness()
    harness.pet.setActivity("working")
    harness.pet.toolUpdate("first", "pending")
    harness.pet.toolUpdate("second", "in_progress")
    harness.advance(2200)
    const row = harness.elements.get("chatMascotRow")!
    expect(row.dataset.activity).toBe("tool")
    expect(row.dataset.pose).toBe("investigate")
    harness.pet.toolUpdate("first", "completed")
    harness.advance(2300)
    expect(row.dataset.activity).toBe("tool")
    harness.pet.toolUpdate("second", "completed")
    expect(row.dataset.activity).not.toBe("tool")
    expect(row.dataset.pose).toBe("look")
  })

  it("reacts to failed tool results without leaving the tool pose active", () => {
    const harness = createPetHarness()
    harness.pet.toolUpdate("lookup", "pending")
    harness.pet.toolUpdate("lookup", "failed")
    expect(harness.elements.get("chatMascotRow")!.dataset.pose).toBe("sad")
    expect(harness.elements.get("chatMascotRow")!.dataset.activity).not.toBe("tool")
  })

  it("rolls onto its back with independently moving paws instead of a cartwheel", () => {
    const harness = createPetHarness()
    harness.pet.react("belly")
    harness.advance(1400)
    expect(harness.elements.get("art")!.style.transform).toContain("rotate(-180deg)")
    const front = harness.elements.get("front[data-upper]")!.setAttribute
    const first = front.mock.lastCall![1]
    harness.advance(1600)
    expect(front.mock.lastCall![1]).not.toBe(first)
    expect(harness.elements.get("art")!.style.transform).not.toContain("360")
  })

  it("plants its feet and leads with its head before changing direction", () => {
    const harness = createPetHarness()
    harness.click(0)
    harness.advance(80)
    expect(harness.elements.get("chatMascotDog")!.style.left).toBe("18%")
    expect(harness.elements.get("head")!.setAttribute.mock.lastCall![1]).not.toBe("rotate(0 63 32)")
    harness.advance(240)
    expect(harness.elements.get("facing")!.style.transform).toMatch(/scaleX\(-/)
    expect(harness.elements.get("art")!.style.transform).not.toContain("180")
  })
})
