/**
 * Tests for heartbeatTypes.ts
 * - parseDurationMs
 * - formatDuration
 * - isWithinActiveHours
 * - parseHeartbeatResponse
 * - DEFAULT_HEARTBEAT_CONFIG
 * - HEARTBEAT_OK_TOKEN
 */

import {
  parseDurationMs,
  formatDuration,
  isWithinActiveHours,
  parseHeartbeatResponse,
  DEFAULT_HEARTBEAT_CONFIG,
  HEARTBEAT_OK_TOKEN,
} from "./heartbeatTypes"

// ============================================================================
// parseDurationMs
// ============================================================================

describe("parseDurationMs", () => {
  describe("seconds", () => {
    test("parses 's' suffix", () => {
      expect(parseDurationMs("30s")).toBe(30_000)
    })
    test("parses 'sec' suffix", () => {
      expect(parseDurationMs("10sec")).toBe(10_000)
    })
    test("parses 'secs' suffix", () => {
      expect(parseDurationMs("5secs")).toBe(5_000)
    })
    test("parses 'seconds' suffix", () => {
      expect(parseDurationMs("60seconds")).toBe(60_000)
    })
    test("parses case-insensitive 'SECONDS'", () => {
      expect(parseDurationMs("1SECONDS")).toBe(1_000)
    })
  })

  describe("minutes", () => {
    test("parses 'm' suffix", () => {
      expect(parseDurationMs("5m")).toBe(300_000)
    })
    test("parses 'min' suffix", () => {
      expect(parseDurationMs("10min")).toBe(600_000)
    })
    test("parses 'mins' suffix", () => {
      expect(parseDurationMs("2mins")).toBe(120_000)
    })
    test("parses 'minutes' suffix", () => {
      expect(parseDurationMs("30minutes")).toBe(1_800_000)
    })
    test("defaults to minutes when no unit is given", () => {
      expect(parseDurationMs("5")).toBe(300_000)
    })
    test("parses case-insensitive 'M'", () => {
      expect(parseDurationMs("1M")).toBe(60_000)
    })
  })

  describe("hours", () => {
    test("parses 'h' suffix", () => {
      expect(parseDurationMs("1h")).toBe(3_600_000)
    })
    test("parses 'hr' suffix", () => {
      expect(parseDurationMs("2hr")).toBe(7_200_000)
    })
    test("parses 'hrs' suffix", () => {
      expect(parseDurationMs("3hrs")).toBe(10_800_000)
    })
    test("parses 'hours' suffix", () => {
      expect(parseDurationMs("1hours")).toBe(3_600_000)
    })
    test("parses case-insensitive 'H'", () => {
      expect(parseDurationMs("1H")).toBe(3_600_000)
    })
  })

  describe("decimals", () => {
    test("parses decimal minutes", () => {
      expect(parseDurationMs("1.5m")).toBe(90_000)
    })
    test("parses decimal hours", () => {
      expect(parseDurationMs("0.5h")).toBe(1_800_000)
    })
  })

  describe("whitespace", () => {
    test("trims leading/trailing whitespace", () => {
      expect(parseDurationMs("  5m  ")).toBe(300_000)
    })
  })

  describe("invalid inputs", () => {
    test("returns null for empty string", () => {
      expect(parseDurationMs("")).toBeNull()
    })
    test("returns null for letters only", () => {
      expect(parseDurationMs("abc")).toBeNull()
    })
    test("returns null for negative value", () => {
      expect(parseDurationMs("-5m")).toBeNull()
    })
    test("returns null for unknown suffix", () => {
      expect(parseDurationMs("5x")).toBeNull()
    })
    test("returns null for 'days'", () => {
      expect(parseDurationMs("1d")).toBeNull()
    })
  })
})

// ============================================================================
// formatDuration
// ============================================================================

describe("formatDuration", () => {
  test("formats 0ms", () => {
    expect(formatDuration(0)).toBe("0ms")
  })
  test("formats sub-second ms", () => {
    expect(formatDuration(500)).toBe("500ms")
  })
  test("formats exactly 999ms", () => {
    expect(formatDuration(999)).toBe("999ms")
  })
  test("formats 1000ms as 1s", () => {
    expect(formatDuration(1000)).toBe("1s")
  })
  test("formats 45s", () => {
    expect(formatDuration(45_000)).toBe("45s")
  })
  test("formats 59999ms as 60s", () => {
    expect(formatDuration(59_999)).toBe("60s")
  })
  test("formats exactly 60000ms as 1m", () => {
    expect(formatDuration(60_000)).toBe("1m")
  })
  test("formats 30 minutes", () => {
    expect(formatDuration(1_800_000)).toBe("30m")
  })
  test("formats exactly 1 hour", () => {
    expect(formatDuration(3_600_000)).toBe("1.0h")
  })
  test("formats 2.5 hours", () => {
    expect(formatDuration(9_000_000)).toBe("2.5h")
  })
})

// ============================================================================
// isWithinActiveHours
// ============================================================================

