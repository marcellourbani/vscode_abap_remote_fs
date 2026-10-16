vi.mock("../../../lib", () => ({
  channel: { appendLine: vi.fn() }
}))

vi.mock("abap-adt-api", () => ({
  isAdtError: vi.fn(function (error: any) {
    return !!error?.adt
  })
}))

import { describeActivationError, summarizeActivationFailure } from "./activationMessages"
import { channel } from "../../../lib"

const message = (shortText: string, href = "", objDescr = "") => ({
  type: "E",
  shortText,
  href,
  objDescr,
  line: 0,
  forceSupported: false
})

describe("summarizeActivationFailure", () => {
  it("groups messages by the object they point to", () => {
    const failure = summarizeActivationFailure(
      {
        success: false,
        messages: [
          message(
            "Field FOO is unknown",
            "/sap/bc/adt/programs/includes/ztest_i01/source/main#start=3,1"
          ),
          message("Statement is not accessible", "", "Include ZTEST_F01")
        ],
        inactive: []
      },
      "ZTEST"
    )

    expect(failure.summary).toBe(
      "Activation failed: 2 errors in ztest_i01 (Field FOO is unknown...)"
    )
    expect(failure.details).toBe(
      "ztest_i01:\n  Field FOO is unknown\nZTEST_F01:\n  Statement is not accessible"
    )
    expect(channel.appendLine).toHaveBeenCalled()
  })

  it("names the objects SAP wants activated together", () => {
    const failure = summarizeActivationFailure(
      {
        success: false,
        messages: [],
        inactive: [
          {
            object: {
              "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_i01",
              "adtcore:type": "PROG/I",
              "adtcore:name": "ZTEST_I01",
              "adtcore:parentUri": "",
              user: "",
              deleted: false
            }
          }
        ]
      },
      "ZTEST"
    )

    expect(failure.summary).toBe(
      "Activation failed: these objects must be activated together: PROG/I ZTEST_I01"
    )
    expect(failure.details).toBe("Inactive objects: PROG/I ZTEST_I01")
  })
})

describe("describeActivationError", () => {
  it("shows status and trimmed body of ADT errors", () => {
    const summary = describeActivationError(
      {
        adt: true,
        type: "ExceptionResourceNotFound",
        response: { status: 404, body: "x".repeat(900) }
      },
      "Activation"
    )

    expect(summary).toBe(`Activation failed (404): ${"x".repeat(800)}…`)
  })

  it("explains why SAP asks for a main program of an include", () => {
    const summary = describeActivationError(
      {
        adt: true,
        type: "invalidMainProgram",
        message: "Select a master program for include ZTEST_I01 in the properties view"
      },
      "Activation"
    )

    expect(summary).toBe(
      "Activation failed (invalidMainProgram): Select a master program for include ZTEST_I01 in the properties view. " +
        "SAP has no valid main program for this include. This usually means the main program that contains the " +
        "INCLUDE statement is inactive, or was not activated after the INCLUDE statement was added. " +
        "Activate the main program together with the include."
    )
  })

  it("does not double the full stop before the main program hint", () => {
    const summary = describeActivationError(
      { adt: true, type: "invalidMainProgram", message: "Master program ZTEST is invalid." },
      "Activation"
    )

    expect(summary).toContain("Master program ZTEST is invalid. SAP has no valid main program")
  })

  it("explains lost connections", () => {
    expect(describeActivationError(new Error("read ECONNRESET"), "Activation")).toContain(
      "Connection lost during activation"
    )
  })

  it("passes other messages through", () => {
    expect(describeActivationError(new Error("boom"), "Activation")).toBe("boom")
  })
})
