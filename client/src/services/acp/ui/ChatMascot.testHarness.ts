// Runs the mascot webview script in a VM against a minimal fake DOM. The clock, animation frames,
// timers and Math.random are all controlled by the test, and the SVG rig parts are taken from the
// real markup, so a part the script needs but the markup lacks makes the harness throw.
import { runInNewContext } from "node:vm"
import { vi } from "vitest"
import { CHAT_MASCOT_HTML, CHAT_MASCOT_SCRIPT } from "./ChatMascot"

type Listener = (event: any) => void

export interface FakeAnimation {
  cancel: ReturnType<typeof vi.fn>
  onfinish: (() => void) | null
}

class Listeners {
  private readonly listeners = new Map<string, Listener[]>()
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  dispatch(type: string, event: Record<string, unknown> = {}) {
    const full = { preventDefault: vi.fn(), ...event }
    for (const listener of this.listeners.get(type) ?? []) listener(full)
    return full
  }
}

interface Layout {
  charWidth: number
  lineHeight: number
  activeElement: FakeElement | null
  parts: Map<string, FakeElement>
  facing?: FakeElement
}

export class FakeElement extends Listeners {
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, any> = { cssText: "" }
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly animations: FakeAnimation[] = []
  parent: FakeElement | null = null
  hidden = false
  textContent = ""
  className = ""
  type = ""
  value = ""
  clientWidth = 0
  scrollTop = 0
  scrollLeft = 0
  selectionStart = 0
  selectionEnd = 0
  selectionDirection = "none"
  rect = { left: 0, top: 0, width: 0, height: 0 }

  constructor(
    readonly tagName: string,
    private readonly layout: Layout
  ) {
    super()
  }

  /** Only the caret marker inside the measuring mirror has geometry: one fixed width per character */
  private get isCaretMarker() {
    return this.tagName === "SPAN" && !!this.parent
  }
  get offsetLeft() {
    return this.isCaretMarker ? this.parent!.textContent.length * this.layout.charWidth : 0
  }
  get offsetTop() {
    return 0
  }
  get offsetHeight() {
    return this.isCaretMarker ? this.layout.lineHeight : 0
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value))
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  appendChild(child: FakeElement) {
    child.parent = this
    this.children.push(child)
    return child
  }
  remove() {
    if (!this.parent) return
    this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  contains(node: FakeElement | null) {
    for (let current = node; current; current = current.parent) if (current === this) return true
    return false
  }
  focus() {
    this.layout.activeElement = this
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect
    return { left, top, width, height, right: left + width, bottom: top + height }
  }
  descendants(): FakeElement[] {
    return this.children.flatMap(child => [child, ...child.descendants()])
  }
  querySelectorAll(selector: string) {
    return selector === "button" ? this.descendants().filter(e => e.tagName === "BUTTON") : []
  }
  querySelector(selector: string) {
    if (selector === "button") return this.querySelectorAll("button")[0] ?? null
    if (selector === ".chat-mascot-face") return this.layout.facing ?? null
    const part = /^\[data-part="(.+)"\]$/.exec(selector)?.[1]
    return part ? (this.layout.parts.get(part) ?? null) : null
  }
  animate() {
    const animation: FakeAnimation = { cancel: vi.fn(), onfinish: null }
    this.animations.push(animation)
    return animation
  }
}

class FakeDocument extends Listeners {
  hidden = false
  constructor(
    readonly body: FakeElement,
    private readonly layout: Layout,
    private readonly byId: Record<string, FakeElement | null>,
    readonly createElement: (tag: string) => FakeElement
  ) {
    super()
  }
  get activeElement() {
    return this.layout.activeElement
  }
  getElementById(id: string) {
    return this.byId[id] ?? null
  }
}

export interface MascotHarnessOptions {
  reducedMotion?: boolean
  withPrompt?: boolean
}

