import { chmodSync } from "node:fs"
import { arch, platform } from "node:os"
import { fileURLToPath } from "node:url"
import notifier from "node-notifier"
import * as vscode from "vscode"

export function showNativeNotification(
  message: string,
  severity: "Information" | "Warning" | "Error"
): void {
  if (
    !vscode.workspace.getConfiguration("abapfs").get("nativeNotifications", false) ||
    vscode.window.state.focused ||
    vscode.env.remoteName
  ) {
    return
  }

  try {
    const nativeNotifier = createNotifier()
    nativeNotifier.notify({ title: `ABAP FS - ${severity}`, message }, error => {
      if (error) console.warn("ABAP FS: OS notification could not be delivered", error)
    })
  } catch (error) {
    console.warn("ABAP FS: OS notification could not be delivered", error)
  }
}

function createNotifier() {
  if (platform() === "win32") {
    const suffix = arch() === "x64" ? "64" : "86"
    return new notifier.WindowsToaster({
      customPath: fileURLToPath(
        new URL(`./vendor/node-notifier/snoreToast/snoretoast-x${suffix}.exe`, import.meta.url)
      )
    })
  }
  if (platform() === "darwin") {
    const customPath = fileURLToPath(
      new URL(
        "./vendor/node-notifier/mac.noindex/terminal-notifier.app/Contents/MacOS/terminal-notifier",
        import.meta.url
      )
    )
    // VSIX files built on Windows can lose Unix executable permissions.
    chmodSync(customPath, 0o755)
    return new notifier.NotificationCenter({ customPath })
  }
  return new notifier.NotifySend()
}
