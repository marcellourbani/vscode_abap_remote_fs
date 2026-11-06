import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser, type Page } from "playwright"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const media = path.resolve(import.meta.dirname, "../../../media")
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined)
  })
}, 30000)
afterAll(async () => {
  await browser?.close()
}, 30000)
const analysis = {
  id: "example",
  name: "Example",
  revision: 1,
  connectionId: "example",
  packages: ["ZPACKAGE"],
  includeSubpackages: true,
  discoveryMode: "connected",
  jobMode: "upload",
  jobConnection: "",
  periodLabel: "",
  discoveryDone: true,
  canDependencies: false,
  stages: { discovery: { status: "complete", elapsedMs: 0 } },
  dependencyConnectionId: "example",
  concurrency: 5,
  jobsFrom: "",
  jobsTo: "",
  inputs: [],
  issues: [],
  failedChecks: [],
  run: { stage: "discovery", status: "idle", completed: 0, elapsedMs: 0 }
}
const inventory = Array.from({ length: 300 }, (_, index) => ({
  key: `R3TR:PROG:Z${String(index).padStart(4, "0")}`,
  objectName: `Z${String(index).padStart(4, "0")}`,
  objectType: "PROG",
  packageName: "ZPACKAGE",
  status: "unclear",
  reasons: [],
  periods: []
}))

async function fixture(page: Page, selected = true, theme: "light" | "dark" = "light") {
  await page.addInitScript(() => {
    const host = globalThis as unknown as {
      acquireVsCodeApi: () => unknown
      hostMessages: unknown[]
      hostStates: Record<string, Record<string, unknown>>
      cancelNextSave?: boolean
    }
    host.hostMessages = []
    host.hostStates = {}
    window.addEventListener("message", event => {
      if (event.data.command === "state" && event.data.analysis)
        host.hostStates[event.data.analysis.id] = structuredClone(event.data.analysis)
    })
    host.acquireVsCodeApi = () => ({
      getState: () => JSON.parse(sessionStorage.getItem("usage-state") || "null"),
      setState: (state: unknown) => sessionStorage.setItem("usage-state", JSON.stringify(state)),
      postMessage: (message: unknown) => {
        host.hostMessages.push(message)
        const request = message as {
          command: string
          analysisId: string
          requestId: number
          options: Record<string, unknown>
        }
        if (request.command !== "save") return
        const state = host.hostStates[request.analysisId]
        if (!state) return
        if (host.cancelNextSave) {
          host.cancelNextSave = false
          queueMicrotask(() =>
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  command: "saved",
                  analysis: structuredClone(state),
                  cancelled: true,
                  analysisId: request.analysisId,
                  requestId: request.requestId
                }
              })
            )
          )
          return
        }
        const options = { ...request.options }
        if (typeof options.packages === "string")
          options.packages = options.packages
            .split(/[,\n]+/)
            .map(value => value.trim().toUpperCase())
            .filter(Boolean)
        Object.assign(state, options)
        state.revision = Number(state.revision) + 1
        queueMicrotask(() =>
          window.dispatchEvent(
            new MessageEvent("message", {
              data: {
                command: "saved",
                analysis: structuredClone(state),
                analysisId: request.analysisId,
                requestId: request.requestId
              }
            })
          )
        )
      }
    })
  })
  await page.route("http://usage.test/**", async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || "main.html"
    if (name === "theme.css") {
      await route.fulfill({
        contentType: "text/css",
        body:
          ":root { --vscode-font-family: 'Segoe UI', sans-serif; --vscode-foreground: #292d32; --vscode-editor-background: #fff; --vscode-editorWidget-background: #f3f4f6; --vscode-input-background: #fff; --vscode-input-foreground: #292d32; --vscode-panel-border: #d7dce0; --vscode-input-border: #c3cbd2; --vscode-focusBorder: #007f87; --vscode-button-background: #007f87; --vscode-button-foreground: #fff; --vscode-button-secondaryBackground: #e9edf0; --vscode-button-secondaryForeground: #292d32; --vscode-descriptionForeground: #657079; --vscode-list-hoverBackground: #eaf5f3; --vscode-list-inactiveSelectionBackground: #eaf5f3; --vscode-progressBar-background: #007f87; }" +
          (theme === "dark"
            ? ":root { --vscode-foreground: #ccc; --vscode-editor-background: #111; --vscode-editorWidget-background: #222; --vscode-input-background: #222; --vscode-input-foreground: #ccc; --vscode-list-hoverBackground: initial; --vscode-list-inactiveSelectionBackground: initial; }"
            : "")
      })
      return
    }
    let file: string
    if (name === "tabulator.min.js" || name === "tabulator_bootstrap4.min.css")
      file = path.join(media, name)
    else if (name === "codicon.css") file = require.resolve("@vscode/codicons/dist/codicon.css")
    else if (name === "codicon.ttf") file = require.resolve("@vscode/codicons/dist/codicon.ttf")
    else file = path.join(media, "repositoryUsage", name)
    let content = await fs.readFile(file)
    if (name === "main.html") {
      const tokens: Record<string, string> = {
        CSP: "http://usage.test",
        NONCE: "test",
        CSS: "/main.css",
        JS: "/main.js",
        MODEL: "/viewModel.js",
        TABULATOR: "/tabulator.min.js",
        TABLECSS: "/tabulator_bootstrap4.min.css",
        ICONCSS: "/codicon.css"
      }
      content = Buffer.from(
        content
          .toString()
          .replace(/\{\{([A-Z]+)\}\}/g, (_match, key: string) => tokens[key])
          .replace("</head>", '<link rel="stylesheet" href="/theme.css"></head>')
      )
    }
    await route.fulfill({
      contentType: name.endsWith(".html")
        ? "text/html"
        : name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".ttf")
            ? "font/ttf"
            : "text/javascript",
      body: content
    })
  })
  await page.goto("http://usage.test/")
  if (!selected) return
  await deliver(page, {
    command: "state",
    analysis,
    analyses: [{ id: "example", name: "Example" }],
    systems: ["example"],
    rows: inventory
  })
  await page.waitForFunction(() =>
    document.getElementById("counts")?.textContent?.includes("300 total")
  )
}
const deliver = (page: Page, data: unknown) =>
  page.evaluate(
    message => window.dispatchEvent(new MessageEvent("message", { data: message })),
    data
  )

