import { setContext, AbapFsContexts } from "./context"

jest.mock("vscode", () => ({
  commands: {
    executeCommand: jest.fn()
  }
}), { virtual: true })

import * as vscode from "vscode"

describe("context", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("setContext", () => {
    it("calls executeCommand with setContext and the given key and value", () => {
      setContext("abapfs:showActivate", true)
      expect((vscode.commands.executeCommand as jest.Mock)).toHaveBeenCalledWith(
        "setContext",
        "abapfs:showActivate",
        true
      )
    })

    it("passes false value correctly", () => {
      setContext("abapfs:extensionActive", false)
      expect((vscode.commands.executeCommand as jest.Mock)).toHaveBeenCalledWith(
        "setContext",
        "abapfs:extensionActive",
        false
      )
    })

    it("passes string values correctly", () => {
      setContext("abapfs:blameActive", "someValue")
      expect((vscode.commands.executeCommand as jest.Mock)).toHaveBeenCalledWith(
        "setContext",
        "abapfs:blameActive",
        "someValue"
      )
    })

    it("passes undefined value correctly", () => {
      setContext("abapfs:showTableContentIcon", undefined)
      expect((vscode.commands.executeCommand as jest.Mock)).toHaveBeenCalledWith(
        "setContext",
        "abapfs:showTableContentIcon",
        undefined
      )
    })

    const allContextKeys: AbapFsContexts[] = [
      "abapfs:showActivate",
      "abapfs:atc:autorefreshOn",
      "abapfs:atc:exemptFilterOn",
      "abapfs:atcdoc:navigation:back",
      "abapfs:atcdoc:navigation:next",
      "abapfs:extensionActive",
      "abapfs:showTableContentIcon",
      "abapfs:enableLeftPrevRev",
      "abapfs:enableLeftNextRev",
      "abapfs:enableRightPrevRev",
      "abapfs:enableRightNextRev",
      "abapfs:blameActive",
      "abapfs:blameAvailable"
    ]

    it.each(allContextKeys)("works with context key '%s'", key => {
      setContext(key, true)
      expect((vscode.commands.executeCommand as jest.Mock)).toHaveBeenCalledWith(
        "setContext",
        key,
        true
      )
    })
  })
})
