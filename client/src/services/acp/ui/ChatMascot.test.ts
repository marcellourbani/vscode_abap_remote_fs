import { CHAT_MASCOT_HTML, CHAT_MASCOT_STYLES } from "./ChatMascot"
import { createMascotHarness, transformArgs } from "./ChatMascot.testHarness"

describe("ACP Max markup", () => {
  it("is a keyboard-operable slider that explains its controls", () => {
    expect(CHAT_MASCOT_HTML).toMatch(/role="slider"/)
    expect(CHAT_MASCOT_HTML).toMatch(/tabindex="0"/)
    expect(CHAT_MASCOT_HTML).toMatch(/aria-valuemin="0"[\s\S]*aria-valuemax="100"/)
    expect(CHAT_MASCOT_HTML).toMatch(/title="[^"]*click[^"]*right-click[^"]*Arrow keys/)
    expect(CHAT_MASCOT_HTML).toMatch(/id="chatMascotDog"[^>]*aria-hidden="true"/)
  })

  it("hides the row and freezes CSS animation when paused or motion is reduced", () => {
    expect(CHAT_MASCOT_STYLES).toContain(".chat-mascot-row[hidden] { display: none; }")
    expect(CHAT_MASCOT_STYLES).toContain('.chat-mascot-row[data-paused="true"]')
    expect(CHAT_MASCOT_STYLES).toContain("@media (prefers-reduced-motion: reduce)")
  })

  it("draws every rig part declared in the markup", () => {
    const harness = createMascotHarness()
    harness.advance(32)
    const undrawn = [...harness.parts].filter(([, el]) => el.attributes.size === 0)
    expect(undrawn.map(([name]) => name)).toEqual([])
    expect(harness.parts.has("leg3s")).toBe(true)
  })
})

