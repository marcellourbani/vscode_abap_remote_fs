import { execFileSync } from "child_process"
import { log, caughtToString } from "../../lib"

// Historically this read the registry via the separate "murbani.winregistry" extension,
// which wrapped the native vscode-windows-registry module. That module ships x64-only
// binaries, so it breaks on ARM64 Windows (#483) and can fail to load even on x64 when
// its ABI drifts from the current Node/Electron version (#479).
// Shelling out to reg.exe avoids native binaries entirely: it's part of Windows itself,
// so the OS always provides a build that matches the host architecture.

const REG_SZ_LINE = /^\s*\S+\s+REG_SZ\s+(.*)$/

export function readWindowsRegistryString(
  hive: string,
  key: string,
  valueName: string
): string | undefined {
  const regPath = `${hive}\\${key}`
  try {
    const output = execFileSync("reg", ["query", regPath, "/v", valueName], {
      encoding: "utf8",
      windowsHide: true
    })
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim().startsWith(valueName)) continue
      const match = line.match(REG_SZ_LINE)
      if (match) {
        log.debug(`readWindowsRegistryString: found ${regPath}\\${valueName}`)
        return match[1].trim()
      }
    }
    log.debug(
      `readWindowsRegistryString: reg query succeeded but ${valueName} was not found in the output for ${regPath}`
    )
    return undefined
  } catch (error) {
    log.debug(
      `readWindowsRegistryString: reg query failed for ${regPath}\\${valueName}: ${caughtToString(error)}`
    )
    return undefined
  }
}
