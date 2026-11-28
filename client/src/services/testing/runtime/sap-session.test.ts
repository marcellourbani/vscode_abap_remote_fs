import type { Page } from "@playwright/test"
import { SapSession } from "./sap-session"

it("uses the top-level SAP document when ITSFRAME1 is present but empty", async () => {
  const topBody = { kind: "top-body" }
  const page = {
    locator: (selector: string) => {
      if (selector === "body") return topBody
      return {
        count: async () => {
          if (selector === "iframe#ITSFRAME1") return 1
          if (selector === "[lsdata]") return 84
          return 0
        }
      }
    },
    frameLocator: () => ({
      locator: (selector: string) =>
        selector === "body" ? { kind: "empty-frame-body" } : { count: async () => 0 }
    })
  } as unknown as Page
  const session = new SapSession(page, { tcId: "TC-001", title: "Frame detection" })

  expect(await session.contentScope()).toBe(page)
  expect(await session.contentRoot()).toBe(topBody)
  expect((session as unknown as { hasContentFrame: boolean }).hasContentFrame).toBe(false)
})

it("uses the SAP frame when SAP controls are actually inside ITSFRAME1", async () => {
  const topBody = { kind: "top-body" }
  const frameBody = { kind: "sap-frame-body" }
  const page = {
    locator: (selector: string) => {
      if (selector === "body") return topBody
      return {
        count: async () => (selector === "iframe#ITSFRAME1" ? 1 : 0)
      }
    },
    frameLocator: () => ({
      locator: (selector: string) => (selector === "body" ? frameBody : { count: async () => 84 })
    })
  } as unknown as Page
  const session = new SapSession(page, { tcId: "TC-001", title: "Frame detection" })

  expect(await session.contentRoot()).toBe(frameBody)
  expect((session as unknown as { hasContentFrame: boolean }).hasContentFrame).toBe(true)
})

it("clicks custom ARIA radios instead of using the native-radio check action", async () => {
  let selected = false
  const click = vi.fn().mockImplementation(async () => {
    selected = true
  })
  const radioLocator: any = {
    first: () => radioLocator,
    count: async () => 1,
    evaluate: async () => selected,
    click
  }
  const root = { getByRole: vi.fn(() => radioLocator) }
  const session = Object.create(SapSession.prototype) as any
  session.guarded = async (_description: string, action: () => Promise<void>) => action()
  session.content = () => root

  await session.selectRadio("Refresh Banner Data")

  expect(click).toHaveBeenCalledOnce()
})

it("fails when a clicked radio does not become selected", async () => {
  const radioLocator: any = {
    first: () => radioLocator,
    count: async () => 1,
    evaluate: async () => false,
    click: vi.fn().mockResolvedValue(undefined)
  }
  const session = Object.create(SapSession.prototype) as any
  session.guarded = async (_description: string, action: () => Promise<void>) => action()
  session.content = () => ({ getByRole: () => radioLocator })

  await expect(session.selectRadio("Builders")).rejects.toThrow(
    'selectRadio clicked "Builders" but it did not become selected.'
  )
})

it("pairs range endpoints by SAP LOW/HIGH metadata when labels differ", async () => {
  const low = { fill: vi.fn().mockResolvedValue(undefined), count: async () => 1 }
  const high = { fill: vi.fn().mockResolvedValue(undefined), count: async () => 1 }
  const namedField = {
    first: () => namedField,
    count: async () => 1,
    evaluate: async (callback: (element: { getAttribute: () => string }) => unknown) =>
      callback({
        getAttribute: () => JSON.stringify({ 21: { SID: "wnd[0]/usr/ctxtS_DATE-LOW" } })
      })
  }
  const locateRangeEndpoint = vi.fn((selector: string) => (selector.includes("-LOW") ? low : high))
  const root = {
    getByRole: () => namedField,
    locator: locateRangeEndpoint
  }
  const session = Object.create(SapSession.prototype) as any
  session.ensureContentFrame = async () => {}
  session.content = () => root
  session.guarded = async (_description: string, action: () => Promise<void>) => action()

  await session.setRange("S_DATE", "25.11.2026", "27.11.2026")

  expect(locateRangeEndpoint.mock.calls).toEqual([
    ['input[lsdata*="S_DATE-LOW"]'],
    ['input[lsdata*="S_DATE-HIGH"]']
  ])
  expect(low.fill).toHaveBeenCalledWith("25.11.2026")
  expect(high.fill).toHaveBeenCalledWith("27.11.2026")
  expect(locateRangeEndpoint).toHaveBeenCalledTimes(2)
})

it("extracts range technical names from legacy single-quoted lsdata", async () => {
  const low = { fill: vi.fn().mockResolvedValue(undefined), count: async () => 1 }
  const high = { fill: vi.fn().mockResolvedValue(undefined), count: async () => 1 }
  const namedField = {
    first: () => namedField,
    count: async () => 1,
    evaluate: async (callback: (element: { getAttribute: () => string }) => unknown) =>
      callback({
        getAttribute: () => "{21:{SID:'wnd[0]/usr/ctxtS_DATE-LOW',Type:'GuiCTextField'}}"
      })
  }
  const root = {
    getByRole: () => namedField,
    locator: (selector: string) => (selector.includes("-LOW") ? low : high)
  }
  const session = Object.create(SapSession.prototype) as any
  session.ensureContentFrame = async () => {}
  session.content = () => root
  session.guarded = async (_description: string, action: () => Promise<void>) => action()

  await session.setRange("S_DATE", "25.11.2026", "27.11.2026")

  expect(low.fill).toHaveBeenCalledWith("25.11.2026")
  expect(high.fill).toHaveBeenCalledWith("27.11.2026")
})

it("clears both endpoints for same-label ranges with an empty high value", async () => {
  const setField = vi.fn().mockResolvedValue(undefined)
  const session = Object.create(SapSession.prototype) as any
  session.ensureContentFrame = async () => {}
  session.content = () => ({ getByRole: () => ({ count: async () => 2 }) })
  session.setField = setField

  await session.setRange("Site", "1000", "")

  expect(setField).toHaveBeenNthCalledWith(1, "Site", "1000", { nth: 0 })
  expect(setField).toHaveBeenNthCalledWith(2, "Site", "", { nth: 1 })
})

it("selects and verifies an option from a WebGUI textbox dropdown", async () => {
  let listOpen = false
  let selectedValue = ""
  const field = {
    first: () => field,
    count: async () => 1,
    click: vi.fn().mockImplementation(async () => {
      listOpen = true
    }),
    inputValue: async () => selectedValue
  }
  const option = {
    first: () => option,
    count: async () => (listOpen ? 1 : 0),
    click: vi.fn().mockImplementation(async () => {
      selectedValue = "Green"
    }),
    getAttribute: async () => (selectedValue === "Green" ? "true" : null)
  }
  const root = {
    getByRole: (role: string) => (role === "textbox" ? field : option)
  }
  const session = Object.create(SapSession.prototype) as any
  session.guarded = async (_description: string, action: () => Promise<void>) => action()
  session.content = () => root

  await session.selectOption("P_COLOR", "Green")

  expect(field.click).toHaveBeenCalledOnce()
  expect(option.click).toHaveBeenCalledOnce()
})