describe("ACP Max lifecycle", () => {
  it("starts visible at the saved spot with one animation frame queued", () => {
    const harness = createMascotHarness()
    expect(harness.row.hidden).toBe(false)
    expect(harness.row.dataset.paused).toBe("false")
    expect(harness.dog.style.left).toBe("18%")
    expect(harness.stage.getAttribute("aria-valuenow")).toBe("18")
    expect(harness.frames.size).toBe(1)
  })

  it("keeps a margin from the walls and falls back to the default spot", () => {
    const harness = createMascotHarness()
    harness.pet.setState({ position: 2 })
    expect(harness.dog.style.left).toBe("11%")
    harness.pet.setState({ position: 99 })
    expect(harness.dog.style.left).toBe("89%")
    harness.pet.setState({ position: "nowhere" })
    expect(harness.dog.style.left).toBe("18%")
  })

  it("keeps breathing and swaying while idle with a single frame in flight", () => {
    const harness = createMascotHarness()
    harness.advance(300)
    const head = harness.attr("headG", "transform")
    const torso = harness.attr("torsoFill", "d")
    harness.advance(700)
    expect(harness.attr("headG", "transform")).not.toBe(head)
    expect(harness.attr("torsoFill", "d")).not.toBe(torso)
    expect(harness.pose()).toBe("idle")
    expect(harness.row.dataset.gait).toBe("rest")
    expect(harness.frames.size).toBe(1)
  })

  it("collapses, cancels all pending work and reports when disabled", () => {
    const harness = createMascotHarness()
    harness.pet.react("pet")
    const sparks = harness.sparks()
    expect(sparks).toHaveLength(6)
    expect(sparks[0].textContent).toBe("\u2665")
    harness.pet.setEnabled(false)
    expect(harness.row.hidden).toBe(true)
    expect(harness.row.dataset.paused).toBe("true")
    expect(harness.frames.size).toBe(0)
    expect(harness.timers.size).toBe(0)
    expect(harness.sparks()).toHaveLength(0)
    sparks.forEach(spark => expect(spark.animations[0].cancel).toHaveBeenCalled())
    expect(harness.onChange).toHaveBeenLastCalledWith({ enabled: false, position: 18 })
    harness.pet.setEnabled(true)
    expect(harness.row.hidden).toBe(false)
    expect(harness.frames.size).toBe(1)
  })

  it("walks to the far border, looks back at the user, then leaves when switched off with animation", () => {
    const harness = createMascotHarness()
    harness.pet.setEnabled(false, true)
    expect(harness.row.hidden).toBe(false)
    harness.advance(32)
    expect(harness.pose()).toBe("leave")
    const speeds: number[] = []
    let last = harness.position()
    let looked = false
    while (!harness.row.hidden && harness.now() < 20000) {
      harness.advance(16)
      const here = harness.position()
      speeds.push(here - last)
      last = here
      if (
        /rotate\(/.test(harness.attr("headG", "transform")) &&
        harness.attr("headG", "transform").includes("scale(0.62")
      )
        looked = true
    }
    expect(harness.row.hidden).toBe(true)
    expect(Math.max(...speeds)).toBeGreaterThan(0)
    expect(looked).toBe(true)
    expect(harness.onChange).toHaveBeenLastCalledWith({ enabled: false, position: 18 })
    expect(harness.frames.size).toBe(0)
  })

  it("keeps Max in place when re-enabled mid-exit", () => {
    const harness = createMascotHarness()
    harness.pet.setEnabled(false, true)
    harness.advance(500)
    harness.pet.setEnabled(true)
    expect(harness.row.hidden).toBe(false)
    harness.advance(32)
    expect(harness.pose()).not.toBe("leave")
  })

  it("walks in from a border and settles at his saved spot when switched on with animation", () => {
    for (const [random, startSide] of [
      [0.2, "left"],
      [0.8, "right"]
    ] as const) {
      const harness = createMascotHarness()
      harness.pet.setEnabled(false)
      harness.setRandom(random)
      harness.pet.setEnabled(true, true)
      expect(harness.row.hidden).toBe(false)
      expect(startSide === "left" ? harness.position() < 0 : harness.position() > 100).toBe(true)
      harness.advance(32)
      expect(harness.pose()).toBe("enter")
      harness.until(() => harness.pose() !== "enter", 20000)
      expect(harness.position()).toBeCloseTo(18, 0)
      expect(harness.onChange).toHaveBeenLastCalledWith({ enabled: true, position: 18 })
    }
  })

  it("keeps the global visibility when restoring a saved position", () => {
    const harness = createMascotHarness()
    harness.pet.setEnabled(false)
    harness.pet.setState({ position: 70 })
    expect(harness.row.hidden).toBe(true)
    expect(harness.frames.size).toBe(0)
    harness.pet.setEnabled(true)
    expect(harness.dog.style.left).toBe("70%")
  })

  it("pauses while the webview is hidden and resumes when shown", () => {
    const harness = createMascotHarness()
    harness.document.hidden = true
    harness.document.dispatch("visibilitychange")
    expect(harness.row.dataset.paused).toBe("true")
    expect(harness.frames.size).toBe(0)
    expect(harness.timers.size).toBe(0)
    harness.document.hidden = false
    harness.document.dispatch("visibilitychange")
    expect(harness.row.dataset.paused).toBe("false")
    expect(harness.frames.size).toBe(1)
  })

  it("stops for good when the page goes away", () => {
    const harness = createMascotHarness()
    harness.window.dispatch("pagehide")
    expect(harness.resizeObserver.disconnect).toHaveBeenCalled()
    expect(harness.frames.size).toBe(0)
    harness.pet.react("sit")
    harness.pet.speak()
    expect(harness.pose()).not.toBe("sit")
    expect(harness.frames.size).toBe(0)
  })

  it("re-clamps to the stage when it is resized", () => {
    const harness = createMascotHarness()
    harness.stage.clientWidth = 100
    harness.resizeObserver.callback()
    expect(harness.dog.style.left).toBe("44%")
  })

  it("never animates with reduced motion, yet still follows commands", () => {
    const harness = createMascotHarness({ reducedMotion: true })
    expect(harness.frames.size).toBe(0)
    harness.clickAt(75)
    expect(harness.dog.style.left).toBe("75%")
    expect(harness.onChange).toHaveBeenLastCalledWith({ enabled: true, position: 75 })
    harness.pet.react("celebrate")
    expect(harness.pose()).toBe("celebrate")
    expect(harness.sparks()).toHaveLength(0)
    expect(harness.frames.size).toBe(0)
    expect(harness.timers.size).toBe(0)
  })

  it("starts animating once reduced motion is switched off", () => {
    const harness = createMascotHarness({ reducedMotion: true })
    harness.motion.matches = false
    harness.motion.dispatch("change")
    expect(harness.frames.size).toBe(1)
    expect(harness.timers.size).toBe(1)
  })

  it("works without a prompt box", () => {
    const harness = createMascotHarness({ withPrompt: false })
    harness.advance(100)
    expect(harness.pose()).toBe("idle")
  })
})

describe("ACP Max movement", () => {
  it("walks to a nearby click and settles exactly there", () => {
    const harness = createMascotHarness()
    harness.clickAt(30)
    expect(harness.pose()).toBe("run")
    const gaits = new Set<string>()
    harness.until(() => {
      gaits.add(harness.row.dataset.gait)
      return harness.pose() !== "run"
    })
    expect(harness.dog.style.left).toBe("30%")
    expect(harness.stage.getAttribute("aria-valuenow")).toBe("30")
    expect(gaits).toContain("walk")
    expect(gaits).not.toContain("trot")
    expect(gaits).not.toContain("gallop")
    expect(harness.onChange).toHaveBeenLastCalledWith({ enabled: true, position: 30 })
  })

  it("speeds up through trot to a gallop for a far click and brakes before arriving", () => {
    const harness = createMascotHarness()
    harness.clickAt(85)
    const gaits: string[] = []
    harness.until(() => {
      gaits.push(harness.row.dataset.gait)
      return harness.pose() !== "run"
    })
    expect(harness.dog.style.left).toBe("85%")
    const first = (gait: string) => gaits.indexOf(gait)
    expect(first("walk")).toBeLessThan(first("trot"))
    expect(first("trot")).toBeLessThan(first("gallop"))
    expect(gaits.lastIndexOf("gallop")).toBeLessThan(gaits.lastIndexOf("walk"))
  })

  it("moves smoothly instead of teleporting", () => {
    const harness = createMascotHarness()
    harness.clickAt(80)
    let previous = harness.position()
    harness.until(() => {
      const step = harness.position() - previous
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThan(2)
      previous = harness.position()
      return harness.pose() !== "run"
    })
  })

  it("turns on the spot, head first, before walking the other way", () => {
    const harness = createMascotHarness()
    harness.clickAt(5)
    harness.advance(144)
    expect(harness.dog.style.left).toBe("18%")
    expect(harness.facing.style.transform).not.toBe("scaleX(-1)")
    const [headScale] = transformArgs(harness.attr("headG", "transform"), "scale")
    expect(headScale).toBeLessThan(0.95)
    harness.until(() => harness.facing.style.transform === "scaleX(-1)", 600)
    harness.until(() => harness.pose() !== "run")
    expect(harness.dog.style.left).toBe("11%")
  })

  it("fetches at a double-click, then celebrates with stars", () => {
    const harness = createMascotHarness()
    harness.clickAt(60, "dblclick")
    const gaits = harness.trace(1500, () => harness.row.dataset.gait)
    expect(gaits).toContain("gallop")
    harness.until(() => harness.pose() === "celebrate")
    expect(harness.dog.style.left).toBe("60%")
    const sparks = harness.sparks()
    expect(sparks).toHaveLength(6)
    sparks[0].animations[0].onfinish!()
    expect(harness.sparks()).toHaveLength(5)
  })

  it("jumps off the ground and lands again when celebrating", () => {
    const harness = createMascotHarness()
    harness.pet.react("celebrate")
    const lift = () => transformArgs(harness.attr("root", "transform"), "translate")[1]
    const heights = [...harness.trace(1000, lift)]
    expect(Math.min(...heights)).toBeLessThan(-10)
    harness.advance(1600)
    expect(lift()).toBeCloseTo(0, 0)
    expect(harness.onChange).toHaveBeenCalled()
  })

  it("rolls onto its back with its paws in the air for a belly rub", () => {
    const harness = createMascotHarness()
    harness.pet.react("belly")
    harness.advance(1800)
    const [, flip] = transformArgs(harness.attr("root", "transform"), "scale")
    expect(flip).toBeLessThan(-0.9)
    const paw = harness.attr("leg2s", "d")
    harness.advance(200)
    expect(harness.attr("leg2s", "d")).not.toBe(paw)
  })

  it("follows the pointer with its eyes", () => {
    const harness = createMascotHarness()
    harness.stage.dispatch("pointermove", { clientX: 380 })
    harness.advance(400)
    const [lookX] = transformArgs(harness.attr("eyeG", "transform"), "translate")
    expect(lookX).toBeGreaterThan(0.5)
  })
})

describe("ACP Max keyboard control", () => {
  const press = (harness: ReturnType<typeof createMascotHarness>, key: string) =>
    harness.stage.dispatch("keydown", { key })

  it("steps with the arrow keys and jumps to the ends with Home and End", () => {
    const harness = createMascotHarness({ reducedMotion: true })
    expect(press(harness, "ArrowRight").preventDefault).toHaveBeenCalled()
    expect(harness.dog.style.left).toBe("23%")
    press(harness, "ArrowUp")
    expect(harness.stage.getAttribute("aria-valuenow")).toBe("28")
    press(harness, "ArrowLeft")
    press(harness, "ArrowDown")
    expect(harness.dog.style.left).toBe("18%")
    press(harness, "End")
    expect(harness.dog.style.left).toBe("89%")
    press(harness, "Home")
    expect(harness.dog.style.left).toBe("11%")
  })

  it("does a trick on Space or Enter and ignores other keys", () => {
    const harness = createMascotHarness()
    press(harness, " ")
    expect(harness.pose()).toBe("roll")
    harness.advance(4000)
    press(harness, "Enter")
    expect(harness.pose()).toBe("roll")
    expect(press(harness, "a").preventDefault).not.toHaveBeenCalled()
  })
})

describe("ACP Max trick menu", () => {
  function openMenu(harness = createMascotHarness()) {
    const event = harness.stage.dispatch("contextmenu", { clientX: 200, clientY: 50 })
    return { harness, event, menu: harness.menu()! }
  }
  const items = (menu: ReturnType<typeof openMenu>["menu"]) => menu.querySelectorAll("button")
  const item = (menu: ReturnType<typeof openMenu>["menu"], label: string) =>
    items(menu).find(button => button.textContent === label)!

  it("opens a grouped, focused menu at the pointer instead of the browser menu", () => {
    const { harness, event, menu } = openMenu()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(menu.getAttribute("role")).toBe("menu")
    expect(menu.style.left).toBe("200px")
    expect(menu.style.top).toBe("50px")
    const titles = menu.children.filter(c => c.className === "chat-mascot-menu-title")
    expect(titles.map(t => t.textContent)).toEqual([
      "Go to here",
      "Rest",
      "Play",
      "Body",
      "Attention"
    ])
    expect(items(menu)).toHaveLength(23)
    expect(items(menu).every(b => b.getAttribute("role") === "menuitem")).toBe(true)
    expect(harness.document.activeElement).toBe(items(menu)[0])
  })

  it("performs the chosen trick and closes", () => {
    const { harness, menu } = openMenu()
    item(menu, "Sleep").dispatch("click")
    expect(harness.menu()).toBeUndefined()
    expect(harness.pose()).toBe("nap")
    expect(harness.mark.textContent).toBe("z z z")
  })

  it("travels to the right-clicked spot at the chosen gait", () => {
    const { harness, menu } = openMenu()
    item(menu, "Gallop").dispatch("click")
    expect(harness.trace(1000, () => harness.row.dataset.gait)).toContain("gallop")
    harness.until(() => harness.pose() !== "run")
    expect(harness.dog.style.left).toBe("50%")
  })

  it("cycles focus with the arrow keys and closes on Escape", () => {
    const { harness, menu } = openMenu()
    const buttons = items(menu)
    harness.document.dispatch("keydown", { key: "ArrowUp" })
    expect(harness.document.activeElement).toBe(buttons[buttons.length - 1])
    harness.document.dispatch("keydown", { key: "ArrowDown" })
    harness.document.dispatch("keydown", { key: "ArrowRight" })
    expect(harness.document.activeElement).toBe(buttons[1])
    harness.document.dispatch("keydown", { key: "Escape" })
    expect(harness.menu()).toBeUndefined()
    expect(harness.document.activeElement).toBe(harness.stage)
  })

  it("closes when clicking elsewhere or leaving the window, but not on its own items", () => {
    const { harness, menu } = openMenu()
    harness.document.dispatch("pointerdown", { target: items(menu)[2] })
    expect(harness.menu()).toBe(menu)
    harness.document.dispatch("pointerdown", { target: harness.stage })
    expect(harness.menu()).toBeUndefined()
    openMenu(harness)
    harness.window.dispatch("blur")
    expect(harness.menu()).toBeUndefined()
    openMenu(harness)
    harness.window.dispatch("resize")
    expect(harness.menu()).toBeUndefined()
  })

  it("replaces an open menu rather than stacking another", () => {
    const { harness } = openMenu()
    openMenu(harness)
    expect(harness.body.children.filter(c => c.className === "chat-mascot-menu")).toHaveLength(1)
  })

  it("stays shut while Max is hidden", () => {
    const harness = createMascotHarness()
    harness.pet.setEnabled(false)
    const { event } = openMenu(harness)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(harness.menu()).toBeUndefined()
  })
})
