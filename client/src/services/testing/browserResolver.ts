/**
 * Resolve a Chromium-based browser executable to drive tests with — preferring the
 * user's already-installed Edge over downloading Playwright's own ~150-300MB
 * Chromium. Corporate Windows laptops almost always have Edge preinstalled, so this
 * is normally a zero-download path for the exact audience this project targets.
 *
 * Resolution order:
 *   1. `abapfs.testing.edgePath` setting, if the user set one explicitly — trusted as-is.
 *   2. Edge at its usual OS-specific install location, if it exists there.
 *   3. undefined — caller falls back to Playwright's own bundled Chromium (if
 *      installed; see README's "known gap" section).
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { getEdgePath } from "./config"

function candidatePathsForPlatform(): string[] {
  const platform = os.platform()
  if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] ?? "C:\\Program Files"
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"
    return [
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    ]
  }
  if (platform === "darwin") {
    return ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  }
  // linux
  return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p)
    return stat.isFile()
  } catch {
    return false
  }
}

export type BrowserResolution = {
  /** Absolute path to a usable Edge/Chromium binary, or undefined if none was found. */
  executablePath: string | undefined
  /** Set when abapfs.testing.edgePath was explicitly configured but doesn't point at a real file. */
  warning?: string
}

export async function resolveBrowserExecutable(): Promise<BrowserResolution> {
  const configured = getEdgePath()
  if (configured) {
    if (await fileExists(configured)) return { executablePath: configured }
    return {
      executablePath: undefined,
      warning: `abapfs.testing.edgePath is set to "${configured}", but no file exists there. Falling back to auto-detection.`
    }
  }
  for (const candidate of candidatePathsForPlatform()) {
    if (await fileExists(candidate)) return { executablePath: candidate }
  }
  return { executablePath: undefined }
}
