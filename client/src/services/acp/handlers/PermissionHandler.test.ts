import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import { PermissionHandler } from "./PermissionHandler"

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ log: vi.fn() }))

const request = (options: RequestPermissionRequest["options"], title?: string) =>
  ({
    sessionId: "s1",
    toolCall: { toolCallId: "t1", title },
    options
  }) as RequestPermissionRequest

const OPTIONS: RequestPermissionRequest["options"] = [
  { optionId: "reject", name: "Reject", kind: "reject_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "once", name: "Allow once", kind: "allow_once" }
]

describe("PermissionHandler", () => {
  const handler = new PermissionHandler()
  beforeEach(() => resetVscodeFake())

  it("asks the user, marking allow and reject options", async () => {
    vscodeFake.window.showQuickPick.mockImplementation(async (items: any[]) => items[2])
    const response = await handler.requestPermission(request(OPTIONS, "Edit zdemo"))
    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "once" } })
    const [items, options] = vscodeFake.window.showQuickPick.mock.lastCall!
    expect(items.map((i: any) => i.label)).toEqual([
      "$(x) Reject",
      "$(check) Always allow",
      "$(check) Allow once"
    ])
    expect(items[1].description).toBe("allow_always")
    expect(options).toEqual({
      placeHolder: "Edit zdemo",
      title: "ACP Agent Permission Request",
      ignoreFocusOut: true
    })
  })

  it("reports a dismissed prompt as cancelled", async () => {
    vscodeFake.window.showQuickPick.mockResolvedValue(undefined)
    const response = await handler.requestPermission(request(OPTIONS))
    expect(response).toEqual({ outcome: { outcome: "cancelled" } })
    expect(vscodeFake.window.showQuickPick.mock.lastCall![1].placeHolder).toBe("Permission Request")
  })

  it("auto-approves with the first allow option when configured", async () => {
    vscodeFake.settings.set("abapfs.acp.autoApprovePermissions", "allowAll")
    const response = await handler.requestPermission(request(OPTIONS))
    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "always" } })
    expect(vscodeFake.window.showQuickPick).not.toHaveBeenCalled()
  })

  it("still asks when auto-approval has no allow option to pick", async () => {
    vscodeFake.settings.set("abapfs.acp.autoApprovePermissions", "allowAll")
    vscodeFake.window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    const response = await handler.requestPermission(request([OPTIONS[0]]))
    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "reject" } })
  })
})