describe("repository usage webview interactions", () => {
  it.each([1440, 420])(
    "filters and exports 2249 issues and removes resolved rows at %s px",
    async width => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      try {
        await fixture(page)
        const issueRows = Array.from({ length: 2249 }, (_, index) => ({
          id: `issue-${index}`,
          stage: "Dependencies",
          source: "Where-used",
          objectName: `ZOBJECT_${index}`,
          objectType: index % 2 ? "DOMA" : "VIEW",
          packageName: "ZPACKAGE",
          file: "",
          message: `Lookup failed for ZOBJECT_${index}`
        }))
        await deliver(page, {
          command: "update",
          analysis: { ...analysis, revision: 2, issueRows }
        })
        await page.waitForFunction(
          () => document.getElementById("issueCount")?.textContent === "2,249"
        )
        await page.locator('[data-results="issues"]').click()
        await page.waitForFunction(
          () =>
            document.getElementById("visibleIssueCount")?.textContent ===
            "Showing 2,249 of 2,249 issues"
        )
        expect(await page.locator("#issueCount").textContent()).toBe("2,249")
        expect(await page.locator("#inventoryResults").isHidden()).toBe(true)
        await page.locator("#issueTable .tabulator-tableholder").evaluate(element => {
          element.scrollLeft = 300
        })
        await page
          .locator('#issueTable .tabulator-col[tabulator-field="objectType"] input')
          .fill("DOMA")
        await page
          .locator('#issueTable .tabulator-col[tabulator-field="objectType"] input')
          .press("End")
        await page.waitForFunction(
          () =>
            document.getElementById("visibleIssueCount")?.textContent ===
            "Showing 1,124 of 2,249 issues"
        )
        expect(await page.locator("#visibleIssueCount").textContent()).toBe(
          "Showing 1,124 of 2,249 issues"
        )
        await page.locator("#issueExportView").selectOption("filtered")
        await page.locator("#exportIssues").click()
        await page.waitForFunction(() =>
          (globalThis as unknown as { hostMessages: { command: string }[] }).hostMessages.some(
            message => message.command === "exportIssues"
          )
        )
        expect(
          await page.evaluate(
            "hostMessages.find(message => message.command === 'exportIssues').keys.length"
          )
        ).toBe(1124)
        expect(
          await page.evaluate(
            "hostMessages.find(message => message.command === 'exportIssues').type"
          )
        ).toBe("xlsx")
        await page.locator("#issueExportType").selectOption("csv")
        await page.locator("#exportIssues").click()
        await page.waitForFunction(
          () =>
            (globalThis as unknown as { hostMessages: { command: string }[] }).hostMessages.filter(
              message => message.command === "exportIssues"
            ).length === 2
        )
        expect(
          await page.evaluate(
            "hostMessages.filter(message => message.command === 'exportIssues')[1].type"
          )
        ).toBe("csv")
        await deliver(page, {
          command: "update",
          analysis: { ...analysis, revision: 3, issueRows: issueRows.slice(2) }
        })
        await page.waitForFunction(
          () =>
            document.getElementById("visibleIssueCount")?.textContent ===
            "Showing 1,123 of 2,247 issues"
        )
        expect(await page.locator("#issueCount").textContent()).toBe("2,247")
        await page.locator("#clearIssueFilters").click()
        await page.waitForFunction(
          () =>
            document.getElementById("visibleIssueCount")?.textContent ===
            "Showing 2,247 of 2,247 issues"
        )
        const bounds = await page.locator("#issueTable").boundingBox()
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        expect(await page.locator("#issueTable .tabulator-row").count()).toBeLessThan(150)
        await page.locator('[data-results="inventory"]').click()
        expect(await page.locator("#inventoryResults").isVisible()).toBe(true)
        expect(await page.locator("#counts").textContent()).toContain("300 total")
      } finally {
        await page.close()
      }
    },
    15000
  )
  it.each([1440, 420])(
    "saves and restores independent job status checkboxes at %s px",
    async width => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      try {
        await fixture(page)
        await page.locator('[data-stage="jobs"]').click()
        const released = page.getByLabel("Consider released jobs", { exact: true })
        const scheduled = page.getByLabel("Consider scheduled jobs", { exact: true })
        expect(await released.isChecked()).toBe(false)
        expect(await scheduled.isChecked()).toBe(false)
        await released.check()
        await page.waitForFunction(
          "hostStates.example.includeReleasedJobs === true && saves.size === 0"
        )
        expect(await scheduled.isChecked()).toBe(false)
        await scheduled.check()
        await page.waitForFunction(
          "hostStates.example.includeScheduledJobs === true && saves.size === 0"
        )
        await page.locator("#jobMode").selectOption("connected")
        await page.waitForFunction("hostStates.example.jobMode === 'connected' && saves.size === 0")
        expect(await released.isVisible()).toBe(true)
        expect(await scheduled.isVisible()).toBe(true)
        const restored = await page.evaluate("structuredClone(hostStates.example)")
        await page.reload()
        await deliver(page, {
          command: "state",
          analysis: restored,
          analyses: [{ id: "example", name: "Example" }],
          systems: ["example"],
          rows: inventory
        })
        await page.evaluate("messages")
        expect(await released.isChecked()).toBe(true)
        expect(await scheduled.isChecked()).toBe(true)
        for (const control of [released, scheduled]) {
          const label = await control.locator("..").boundingBox()
          expect(label!.x + label!.width).toBeLessThanOrEqual(width)
        }
        await page.evaluate("cancelNextSave = true")
        await released.click()
        await page.waitForFunction(
          "document.getElementById('includeReleasedJobs').checked && saves.size === 0"
        )
        expect(await scheduled.isChecked()).toBe(true)
        expect(await page.evaluate("hostStates.example.includeReleasedJobs")).toBe(true)
        await page.locator('[data-run="jobs"]').click()
        await page.waitForFunction("hostMessages.some(message => message.command === 'jobs')")
        expect(
          await page.evaluate("hostMessages.find(message => message.command === 'jobs').options")
        ).toMatchObject({
          includeReleasedJobs: true,
          includeScheduledJobs: true
        })
      } finally {
        await page.close()
      }
    },
    10000
  )
  it("restores vertical scroll after switching analyses and reloading", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const holder = page.locator("#inventory .tabulator-tableholder")
      await holder.evaluate(element => {
        element.scrollTop = 1000
      })
      await page.waitForFunction(
        () =>
          JSON.parse(sessionStorage.getItem("usage-state") || "{}").views?.example?.scroll?.top ===
          1000
      )
      const analyses = [
        { id: "example", name: "Example" },
        { id: "second", name: "Second" }
      ]
      await deliver(page, {
        command: "state",
        analysis: { ...analysis, id: "second", name: "Second" },
        analyses,
        systems: ["example"],
        rows: inventory
      })
      await page.evaluate("messages")
      await holder.evaluate(element => {
        element.scrollTop = 250
      })
      await page.waitForFunction(
        () =>
          JSON.parse(sessionStorage.getItem("usage-state") || "{}").views?.second?.scroll?.top ===
          250
      )
      await deliver(page, {
        command: "state",
        analysis,
        analyses,
        systems: ["example"],
        rows: inventory
      })
      await page.evaluate("messages")
      expect(await holder.evaluate(element => element.scrollTop)).toBe(1000)
      await page.reload()
      await deliver(page, {
        command: "state",
        analysis,
        analyses,
        systems: ["example"],
        rows: inventory
      })
      await page.evaluate("messages")
      expect(await holder.evaluate(element => element.scrollTop)).toBe(1000)
    } finally {
      await page.close()
    }
  }, 20_000)
  it("preserves vertical scroll when the retained webview is hidden and shown", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const holder = page.locator("#inventory .tabulator-tableholder")
      await holder.evaluate(element => {
        element.scrollTop = 1000
      })
      await page.waitForFunction(
        () =>
          JSON.parse(sessionStorage.getItem("usage-state") || "{}").views?.example?.scroll?.top ===
          1000
      )
      await deliver(page, { command: "visibility", visible: false })
      await page.evaluate("messages")
      await holder.evaluate(element => {
        element.scrollTop = 0
      })
      await deliver(page, { command: "visibility", visible: true })
      await page.evaluate("messages")
      expect(await holder.evaluate(element => element.scrollTop)).toBe(1000)
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("usage-state") || "{}").views.example.scroll.top
        )
      ).toBe(1000)
    } finally {
      await page.close()
    }
  })
  it.each(["refreshDependencies", "retryFailedOrEmptyDependencies"])(
    "consumes %s once so Resume does not restart the request",
    async option => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      try {
        await fixture(page)
        await page.locator('[data-stage="dependencies"]').click()
        await page.locator(`#${option}`).check()
        await deliver(page, {
          command: "update",
          analysis: {
            ...analysis,
            revision: 2,
            run: { stage: "dependencies", status: "running", completed: 0, elapsedMs: 0 }
          }
        })
        await page.waitForFunction("analysis.revision === 2")
        expect(await page.locator(`#${option}`).isChecked()).toBe(false)
        expect(
          await page.evaluate(
            `JSON.parse(sessionStorage.getItem('usage-state')).views.example.${option}`
          )
        ).toBe(false)
      } finally {
        await page.close()
      }
    }
  )
  it.each([1440, 420])(
    "keeps full refresh and selective retry mutually exclusive at %s px",
    async width => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      try {
        await fixture(page)
        await page.locator('[data-stage="dependencies"]').click()
        const refresh = page.getByLabel("Refresh dependency cache", { exact: true })
        const retry = page.getByLabel("Only process failed/empty refs", { exact: true })
        await refresh.check()
        await retry.check()
        expect(await refresh.isChecked()).toBe(false)
        expect(await retry.isChecked()).toBe(true)
        expect(await page.evaluate("options()")).toMatchObject({
          refreshDependencies: false,
          retryFailedOrEmptyDependencies: true
        })
        const label = await retry.locator("..").boundingBox()
        expect(label!.x + label!.width).toBeLessThanOrEqual(width)
        await refresh.check()
        expect(await retry.isChecked()).toBe(false)
        expect(await page.evaluate("options()")).toMatchObject({
          refreshDependencies: true,
          retryFailedOrEmptyDependencies: false
        })
      } finally {
        await page.close()
      }
    }
  )
  it("shows pass convergence and cache progress while leaving table rows unchanged", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 2,
          run: {
            stage: "dependencies",
            status: "running",
            completed: 30,
            total: 100,
            elapsedMs: 0,
            activity: "Pass 2: checking inventory dependencies",
            unit: "checks",
            dependencyProgress: {
              pass: 2,
              used: 200,
              unclear: 100,
              newlyUsed: 0,
              cached: 30,
              failed: 0,
              history: [{ pass: 1, newlyUsed: 100, used: 200, unclear: 100 }]
            }
          }
        }
      })
      await page.waitForFunction("analysis.revision === 2")
      expect(await page.locator("#runActivity").textContent()).toContain("Pass 2")
      expect(await page.locator("#dependencyCounts").textContent()).toBe("200 Used / 100 Unclear")
      expect(await page.locator("#concurrency").getAttribute("max")).toBe("20")
      expect(await page.locator("#dependencyChecks").textContent()).toContain(
        "Cached checks reused: 30"
      )
      expect(await page.locator("#dependencyPasses").textContent()).toContain("Pass 1: +100 Used")
      expect(await page.locator("#counts").textContent()).toContain(
        "300 total / 0 used / 300 unclear"
      )
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 3,
          run: { stage: "jobs", status: "running", completed: 0, elapsedMs: 0 }
        }
      })
      await page.waitForFunction("analysis.revision === 3")
      expect(await page.locator("#dependencySummary").isHidden()).toBe(true)
      expect(await page.locator("#dependencyPasses").textContent()).toBe("")
    } finally {
      await page.close()
    }
  })
  it("restores a dependency selection when its confirmation is cancelled", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await deliver(page, {
        command: "state",
        analysis,
        analyses: [{ id: "example", name: "Example" }],
        systems: ["example", "other"],
        rows: inventory
      })
      await page.evaluate("messages")
      await page.locator('[data-stage="dependencies"]').click()
      await page.evaluate("cancelNextSave = true")
      await page.locator("#dependencyConnectionId").selectOption("other")
      await page.waitForFunction(
        "document.getElementById('dependencyConnectionId').value === 'example'"
      )
      expect(await page.evaluate("hostStates.example.dependencyConnectionId")).toBe("example")
      expect(await page.locator("#error").isHidden()).toBe(true)
      expect(await page.locator("#counts").textContent()).toContain("300 total")
    } finally {
      await page.close()
    }
  })
  it("does not launch processing after cancelling the option-save confirmation", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.evaluate("hostMessages.length = 0; cancelNextSave = true")
      await page.locator('[data-stage="jobs"]').click()
      await page.locator('[data-run="jobs"]').click()
      await page.waitForFunction(
        "hostMessages.some(message => message.command === 'save') && !pending"
      )
      expect(await page.evaluate("hostMessages.map(message => message.command)")).toEqual(["save"])
      expect(await page.locator("#runStatus").textContent()).toBe("discovery: idle")
    } finally {
      await page.close()
    }
  })
  it("restores run chrome after a cancelled or rejected action", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.locator('[data-reset="discovery"]').click()
      await page.waitForFunction("hostMessages.some(message => message.command === 'reset')")
      await deliver(page, { command: "idle", analysisId: "example" })
      await page.waitForFunction(
        "document.getElementById('runStatus').textContent === 'discovery: idle'"
      )
      expect(await page.locator("#progress").getAttribute("value")).not.toBeNull()
      expect(await page.locator("#runActivity").isHidden()).toBe(true)
      await page.locator('[data-reset="discovery"]').click()
      await deliver(page, {
        command: "error",
        analysisId: "example",
        message: "Reset was rejected"
      })
      await page.waitForFunction(
        "document.getElementById('error').textContent === 'Reset was rejected'"
      )
      expect(await page.locator("#runStatus").textContent()).toBe("discovery: idle")
      expect(await page.locator("#progress").getAttribute("value")).not.toBeNull()
      await deliver(page, { command: "idle", analysisId: "example" })
      await page.evaluate("messages")
      expect(await page.locator("#error").textContent()).toBe("Reset was rejected")
      expect(await page.locator("#error").isVisible()).toBe(true)
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 4,
          run: { stage: "discovery", status: "running", completed: 0, elapsedMs: 0 }
        }
      })
      await page.waitForFunction("analysis.revision === 4")
      expect(await page.locator("#error").isHidden()).toBe(true)
    } finally {
      await page.close()
    }
  })
  it("refreshes dependency availability and diagnostics from save acknowledgements", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.evaluate(`
        hostStates.example.canDependencies = true
        hostStates.example.relations = 'available'
      `)
      await page.locator('[data-stage="st03n"]').click()
      await page.locator("#period").fill("Updated period")
      await page.locator("#period").dispatchEvent("change")
      await page.waitForFunction("!document.querySelector('[data-run=dependencies]').disabled")
      expect(await page.locator("#relationsStatus").textContent()).toBe(
        "Object relations and where-used"
      )
      expect(await page.locator("#dependencyRequirement").isHidden()).toBe(true)
    } finally {
      await page.close()
    }
  })
  it("ignores late action errors belonging to a different analysis", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await deliver(page, {
        command: "state",
        analysis: { ...analysis, id: "second", name: "Second" },
        analyses: [{ id: "second", name: "Second" }],
        systems: ["example"],
        rows: inventory
      })
      await page.waitForFunction("analysis.id === 'second'")
      await deliver(page, { command: "error", analysisId: "example", message: "Old failure" })
      await deliver(page, { command: "idle", analysisId: "example" })
      await page.evaluate("messages")
      expect(await page.locator("#error").isHidden()).toBe(true)
      expect(await page.locator("#analysisName").textContent()).toBe("Second")
    } finally {
      await page.close()
    }
  })
  it("clears stale failure details on retry and hides completed activity", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const failure = "The selected SAP system is not connected"
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 2,
          stages: { discovery: { status: "failed", elapsedMs: 0 } },
          run: {
            stage: "discovery",
            status: "failed",
            completed: 0,
            elapsedMs: 0,
            activity: "Finding packages",
            error: failure
          }
        }
      })
      await page.waitForFunction("analysis.revision === 2")
      expect(await page.locator("#error").textContent()).toBe(failure)
      expect(await page.locator("#error").isVisible()).toBe(true)
      expect(await page.locator("#stageTimes").textContent()).toBe("discovery: 0:00 (failed)")

      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 3,
          stages: { discovery: { status: "failed", elapsedMs: 0 } },
          run: {
            stage: "discovery",
            status: "running",
            completed: 15,
            total: 30,
            elapsedMs: 19000,
            activity: "Reading repository objects",
            unit: "packages"
          }
        }
      })
      await page.waitForFunction("analysis.revision === 3")
      expect(await page.locator("#error").isHidden()).toBe(true)
      expect(await page.locator("#stageTimes").textContent()).toBe("")
      expect(await page.locator("#runActivity").textContent()).toBe("Reading repository objects")

      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 4,
          stages: { discovery: { status: "complete", elapsedMs: 33000 } },
          run: {
            stage: "discovery",
            status: "complete",
            completed: 1,
            total: 1,
            elapsedMs: 33000,
            activity: "Reading function modules: Z* (253 function groups)",
            unit: "prefix batches"
          }
        }
      })
      await page.waitForFunction("analysis.revision === 4")
      expect(await page.locator("#runActivity").isHidden()).toBe(true)
      expect(await page.locator("#runActivity").textContent()).toBe("")
      expect(await page.locator("#error").isHidden()).toBe(true)
      expect(await page.locator("#stageTimes").textContent()).toBe("discovery: 0:33 (complete)")
    } finally {
      await page.close()
    }
  })
  it.each(["light", "dark"] as const)(
    "keeps hovered and selected frozen cells consistent with the %s row theme",
    async theme => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      try {
        await fixture(page, true, theme)
        const row = page.locator("#inventory .tabulator-tableholder .tabulator-row").first()
        const frozen = row.locator(".tabulator-cell.tabulator-frozen")
        await frozen.hover({ timeout: 2000 })
        const background = await row.evaluate(element => getComputedStyle(element).backgroundColor)
        expect(await frozen.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(
          background
        )
        expect(background).toBe(theme === "dark" ? "rgb(17, 17, 17)" : "rgb(234, 245, 243)")
        expect(
          await page
            .locator("#inventory .tabulator-table")
            .evaluate(element => getComputedStyle(element).backgroundColor)
        ).toBe(theme === "dark" ? "rgb(17, 17, 17)" : "rgb(255, 255, 255)")
        await page.evaluate("table.selectRow(table.getData()[0].key)")
        expect(await frozen.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(
          await row.evaluate(element => getComputedStyle(element).backgroundColor)
        )
      } finally {
        await page.close()
      }
    }
  )
  it.each(["discovery", "st03n", "jobs", "dependencies"] as const)(
    "labels %s progress and bulk replaces its table only at the end",
    async stage => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      try {
        await fixture(page)
        const phase = {
          discovery: { activity: "Reading repository objects", unit: "packages" },
          st03n: { activity: "Matching ST03N extract: transactions.csv", unit: "files" },
          jobs: { activity: "Matching job programs and transactions", unit: "programs" },
          dependencies: { activity: "Checking object relations and where-used", unit: "checks" }
        }[stage]
        await page.evaluate(`
        globalThis.discoveryTableCalls = { replace: 0, incremental: 0 }
        const originalReplace = table.replaceData.bind(table)
        const originalIncremental = table.updateOrAddData.bind(table)
        table.replaceData = (...args) => {
          discoveryTableCalls.replace++
          return originalReplace(...args)
        }
        table.updateOrAddData = (...args) => {
          discoveryTableCalls.incremental++
          return originalIncremental(...args)
        }
      `)
        await deliver(page, {
          command: "update",
          analysis: {
            ...analysis,
            revision: 2,
            run: { stage, status: "running", completed: 1, total: 3, elapsedMs: 0, ...phase }
          }
        })
        await page.waitForFunction("analysis.revision === 2")
        expect(await page.locator("#counts").textContent()).toContain("300 total")
        expect(await page.evaluate("discoveryTableCalls")).toEqual({ replace: 0, incremental: 0 })
        expect(await page.locator("#runActivity").textContent()).toBe(phase.activity)
        expect(await page.locator("#progressCount").textContent()).toBe(`1 / 3 ${phase.unit}`)

        if (stage === "discovery") {
          await deliver(page, {
            command: "update",
            analysis: {
              ...analysis,
              revision: 3,
              run: {
                stage,
                status: "running",
                completed: 0,
                total: 2,
                elapsedMs: 0,
                activity: "Reading function modules: Z* (253 function groups)",
                unit: "prefix batches"
              }
            }
          })
          await page.waitForFunction("analysis.revision === 3")
          expect(await page.locator("#runActivity").textContent()).toBe(
            "Reading function modules: Z* (253 function groups)"
          )
          expect(await page.locator("#progressCount").textContent()).toBe("0 / 2 prefix batches")
          expect(await page.evaluate("discoveryTableCalls")).toEqual({ replace: 0, incremental: 0 })
        }

        await deliver(page, {
          command: "update",
          analysis: {
            ...analysis,
            revision: 4,
            run: { stage, status: "complete", completed: 3, total: 3, elapsedMs: 0, ...phase }
          },
          rows: inventory.slice(0, 100),
          replaceRows: true
        })
        await page.waitForFunction(() =>
          document.getElementById("counts")?.textContent?.includes("100 total")
        )
        expect(await page.evaluate("discoveryTableCalls")).toEqual({ replace: 1, incremental: 0 })
        expect(await page.evaluate("table.getDataCount()")).toBe(100)
        expect(await page.locator("#runStatus").textContent()).toBe(`${stage}: complete`)
      } finally {
        await page.close()
      }
    }
  )
  it("sends Pause immediately without waiting for or sending an autosave", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 2,
          run: { stage: "dependencies", status: "running", completed: 0, total: 3, elapsedMs: 0 }
        }
      })
      await page.waitForFunction("!document.getElementById('pause').disabled")
      await page.evaluate("hostMessages.length = 0")
      await page.locator("#pause").click()
      await page.waitForFunction("hostMessages.length > 0")
      expect(await page.evaluate("hostMessages.map(message => message.command)")).toEqual(["pause"])
      expect(await page.locator("#runStatus").textContent()).toBe("Pausing...")
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 3,
          run: { stage: "dependencies", status: "running", completed: 1, total: 3, elapsedMs: 0 }
        }
      })
      await page.waitForFunction("analysis.revision === 3")
      expect(await page.locator("#runStatus").textContent()).toBe("Pausing...")
      expect(await page.locator("#pause").isDisabled()).toBe(true)
    } finally {
      await page.close()
    }
  })
  it("autosaves fields to their analysis and never carries systems or stages into another analysis", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const first = {
        ...analysis,
        id: "first",
        connectionId: "",
        packages: [],
        dependencyConnectionId: "",
        discoveryDone: false,
        stages: {}
      }
      const second = { ...first, id: "second", name: "Second analysis" }
      const analyses = [
        { id: "first", name: "First analysis" },
        { id: "second", name: "Second analysis" }
      ]
      await deliver(page, {
        command: "state",
        analysis: first,
        analyses,
        systems: ["example"],
        rows: []
      })
      await page.locator("#connectionId").selectOption("example")
      await page.locator("#packages").fill("z*")
      await page.locator('[data-stage="st03n"]').click()
      await page.locator("#period").fill("First period")
      await page.locator("#newAnalysis").click()
      await page.waitForFunction("hostMessages.some(message => message.command === 'create')")
      const savedFirst = (await page.evaluate(
        "structuredClone(hostStates.first)"
      )) as typeof analysis
      expect(savedFirst.connectionId).toBe("example")
      expect(savedFirst.packages).toEqual(["Z*"])
      expect(savedFirst.periodLabel).toBe("First period")
      await deliver(page, {
        command: "state",
        analysis: second,
        analyses,
        systems: ["example"],
        rows: []
      })
      await page.waitForFunction("document.getElementById('analysisSelect').value === 'second'")
      expect(await page.locator("#connectionId").inputValue()).toBe("")
      expect(await page.locator("#packages").inputValue()).toBe("")
      expect(await page.locator("#stage-discovery").isVisible()).toBe(true)
      await deliver(page, {
        command: "state",
        analysis: savedFirst,
        analyses,
        systems: ["example"],
        rows: []
      })
      await page.waitForFunction("document.getElementById('analysisSelect').value === 'first'")
      expect(await page.locator("#connectionId").inputValue()).toBe("example")
      expect(await page.locator("#packages").inputValue()).toBe("Z*")
      expect(await page.locator("#period").inputValue()).toBe("First period")
      expect(await page.locator("#stage-st03n").isVisible()).toBe(true)
    } finally {
      await page.close()
    }
  })
  it("provides deletion on the home list, independent usage stages and a dependency prerequisite", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page, false)
      await deliver(page, {
        command: "state",
        analyses: [{ id: "example", name: "Example" }],
        systems: [],
        rows: []
      })
      await page.getByRole("button", { name: "Delete Example", exact: true }).click()
      await page.waitForFunction(
        "hostMessages.some(message => message.command === 'delete' && message.id === 'example')"
      )
      await deliver(page, {
        command: "state",
        analysis,
        analyses: [{ id: "example", name: "Example" }],
        systems: ["example"],
        rows: inventory
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("300 total")
      )
      expect(await page.locator('[data-run="st03n"]').isEnabled()).toBe(true)
      expect(await page.locator('[data-run="jobs"]').isEnabled()).toBe(true)
      expect(await page.locator('[data-run="dependencies"]').isDisabled()).toBe(true)
      await page.locator('[data-stage="dependencies"]').click()
      expect(await page.locator("#dependencyRequirement").isVisible()).toBe(true)
      await deliver(page, {
        command: "update",
        analysis: { ...analysis, revision: 2, canDependencies: true }
      })
      await page.waitForFunction("!document.querySelector('[data-run=dependencies]').disabled")
      expect(await page.locator("#dependencyRequirement").isVisible()).toBe(false)
    } finally {
      await page.close()
    }
  })
  it("shows each FM's group and keeps unclear siblings in the investigation view", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const rows = [
        {
          ...inventory[0],
          key: "R3TR:FUGR:ZGROUP",
          objectName: "ZGROUP",
          objectType: "FUGR",
          status: "used"
        },
        {
          ...inventory[1],
          key: "LIMU:FUNC:Z_FIRST",
          objectName: "Z_FIRST",
          objectType: "FUNC",
          functionGroup: "ZGROUP",
          status: "used"
        },
        {
          ...inventory[2],
          key: "LIMU:FUNC:Z_SECOND",
          objectName: "Z_SECOND",
          objectType: "FUNC",
          functionGroup: "ZGROUP",
          status: "unclear"
        }
      ]
      await deliver(page, {
        command: "state",
        analysis: { ...analysis, revision: 2 },
        analyses: [{ id: "example", name: "Example" }],
        systems: ["example"],
        rows
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("3 total")
      )
      expect(
        await page.evaluate("table.getRow('LIMU:FUNC:Z_FIRST').getCell('functionGroup').getValue()")
      ).toBe("ZGROUP")
      await page.locator("#view").selectOption("unclear")
      expect(await page.evaluate("table.getData('active').map(row => row.key)")).toEqual([
        "LIMU:FUNC:Z_SECOND"
      ])
    } finally {
      await page.close()
    }
  })
  it("shows visible labels for guides, templates and other actions without requiring hover", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      expect(
        (await page.locator("[data-guide]").allTextContents()).map(text => text.trim())
      ).toEqual(["Guide", "Guide", "Guide", "Guide"])
      expect(
        (await page.locator("[data-template]").allTextContents()).map(text => text.trim())
      ).toEqual(Array(7).fill("Download template"))
      for (const [selector, label] of [
        ["#restartDiscovery", "Reset"],
        ["#pause", "Pause"],
        ["#export", "Export"],
        ["#clearFilters", "Clear filters"],
        ["#deleteAnalysis", "Delete analysis"]
      ]) {
        expect((await page.locator(selector).textContent())?.trim()).toBe(label)
      }
      await page.locator('[data-stage="st03n"]').click()
      await page.locator('[data-guide="st03n"]').click()
      await page.locator('[data-template="transaction"]').click()
      expect(
        await page.evaluate(
          "hostMessages.some(message => message.command === 'guide' && message.stage === 'st03n')"
        )
      ).toBe(true)
      expect(
        await page.evaluate(
          "hostMessages.some(message => message.command === 'template' && message.kind === 'transaction')"
        )
      ).toBe(true)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
          await page.locator("#stage-st03n [data-template]").evaluateAll(buttons =>
            buttons.every(button => {
              const bounds = button.getBoundingClientRect()
              const parent = button.parentElement!.getBoundingClientRect()
              return (
                bounds.left >= parent.left &&
                bounds.right <= parent.right + 1 &&
                button.scrollWidth <= button.clientWidth
              )
            })
          )
        ).toBe(true)
        await page.screenshot({
          path: path.join(os.tmpdir(), `repository-usage-labels-${width}.png`),
          fullPage: true
        })
      }
    } finally {
      await page.close()
    }
  })
  it("distinguishes existing same-name analyses without changing their saved names", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page, false)
      const analyses = [
        { id: "first-analysis", name: "Duplicate" },
        { id: "second-analysis", name: "Duplicate" }
      ]
      await deliver(page, { command: "state", analyses, rows: [], systems: [] })
      await page.getByRole("button", { name: "Duplicate (first-an)", exact: true }).waitFor()
      expect(
        await page.getByRole("button", { name: "Duplicate (second-a)", exact: true }).isVisible()
      ).toBe(true)
      await deliver(page, {
        command: "state",
        analysis: { ...analysis, id: "first-analysis", name: "Duplicate" },
        analyses,
        rows: inventory,
        systems: ["example"]
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("300 total")
      )
      expect(await page.locator("#analysisSelect option").allTextContents()).toEqual([
        "Duplicate (first-an)",
        "Duplicate (second-a)"
      ])
      expect(await page.locator("#analysisName").textContent()).toBe("Duplicate")
    } finally {
      await page.close()
    }
  })
  it("shows a chooser before an analysis exists and opens named saved analyses explicitly", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page, false)
      expect(await page.locator(".workspace").isVisible()).toBe(false)
      await deliver(page, { command: "state", analyses: [], rows: [], systems: [] })
      expect(
        await page.getByRole("button", { name: "Create analysis", exact: true }).isVisible()
      ).toBe(true)
      expect(await page.locator("#analysisSelect").isVisible()).toBe(false)
      await deliver(page, {
        command: "state",
        analyses: [{ id: "example", name: "Quarterly review" }],
        rows: [],
        systems: ["example"]
      })
      await page.getByRole("button", { name: "Quarterly review", exact: true }).click()
      expect(
        await page.evaluate(
          "hostMessages.some(message => message.command === 'select' && message.id === 'example')"
        )
      ).toBe(true)
      await deliver(page, {
        command: "state",
        analysis,
        analyses: [{ id: "example", name: "Example" }],
        systems: ["example"],
        rows: inventory
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("300 total")
      )
      expect(await page.locator("#analysisHome").isVisible()).toBe(false)
      expect(await page.getByLabel("Saved analysis", { exact: true }).isVisible()).toBe(true)
      await page.getByRole("button", { name: "2. ST03N", exact: true }).click()
      expect(await page.getByLabel("Period label (optional)", { exact: true }).isVisible()).toBe(
        true
      )
      expect(await page.locator("#period").getAttribute("title")).toContain("does not filter")
    } finally {
      await page.close()
    }
  })
  it("shows starting feedback before the host responds and recovers after cancellation", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.locator('[data-run="discover"]').click()
      expect(await page.locator("#runStatus").textContent()).toBe("Starting...")
      expect(await page.locator('[data-run="discover"]').isDisabled()).toBe(true)
      await deliver(page, { command: "idle" })
      await page.waitForFunction(
        () => !(document.querySelector('[data-run="discover"]') as HTMLButtonElement).disabled
      )
    } finally {
      await page.close()
    }
  })
  it("keeps the mounted table, filters and counts across row updates and reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.locator("#view").selectOption("unclear")
      await page.evaluate("table.__testIdentity = 'mounted'")
      await deliver(page, {
        command: "update",
        analysis: { ...analysis, revision: 2 },
        rows: [{ ...inventory[0], status: "used", reasons: ["ST03N"] }]
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("1 used")
      )
      expect(await page.evaluate("table.__testIdentity")).toBe("mounted")
      expect(await page.locator("#visibleCount").textContent()).toContain("299")
      await page.reload()
      await deliver(page, {
        command: "state",
        analysis: { ...analysis, revision: 2 },
        analyses: [{ id: "example", name: "Example" }],
        systems: ["example"],
        rows: inventory
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("300 total")
      )
      expect(await page.locator("#view").inputValue()).toBe("unclear")
    } finally {
      await page.close()
    }
  })
  it("updates the filtered count when header filters are applied changed and cleared", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      const filter = page.locator(
        '#inventory .tabulator-col[tabulator-field="objectName"] .tabulator-header-filter input'
      )
      const waitForCount = (expected: number) =>
        page.waitForFunction(
          count =>
            document.getElementById("visibleCount")?.textContent === `Showing ${count} of 300`,
          expected
        )
      await filter.fill("Z00")
      await filter.press("End")
      await waitForCount(100)
      expect(await page.locator("#visibleCount").textContent()).toBe("Showing 100 of 300")
      await filter.fill("Z001")
      await filter.press("End")
      await waitForCount(10)
      expect(await page.locator("#visibleCount").textContent()).toBe("Showing 10 of 300")
      await deliver(page, {
        command: "update",
        analysis: {
          ...analysis,
          revision: 2,
          run: { stage: "jobs", status: "running", completed: 0, elapsedMs: 0 }
        }
      })
      await page.waitForFunction(
        () => document.getElementById("runStatus")?.textContent === "jobs: running"
      )
      expect(await page.locator("#visibleCount").textContent()).toBe("Showing 10 of 300")
      await filter.fill("")
      await filter.press("End")
      await waitForCount(300)
      expect(await page.locator("#visibleCount").textContent()).toBe("Showing 300 of 300")
    } finally {
      await page.close()
    }
  })
  it("preserves scroll position and ignores stale revisions", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await fixture(page)
      await page.locator("#inventory .tabulator-tableholder").evaluate(element => {
        element.scrollTop = 1000
      })
      const before = await page
        .locator("#inventory .tabulator-tableholder")
        .evaluate(element => element.scrollTop)
      await deliver(page, {
        command: "update",
        analysis: { ...analysis, revision: 3 },
        rows: [{ ...inventory[299], status: "used" }]
      })
      await page.waitForFunction(() =>
        document.getElementById("counts")?.textContent?.includes("1 used")
      )
      expect(
        await page
          .locator("#inventory .tabulator-tableholder")
          .evaluate(element => element.scrollTop)
      ).toBe(before)
      await deliver(page, {
        command: "update",
        analysis: { ...analysis, revision: 2 },
        rows: [{ ...inventory[299], status: "unclear" }]
      })
      expect(await page.locator("#counts").textContent()).toContain("1 used")
      await page.screenshot({
        path: path.join(os.tmpdir(), "repository-usage-desktop.png"),
        fullPage: true
      })
      await page.setViewportSize({ width: 700, height: 900 })
      await page.waitForFunction(
        () => document.getElementById("inventory")!.getBoundingClientRect().height < 600
      )
      await page.screenshot({
        path: path.join(os.tmpdir(), "repository-usage-narrow.png"),
        fullPage: true
      })
      expect(await page.locator("#inventory").isVisible()).toBe(true)
    } finally {
      await page.close()
    }
  })
})
