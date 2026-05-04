const mockChannel = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  appendLine: jest.fn(),
  append: jest.fn()
}

const mockCreateOutputChannel = jest.fn().mockReturnValue(mockChannel)

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    createOutputChannel: mockCreateOutputChannel
  }
}))

import { channel, log, CHANNELNAME } from "./logger"

beforeEach(() => {
  // Only clear the channel method mocks, not createOutputChannel
  // since it was already called at module load time
  mockChannel.info.mockClear()
  mockChannel.warn.mockClear()
  mockChannel.error.mockClear()
  mockChannel.debug.mockClear()
  mockChannel.trace.mockClear()
})

describe("logger", () => {
  describe("CHANNELNAME", () => {
    it("is 'ABAP FS'", () => {
      expect(CHANNELNAME).toBe("ABAP FS")
    })
  })

  describe("channel creation", () => {
    it("creates output channel with correct name and log option", () => {
      expect(mockCreateOutputChannel).toHaveBeenCalledWith("ABAP FS", { log: true })
    })

    it("channel is the object returned by createOutputChannel", () => {
      expect(channel).toBe(mockChannel)
    })
  })

  describe("log()", () => {
    it("calls channel.info with joined messages", () => {
      log("hello", " world")
      expect(channel.info).toHaveBeenCalledWith("hello world")
    })

    it("calls channel.info with single message", () => {
      log("single")
      expect(channel.info).toHaveBeenCalledWith("single")
    })

    it("handles empty string", () => {
      log("")
      expect(channel.info).toHaveBeenCalledWith("")
    })

    it("joins multiple arguments without separator", () => {
      log("a", "b", "c")
      expect(channel.info).toHaveBeenCalledWith("abc")
    })
  })

  describe("log.info()", () => {
    it("calls channel.info with joined messages", () => {
      log.info("info", " msg")
      expect(channel.info).toHaveBeenCalledWith("info msg")
    })

    it("handles single argument", () => {
      log.info("test")
      expect(channel.info).toHaveBeenCalledWith("test")
    })
  })

  describe("log.warn()", () => {
    it("calls channel.warn with joined messages", () => {
      log.warn("warning", " text")
      expect(channel.warn).toHaveBeenCalledWith("warning text")
    })

    it("handles single argument", () => {
      log.warn("w")
      expect(channel.warn).toHaveBeenCalledWith("w")
    })
  })

  describe("log.error()", () => {
    it("calls channel.error with joined messages", () => {
      log.error("error", " occurred")
      expect(channel.error).toHaveBeenCalledWith("error occurred")
    })

    it("handles single argument", () => {
      log.error("e")
      expect(channel.error).toHaveBeenCalledWith("e")
    })
  })

  describe("log.debug()", () => {
    it("calls channel.debug with joined messages", () => {
      log.debug("debug", " info")
      expect(channel.debug).toHaveBeenCalledWith("debug info")
    })

    it("handles single argument", () => {
      log.debug("d")
      expect(channel.debug).toHaveBeenCalledWith("d")
    })
  })

  describe("log.trace()", () => {
    it("calls channel.trace with joined messages", () => {
      log.trace("trace", " data")
      expect(channel.trace).toHaveBeenCalledWith("trace data")
    })

    it("handles single argument", () => {
      log.trace("t")
      expect(channel.trace).toHaveBeenCalledWith("t")
    })
  })

  describe("edge cases", () => {
    it("log with no arguments joins empty array", () => {
      log()
      expect(channel.info).toHaveBeenCalledWith("")
    })

    it("log.info with no arguments joins empty array", () => {
      log.info()
      expect(channel.info).toHaveBeenCalledWith("")
    })

    it("log.warn with no arguments", () => {
      log.warn()
      expect(channel.warn).toHaveBeenCalledWith("")
    })

    it("log.error with no arguments", () => {
      log.error()
      expect(channel.error).toHaveBeenCalledWith("")
    })

    it("log.debug with no arguments", () => {
      log.debug()
      expect(channel.debug).toHaveBeenCalledWith("")
    })

    it("log.trace with no arguments", () => {
      log.trace()
      expect(channel.trace).toHaveBeenCalledWith("")
    })
  })
})