describe("isWithinActiveHours", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("returns true when no config provided", () => {
    expect(isWithinActiveHours(undefined)).toBe(true)
  })

  test("returns true when current time is within active hours", () => {
    // Set time to 10:00 AM
    jest.setSystemTime(new Date("2024-01-15T10:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(true)
  })

  test("returns false when current time is before start", () => {
    // Set time to 7:00 AM
    jest.setSystemTime(new Date("2024-01-15T07:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(false)
  })

  test("returns false when current time is after end", () => {
    // Set time to 11:00 PM
    jest.setSystemTime(new Date("2024-01-15T23:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(false)
  })

  test("returns true at exactly start time", () => {
    jest.setSystemTime(new Date("2024-01-15T08:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(true)
  })

  test("returns false at exactly end time", () => {
    jest.setSystemTime(new Date("2024-01-15T22:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(false)
  })

  test("handles 24:00 as end of day", () => {
    jest.setSystemTime(new Date("2024-01-15T23:59:00"))
    expect(isWithinActiveHours({ start: "00:00", end: "24:00" })).toBe(true)
  })

  test("returns false at midnight for 08:00-22:00 window", () => {
    jest.setSystemTime(new Date("2024-01-15T00:00:00"))
    expect(isWithinActiveHours({ start: "08:00", end: "22:00" })).toBe(false)
  })

  test("handles minutes correctly (09:30 in 09:00-22:00)", () => {
    jest.setSystemTime(new Date("2024-01-15T09:30:00"))
    expect(isWithinActiveHours({ start: "09:00", end: "22:00" })).toBe(true)
  })

  test("handles minutes boundary (08:59 with 09:00 start)", () => {
    jest.setSystemTime(new Date("2024-01-15T08:59:00"))
    expect(isWithinActiveHours({ start: "09:00", end: "22:00" })).toBe(false)
  })
})

// ============================================================================
// parseHeartbeatResponse
// ============================================================================

describe("parseHeartbeatResponse", () => {
  const ACK_MAX_CHARS = 300

  test("recognizes exact HEARTBEAT_OK token as ack", () => {
    const result = parseHeartbeatResponse("HEARTBEAT_OK", ACK_MAX_CHARS)
    expect(result.isAck).toBe(true)
    expect(result.hasAlert).toBe(false)
    expect(result.cleanedResponse).toBe("")
  })

  test("recognizes HEARTBEAT_OK with surrounding whitespace", () => {
    const result = parseHeartbeatResponse("  HEARTBEAT_OK  ", ACK_MAX_CHARS)
    expect(result.isAck).toBe(true)
  })

  test("recognizes HEARTBEAT_OK embedded in text", () => {
    const result = parseHeartbeatResponse("All good. HEARTBEAT_OK done.", ACK_MAX_CHARS)
    expect(result.isAck).toBe(true)
  })

  test("is case-insensitive for token detection", () => {
    const result = parseHeartbeatResponse("heartbeat_ok", ACK_MAX_CHARS)
    expect(result.isAck).toBe(true)
  })

  test("returns alert for response without token", () => {
    const result = parseHeartbeatResponse("There is a new dump in the system!", ACK_MAX_CHARS)
    expect(result.isAck).toBe(false)
    expect(result.hasAlert).toBe(true)
    expect(result.cleanedResponse).toBe("There is a new dump in the system!")
  })

  test("returns alert for empty string (no token)", () => {
    const result = parseHeartbeatResponse("", ACK_MAX_CHARS)
    expect(result.isAck).toBe(false)
    expect(result.hasAlert).toBe(true)
    expect(result.cleanedResponse).toBe("")
  })

  test("trims the cleaned response for alerts", () => {
    const result = parseHeartbeatResponse("  Alert message  ", ACK_MAX_CHARS)
    expect(result.cleanedResponse).toBe("Alert message")
  })

  test("alert response preserves multiline content", () => {
    const msg = "Line 1\nLine 2\nLine 3"
    const result = parseHeartbeatResponse(msg, ACK_MAX_CHARS)
    expect(result.isAck).toBe(false)
    expect(result.cleanedResponse).toBe(msg)
  })
})

// ============================================================================
// DEFAULT_HEARTBEAT_CONFIG
// ============================================================================

describe("DEFAULT_HEARTBEAT_CONFIG", () => {
  test("has enabled=false by default (opt-in)", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.enabled).toBe(false)
  })
  test("has every='30m' default interval", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.every).toBe("30m")
  })
  test("has empty model by default", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.model).toBe("")
  })
  test("has ackMaxChars of 300", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.ackMaxChars).toBe(300)
  })
  test("has maxHistory of 100", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.maxHistory).toBe(100)
  })
  test("has maxConsecutiveErrors of 5", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.maxConsecutiveErrors).toBe(5)
  })
  test("has notifyOnAlert=true", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.notifyOnAlert).toBe(true)
  })
  test("has notifyOnError=true", () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.notifyOnError).toBe(true)
  })
})

// ============================================================================
// HEARTBEAT_OK_TOKEN
// ============================================================================

describe("HEARTBEAT_OK_TOKEN", () => {
  test("is the string HEARTBEAT_OK", () => {
    expect(HEARTBEAT_OK_TOKEN).toBe("HEARTBEAT_OK")
  })
})
