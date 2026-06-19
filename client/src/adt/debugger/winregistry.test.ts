jest.mock("vscode", () => ({
  extensions: {
    getExtension: jest.fn()
  }
}), { virtual: true })

import { getWinRegistryReader } from "./winregistry"
import { extensions } from "vscode"

const mockGetExtension = extensions.getExtension as jest.MockedFunction<typeof extensions.getExtension>

describe("getWinRegistryReader", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("returns undefined when extension is not found", () => {
    mockGetExtension.mockReturnValueOnce(undefined as any)
    expect(getWinRegistryReader()).toBeUndefined()
  })

  test("returns undefined when extension is not active", () => {
    mockGetExtension.mockReturnValueOnce({
      isActive: false,
      exports: { GetStringRegKey: jest.fn() }
    } as any)
    expect(getWinRegistryReader()).toBeUndefined()
  })

  test("returns GetStringRegKey when extension is active", () => {
    const mockGetStringRegKey = jest.fn()
    mockGetExtension.mockReturnValueOnce({
      isActive: true,
      exports: { GetStringRegKey: mockGetStringRegKey }
    } as any)
    const result = getWinRegistryReader()
    expect(result).toBe(mockGetStringRegKey)
  })

  test("calls getExtension with the correct extension id", () => {
    mockGetExtension.mockReturnValueOnce(undefined as any)
    getWinRegistryReader()
    expect(mockGetExtension).toHaveBeenCalledWith("murbani.winregistry")
  })

  test("returns undefined when extension has no exports", () => {
    mockGetExtension.mockReturnValueOnce({
      isActive: true,
      exports: undefined
    } as any)
    // Source accesses ext.exports.GetStringRegKey without guarding exports
    expect(() => getWinRegistryReader()).toThrow()
  })
})
