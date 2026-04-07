/**
 * Review Prompt Service
 *
 * Prompts engaged users to rate the extension on the VS Code Marketplace.
 *
 * Conditions (both must be true):
 *   1. The user has invoked at least 100 tool/command actions (tracked via global state counter).
 *   2. At least 7 days have passed since the extension was first activated.
 *
 * Once both conditions are met, a 5-minute delay fires, then:
 *   - A notification with three buttons:
 *       "⭐ Rate Now"       → opens Marketplace review page
 *       "Remind Me Later"  → resets counter & date so the cycle restarts
 *       "Never Show Again" → permanently suppresses the prompt
 *   - A persistent status bar item linking to the Marketplace page
 *     (dismissed permanently once the user clicks it).
 */

import * as vscode from "vscode"

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs&ssr=false#review-details"

// ─── Global State Keys ───────────────────────────────────────────────────────

const STATE_USAGE_COUNT = "abapfs.reviewPrompt.usageCount"
const STATE_FIRST_ACTIVATION_DATE = "abapfs.reviewPrompt.firstActivationDate"
const STATE_NEVER_SHOW_AGAIN = "abapfs.reviewPrompt.neverShowAgain"
const STATE_STATUSBAR_DISMISSED = "abapfs.reviewPrompt.statusBarDismissed"

// ─── Thresholds ──────────────────────────────────────────────────────────────

const USAGE_THRESHOLD = 100
const DAYS_THRESHOLD = 7
const PROMPT_DELAY_MS = 5 * 60 * 1000 // 5 minutes

// ─── Module state ────────────────────────────────────────────────────────────

let extensionContext: vscode.ExtensionContext | undefined
let promptTimer: ReturnType<typeof setTimeout> | undefined
let promptShownThisSession = false
let statusBarCreated = false
let reviewStatusBarItem: vscode.StatusBarItem | undefined

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call once during extension activation to record first-use date and
 * schedule the review prompt check.
 */
export function initializeReviewPrompt(context: vscode.ExtensionContext): void {
  try {
    extensionContext = context

    // Record first activation date (only if not already stored)
    const storedDate = context.globalState.get<string>(STATE_FIRST_ACTIVATION_DATE)
    if (!storedDate) {
      context.globalState.update(STATE_FIRST_ACTIVATION_DATE, new Date().toISOString())
    }

    // Clean up timer on deactivation
    context.subscriptions.push(
      new vscode.Disposable(() => {
        if (promptTimer) {
          clearTimeout(promptTimer)
          promptTimer = undefined
        }
      })
    )

    // Check conditions right away (handles case where counter already passed threshold in previous session)
    evaluateAndSchedule()
  } catch (error) {
    // Review prompt is non-critical — never break extension activation
    console.error("Review prompt initialization failed:", error)
  }
}

/**
 * Call from logTelemetry() on every tool/command invocation to bump the counter.
 */
export function incrementReviewCounter(): void {
  try {
    if (!extensionContext) return

    const count = extensionContext.globalState.get<number>(STATE_USAGE_COUNT) ?? 0
    extensionContext.globalState.update(STATE_USAGE_COUNT, count + 1)

    // Re-evaluate every 10 invocations to avoid checking on every single call
    if ((count + 1) % 10 === 0) {
      evaluateAndSchedule()
    }
  } catch (error) {
    // Review prompt is non-critical — never break telemetry
    console.error("Review prompt counter increment failed:", error)
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function evaluateAndSchedule(): void {
  if (!extensionContext) return

  // Permanently dismissed?
  if (extensionContext.globalState.get<boolean>(STATE_NEVER_SHOW_AGAIN)) return

  // Already shown this session — don't nag again
  if (promptShownThisSession) return

  // Condition 1: usage count
  const count = extensionContext.globalState.get<number>(STATE_USAGE_COUNT) ?? 0
  if (count < USAGE_THRESHOLD) return

  // Condition 2: days since first activation
  const firstDate = extensionContext.globalState.get<string>(STATE_FIRST_ACTIVATION_DATE)
  if (!firstDate) return

  const daysSinceFirst = (Date.now() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceFirst < DAYS_THRESHOLD) return

  // Both conditions met — schedule prompt after delay (avoid duplicate timers)
  if (promptTimer) return
  promptTimer = setTimeout(() => {
    promptTimer = undefined
    showReviewPrompt()
  }, PROMPT_DELAY_MS)
}

function showReviewPrompt(): void {
  if (!extensionContext) return

  promptShownThisSession = true
  const ctx = extensionContext

  // ── Notification ───────────────────────────────────────────────────────────
  vscode.window
    .showInformationMessage(
      "You've been using ABAP Remote FS for a while now — thank you! " +
        "If it's been helpful, a quick rating on the Marketplace would mean a lot. ❤️",
      "⭐ Rate Now",
      "Remind Me Later",
      "Never Show Again"
    )
    .then(choice => {
      if (choice === "⭐ Rate Now") {
        vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
        ctx.globalState.update(STATE_NEVER_SHOW_AGAIN, true)
        ctx.globalState.update(STATE_STATUSBAR_DISMISSED, true)
        disposeReviewStatusBar()
      } else if (choice === "Never Show Again") {
        ctx.globalState.update(STATE_NEVER_SHOW_AGAIN, true)
        ctx.globalState.update(STATE_STATUSBAR_DISMISSED, true)
        disposeReviewStatusBar()
      } else {
        // "Remind Me Later" or dismissed (X) — reset tracking so the cycle restarts
        ctx.globalState.update(STATE_USAGE_COUNT, undefined)
        ctx.globalState.update(STATE_FIRST_ACTIVATION_DATE, undefined)
      }
    })

  // ── Status bar item (persistent until clicked) ─────────────────────────────
  if (!statusBarCreated && !ctx.globalState.get<boolean>(STATE_STATUSBAR_DISMISSED)) {
    statusBarCreated = true
    showReviewStatusBar(ctx)
  }
}

function disposeReviewStatusBar(): void {
  if (reviewStatusBarItem) {
    reviewStatusBarItem.dispose()
    reviewStatusBarItem = undefined
  }
  statusBarCreated = false
}

function showReviewStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 900)
  reviewStatusBarItem = item
  item.text = "$(star) Rate ABAP FS"
  item.tooltip = "Enjoying ABAP Remote FS? Click to rate on the Marketplace!"
  item.command = "abapfs.openReviewMarketplace"
  item.show()
  context.subscriptions.push(item)

  const cmd = vscode.commands.registerCommand("abapfs.openReviewMarketplace", () => {
    vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
    context.globalState.update(STATE_STATUSBAR_DISMISSED, true)
    disposeReviewStatusBar()
  })
  context.subscriptions.push(cmd)
}
