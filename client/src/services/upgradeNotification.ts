/**
 * One-time upgrade notification + blinking status bar for new users.
 */

import * as vscode from "vscode"

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs"

const STATE_LAST_VERSION = "abapfs.lastVersion"
const STATE_UPGRADE_DISMISSED = "abapfs.upgradeStatusBarDismissed"

export function checkUpgradeNotification(context: vscode.ExtensionContext): void {
  const currentVersion: string = context.extension.packageJSON.version ?? "0.0.0"
  const lastVersion = context.globalState.get<string>(STATE_LAST_VERSION)

  // Always update stored version
  context.globalState.update(STATE_LAST_VERSION, currentVersion)

  // Trigger for users upgrading from v1.
  // v1 never stored this key, so undefined means they had v1 (or it's a fresh install).
  // We skip if they already have a v2 version stored (meaning they've run v2 before).
  const isUpgradeFromV1 = lastVersion === undefined || lastVersion.startsWith("1.")

  if (!isUpgradeFromV1) return

  // 1) One-time notification
  showUpgradeNotification()

  // 2) Blinking status bar (unless already dismissed or expired)
  showBlinkingStatusBar(context)
}

// ─── Notification ────────────────────────────────────────────────────────────

function showUpgradeNotification(): void {
  vscode.window
    .showInformationMessage(
      "🚀 ABAP Remote FS has been upgraded to v2 with powerful AI features! " +
        "Simply ask GitHub Copilot (in Agent mode) to tell you about them.",
      "Open Marketplace Page"
    )
    .then(action => {
      if (action === "Open Marketplace Page") {
        vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
      }
    })
}

// ─── Blinking Status Bar ─────────────────────────────────────────────────────

function showBlinkingStatusBar(context: vscode.ExtensionContext): void {
  // Already dismissed by click?
  if (context.globalState.get<boolean>(STATE_UPGRADE_DISMISSED)) return

  // Create status bar item
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000)
  item.command = "abapfs.openUpgradeMarketplace"
  item.tooltip = "ABAP Remote FS v2 — Click to learn about new AI features or just ask Copilot!"
  context.subscriptions.push(item)

  // Blink between two states
  const textOn = "$(rocket) ABAP FS v2 — New AI Features!"
  const textOff = "$(sparkle) ABAP FS v2 — New AI Features!"
  let on = true

  item.text = textOn
  item.show()

  const blinkInterval = setInterval(() => {
    on = !on
    item.text = on ? textOn : textOff
  }, 1500)

  // Command: open marketplace + dismiss permanently
  const cmd = vscode.commands.registerCommand("abapfs.openUpgradeMarketplace", () => {
    vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
    context.globalState.update(STATE_UPGRADE_DISMISSED, true)
    clearInterval(blinkInterval)
    item.dispose()
  })
  context.subscriptions.push(cmd)
}
