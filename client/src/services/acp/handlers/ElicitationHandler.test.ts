import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import { ElicitationHandler } from "./ElicitationHandler"

import type { CreateElicitationRequest } from "@agentclientprotocol/sdk"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ log: vi.fn() }))

const window = vscodeFake.window
const handler = new ElicitationHandler()

function form(properties: Record<string, unknown>, required: string[] = [], title?: string) {
  return {
    sessionId: "s1",
    mode: "form",
    message: "Need details",
    requestedSchema: { type: "object", title, properties, required }
  } as unknown as CreateElicitationRequest
}
/** Pick quick-pick items by label, one answer per prompt */
function pick(...labels: (string | string[] | undefined)[]) {
  for (const label of labels) {
    window.showQuickPick.mockImplementationOnce(async (items: any[]) =>
      label === undefined
        ? undefined
        : Array.isArray(label)
          ? items.filter(i => label.includes(i.label))
          : items.find(i => i.label === label)
    )
  }
}
const validator = (call = 0) => window.showInputBox.mock.calls[call][0].validateInput

describe("ElicitationHandler", () => {
  beforeEach(() => resetVscodeFake())

  it("declines anything but forms", async () => {
    const request = { sessionId: "s1", mode: "url", url: "https://example.invalid" }
    expect(await handler.createElicitation(request as any)).toEqual({ action: "decline" })
    expect(window.showInputBox).not.toHaveBeenCalled()
  })

  it("accepts an empty form without asking", async () => {
    expect(await handler.createElicitation(form({}))).toEqual({ action: "accept", content: {} })
  })

  it("asks for each field in turn with its position and description", async () => {
    window.showInputBox.mockResolvedValueOnce("ZDEMO").mockResolvedValueOnce("3.5")
    const request = form(
      {
        name: {
          type: "string",
          title: "Object name",
          description: "Program to create",
          default: "ZNEW"
        },
        factor: { type: "number" }
      },
      ["name"],
      "Create object"
    )
    expect(await handler.createElicitation(request)).toEqual({
      action: "accept",
      content: { name: "ZDEMO", factor: 3.5 }
    })
    expect(window.showInputBox.mock.calls[0][0]).toMatchObject({
      title: "Create object (1/2)",
      prompt: "Need details\n\nProgram to create",
      placeHolder: "Object name",
      value: "ZNEW",
      ignoreFocusOut: true
    })
    expect(window.showInputBox.mock.calls[1][0]).toMatchObject({
      title: "Create object (2/2)",
      placeHolder: "factor"
    })
  })

  it("leaves out skipped optional values and truncates integers", async () => {
    window.showInputBox.mockResolvedValueOnce("").mockResolvedValueOnce("7.9")
    const result = await handler.createElicitation(
      form({ note: { type: "string" }, count: { type: "integer" } })
    )
    expect(result).toEqual({ action: "accept", content: { count: 7 } })
    expect(window.showInputBox.mock.calls[0][0].title).toBe("Agent (1/2)")
  })

  it("validates text against required, length and pattern rules", async () => {
    window.showInputBox.mockResolvedValue(undefined)
    await handler.createElicitation(
      form({ id: { type: "string", minLength: 2, maxLength: 4, pattern: "^Z" } }, ["id"])
    )
    const validate = validator()
    expect(validate(" ")).toBe("This value is required.")
    expect(validate("Z")).toBe("Enter at least 2 characters.")
    expect(validate("ZABCD")).toBe("Enter no more than 4 characters.")
    expect(validate("YAB")).toBe("The value does not match the required format.")
    expect(validate("ZAB")).toBeUndefined()
  })

  it("reports an invalid pattern from the agent", async () => {
    window.showInputBox.mockResolvedValue(undefined)
    await handler.createElicitation(form({ id: { type: "string", pattern: "(" } }))
    expect(validator()("x")).toBe("The agent supplied an invalid input pattern.")
  })

  it("validates numbers against type and range", async () => {
    window.showInputBox.mockResolvedValue(undefined)
    await handler.createElicitation(form({ n: { type: "integer", minimum: 1, maximum: 10 } }))
    const validate = validator()
    expect(validate("abc")).toBe("Enter a valid number.")
    expect(validate("1.5")).toBe("Enter a whole number.")
    expect(validate("0")).toBe("Enter a value of at least 1.")
    expect(validate("11")).toBe("Enter a value no greater than 10.")
    expect(validate("5")).toBeUndefined()
  })

  it("offers True, False and Skip for optional booleans", async () => {
    pick("False", "Skip")
    const result = await handler.createElicitation(
      form({ strict: { type: "boolean", title: "Strict?" }, verbose: { type: "boolean" } })
    )
    expect(result).toEqual({ action: "accept", content: { strict: false } })
    const [items, options] = window.showQuickPick.mock.calls[0]
    expect(items.map((i: any) => i.label)).toEqual(["True", "False", "Skip"])
    expect(options).toMatchObject({ placeHolder: "Strict?", ignoreFocusOut: true })
  })

  it("cannot skip a required boolean", async () => {
    pick("True")
    await handler.createElicitation(form({ go: { type: "boolean" } }, ["go"]))
    expect(window.showQuickPick.mock.calls[0][0].map((i: any) => i.label)).toEqual([
      "True",
      "False"
    ])
  })

  it("picks from enums and titled oneOf options", async () => {
    pick("b", "Second")
    const result = await handler.createElicitation(
      form(
        {
          plain: { type: "string", enum: ["a", "b", 3] },
          titled: {
            type: "string",
            oneOf: [
              { const: "one", title: "First" },
              { const: "two", title: "Second", description: "the other" },
              { title: "broken" }
            ]
          }
        },
        ["plain"]
      )
    )
    expect(result).toEqual({ action: "accept", content: { plain: "b", titled: "two" } })
    expect(window.showQuickPick.mock.calls[0][0].map((i: any) => i.label)).toEqual(["a", "b"])
    const titled = window.showQuickPick.mock.calls[1][0]
    expect(titled.map((i: any) => i.label)).toEqual(["First", "Second", "Skip"])
    expect(titled[1].description).toBe("the other")
  })

  it("multi-selects array options", async () => {
    pick(["X", "Z"])
    const result = await handler.createElicitation(
      form({
        tags: {
          type: "array",
          items: {
            anyOf: [
              { const: "x", title: "X" },
              { const: "y", title: "Y" },
              { const: "z", title: "Z" }
            ]
          }
        }
      })
    )
    expect(result).toEqual({ action: "accept", content: { tags: ["x", "z"] } })
    expect(window.showQuickPick.mock.calls[0][1]).toMatchObject({
      canPickMany: true,
      placeHolder: "tags (select all that apply)"
    })
  })

  it("asks again when a multi-select breaks the required or count rules", async () => {
    pick([], ["a", "b", "c"], ["a"])
    const result = await handler.createElicitation(
      form({ pick: { type: "array", maxItems: 2, items: { enum: ["a", "b", "c"] } } }, ["pick"])
    )
    expect(result).toEqual({ action: "accept", content: { pick: ["a"] } })
    expect(window.showWarningMessage.mock.calls.map(c => c[0])).toEqual([
      'Select at least one value for "pick".',
      'The selection count for "pick" is outside the allowed range.'
    ])
  })

  it("takes comma-separated text for free-form arrays", async () => {
    window.showInputBox.mockResolvedValueOnce(" a, b ,, c ").mockResolvedValueOnce(" , ")
    const result = await handler.createElicitation(
      form({ list: { type: "array", minItems: 2, maxItems: 3 }, extra: { type: "array" } })
    )
    expect(result).toEqual({ action: "accept", content: { list: ["a", "b", "c"] } })
    expect(window.showInputBox.mock.calls[0][0].prompt).toBe(
      "Need details\nEnter comma-separated values."
    )
    const validate = validator()
    expect(validate("a")).toBe("Enter at least 2 values.")
    expect(validate("a,b,c,d")).toBe("Enter no more than 3 values.")
    expect(validate("a,b")).toBeUndefined()
  })

  it("requires at least one value for a required free-form array", async () => {
    window.showInputBox.mockResolvedValue(undefined)
    await handler.createElicitation(form({ list: { type: "array" } }, ["list"]))
    expect(validator()(" , ")).toBe("Enter at least one value.")
  })

  it.each([
    ["text", { type: "string" }, () => window.showInputBox.mockResolvedValue(undefined)],
    ["boolean", { type: "boolean" }, () => pick(undefined)],
    ["enum", { type: "string", enum: ["a"] }, () => pick(undefined)],
    ["multi-select", { type: "array", items: { enum: ["a"] } }, () => pick(undefined)],
    ["list", { type: "array" }, () => window.showInputBox.mockResolvedValue(undefined)]
  ])("cancels the whole form when a %s prompt is dismissed", async (_kind, property, dismiss) => {
    dismiss()
    const result = await handler.createElicitation(
      form({ first: property, second: { type: "string" } })
    )
    expect(result).toEqual({ action: "cancel" })
    expect(window.showInputBox.mock.calls.length + window.showQuickPick.mock.calls.length).toBe(1)
  })

  it("declines and warns about input types it cannot ask for", async () => {
    const result = await handler.createElicitation(form({ nested: { type: "object" } }))
    expect(result).toEqual({ action: "decline" })
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'The agent requested an unsupported input type for "nested".'
    )
  })
})