export function createMascotHarness(options: MascotHarnessOptions = {}) {
  let now = 0
  let nextId = 0
  const frames = new Map<number, (timestamp: number) => void>()
  const timers = new Map<number, { due: number; run: () => void }>()
  const layout: Layout = { charWidth: 8, lineHeight: 16, activeElement: null, parts: new Map() }
  const make = (tag: string) => new FakeElement(tag.toUpperCase(), layout)

  for (const [, name] of CHAT_MASCOT_HTML.matchAll(/data-part="([^"]+)"/g)) {
    layout.parts.set(name, make("g"))
  }
  const row = make("div")
  const stage = make("div")
  const dog = make("div")
  const mark = make("div")
  const body = make("body")
  layout.facing = make("div")
  stage.clientWidth = 400
  stage.rect = { left: 0, top: 0, width: 400, height: 60 }
  const prompt = options.withPrompt === false ? null : make("textarea")
  if (prompt) {
    prompt.clientWidth = 400
    prompt.rect = { left: 0, top: 100, width: 400, height: 40 }
  }

  const document = new FakeDocument(
    body,
    layout,
    {
      chatMascotRow: row,
      chatMascotStage: stage,
      chatMascotDog: dog,
      chatMascotMark: mark,
      promptInput: prompt
    },
    make
  )
  const motion = Object.assign(new Listeners(), { matches: !!options.reducedMotion })
  const setTimeout = (run: () => void, delay = 0) => {
    timers.set(++nextId, { due: now + delay, run })
    return nextId
  }
  const clearTimeout = (id: number) => timers.delete(id)
  const window = Object.assign(new Listeners(), {
    innerWidth: 800,
    innerHeight: 600,
    matchMedia: () => motion,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ borderLeftWidth: "0px", borderTopWidth: "0px", fontSize: "13px" })
  })
  const resizeObserver = { callback: (() => {}) as () => void, disconnect: vi.fn() }
  const math = Object.create(Math) as Math
  const harness = {
    random: 0.5,
    onChange: vi.fn(),
    pet: null as any
  }
  math.random = () => harness.random

  const context = {
    document,
    window,
    performance: { now: () => now },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      frames.set(++nextId, callback)
      return nextId
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    clearTimeout,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizeObserver.callback = callback
      }
      observe() {}
      disconnect() {
        resizeObserver.disconnect()
      }
    },
    Math: math,
    onChange: harness.onChange,
    pet: null as any
  }
  runInNewContext(`${CHAT_MASCOT_SCRIPT}; pet = createAcpChatMascot(onChange);`, context)
  harness.pet = context.pet

  function fireTimers() {
    for (;;) {
      const next = [...timers]
        .filter(([, t]) => t.due <= now)
        .sort((a, b) => a[1].due - b[1].due)[0]
      if (!next) return
      timers.delete(next[0])
      next[1].run()
    }
  }
  function runFrames() {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(now))
  }
  /** Let time pass in 16 ms frames, firing timers that fall due */
  function advance(ms: number) {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 16)
      fireTimers()
      runFrames()
    }
  }
  /** Skip ahead without rendering, as when the webview is in the background */
  function jump(ms: number) {
    now += ms
    fireTimers()
  }
  function until(condition: () => boolean, maxMs = 10000) {
    const end = now + maxMs
    while (!condition()) {
      if (now >= end) throw new Error(`condition not met within ${maxMs}ms`)
      advance(16)
    }
  }
  /** Every distinct value read once per frame over the given time */
  function trace<T>(ms: number, read: () => T): Set<T> {
    const seen = new Set<T>()
    const end = now + ms
    while (now < end) {
      advance(16)
      seen.add(read())
    }
    return seen
  }
  const attr = (part: string, name: string) => layout.parts.get(part)!.getAttribute(name) ?? ""

  harness.pet.setState({ enabled: true, position: 18 })

  return {
    ...harness,
    /** Drives Math.random inside the mascot script; assigning to `random` on the result has no effect */
    setRandom(value: number) {
      harness.random = value
    },
    row,
    stage,
    dog,
    mark,
    body,
    prompt,
    facing: layout.facing,
    parts: layout.parts,
    document,
    window,
    motion,
    frames,
    timers,
    resizeObserver,
    advance,
    jump,
    until,
    trace,
    attr,
    now: () => now,
    position: () => Number.parseFloat(dog.style.left),
    pose: () => row.dataset.pose,
    sparks: () => stage.children.filter(child => child.className === "chat-mascot-spark"),
    menu: () => body.children.find(child => child.className === "chat-mascot-menu"),
    clickAt: (percent: number, type = "click") =>
      stage.dispatch(type, { clientX: percent * 4, clientY: 30 }),
    /** Focus the prompt and type, leaving the caret at the end of the text */
    type(text: string, caret = text.length) {
      prompt!.focus()
      prompt!.value = text
      prompt!.selectionStart = prompt!.selectionEnd = caret
      prompt!.dispatch("input")
    }
  }
}

export type MascotHarness = ReturnType<typeof createMascotHarness>

/** Arguments of the first SVG transform function, e.g. transformArgs("translate(1 2) scale(3 4)", "scale") = [3, 4] */
export function transformArgs(transform: string, fn: string): number[] {
  const match = new RegExp(`${fn}\\(([^)]*)\\)`).exec(transform)
  return match
    ? match[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    : []
}
