/**
 * One-time upgrade notification + blinking status bar for new users.
 */

import * as vscode from "vscode"

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs"
const CHANGELOG_URL =
  "https://github.com/marcellourbani/vscode_abap_remote_fs/blob/master/CHANGELOG.md"

type UpgradeNotificationButton = {
  text: string
  url: string
}

const USE_REGULAR_UPGRADE_NOTIFICATION = true
const CUSTOM_UPGRADE_NOTIFICATION_MESSAGE =
  "ABAP FS can now help you test ABAP reports and transactions!"
const CUSTOM_UPGRADE_NOTIFICATION_BUTTON_1: UpgradeNotificationButton = {
  text: "Learn about SAP UI Testing",
  url: "https://marcellourbani.github.io/vscode_abap_remote_fs/sap-testing/"
}
const CUSTOM_UPGRADE_NOTIFICATION_BUTTON_2: UpgradeNotificationButton | undefined = undefined

const STATE_LAST_VERSION = "abapfs.lastVersion"
const STATE_UPGRADE_DISMISSED = "abapfs.upgradeStatusBarDismissed"
const STATE_STATUS_BAR_PENDING = "abapfs.upgradeStatusBarPending"

export function checkUpgradeNotification(context: vscode.ExtensionContext): void {
  const currentVersion: string = context.extension.packageJSON.version ?? "0.0.0"
  const lastVersion = context.globalState.get<string>(STATE_LAST_VERSION)

  // Always update stored version
  context.globalState.update(STATE_LAST_VERSION, currentVersion)

  // Trigger for users upgrading from v1.
  // v1 never stored this key, so undefined means they had v1 (or it's a fresh install).
  // We skip if they already have a v2 version stored (meaning they've run v2 before).
  const isUpgradeFromV1 = lastVersion === undefined || lastVersion.startsWith("1.")

  if (isUpgradeFromV1) {
    // Mark that we want to show the status bar — persists across reloads until dismissed
    context.globalState.update(STATE_STATUS_BAR_PENDING, true)
  } else if (lastVersion && lastVersion !== currentVersion) {
    // Regular version upgrade — show a simple notification
    showVersionUpgradeNotification(currentVersion)
  }

  // Show status bar if pending (covers both fresh upgrade and post-reload reactivation)
  if (context.globalState.get<boolean>(STATE_STATUS_BAR_PENDING)) {
    showBlinkingStatusBar(context)
  }
}

// ─── Blinking Status Bar ─────────────────────────────────────────────────────

function showVersionUpgradeNotification(version: string): void {
  const buttons = USE_REGULAR_UPGRADE_NOTIFICATION
    ? [{ text: "What's New", url: CHANGELOG_URL }]
    : [CUSTOM_UPGRADE_NOTIFICATION_BUTTON_1, CUSTOM_UPGRADE_NOTIFICATION_BUTTON_2].filter(
        (button): button is UpgradeNotificationButton => button !== undefined
      )
  const message = USE_REGULAR_UPGRADE_NOTIFICATION
    ? `ABAP Remote Filesystem has been updated to v${version}`
    : CUSTOM_UPGRADE_NOTIFICATION_MESSAGE

  vscode.window
    .showInformationMessage(message, ...buttons.map(button => button.text))
    .then(choice => {
      const selectedButton = buttons.find(button => button.text === choice)
      if (selectedButton) {
        vscode.env.openExternal(vscode.Uri.parse(selectedButton.url))
      }
    })
}

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
    context.globalState.update(STATE_STATUS_BAR_PENDING, false)
    clearInterval(blinkInterval)
    item.dispose()
  })
  context.subscriptions.push(cmd)
}
