import {
  ABAPFile,
  Registry,
  MemoryFile,
  ABAPObject,
  PrettyPrinter,
  Config
} from "@abaplint/core"
import { Uri } from "vscode"
import { getClient } from "../../adt/conections"
import { RemoteManager } from "../../config"
import { parseAbapFile } from "../../lib"

let config: Config
function getConfig() {
  if (!config) {
    const rules = {
      sequential_blank: {
        lines: 4
      },
      keyword_case: {
        style: "lower",
        ignoreExceptions: true,
        ignoreLowerClassImplmentationStatement: true,
        ignoreGlobalClassDefinition: false,
        ignoreGlobalInterface: false,
        ignoreFunctionModuleName: false
      }
    }

    config = new Config(JSON.stringify({ rules }))
  }
  return config
}


export const normalizeAbap = (source: string): string => {
  return source
    .split(/\n/)
    .map(line => {
      if (line.match(/^\*|^(\s*")/)) return line // whole comment
      // comments and strings will be left alone, the rest will be converted to lower case
      const stringsornot = line.split(/'/)
      for (const i in stringsornot) {
        if (Number(i) % 2) continue // string, nothing to do
        const part = stringsornot[i] || ""
        const c = stringsornot[i]?.indexOf('"') || -1
        if (c >= 0) {
          // comment
          stringsornot[i] = part.substring(0, c).toLowerCase() + part.substring(c)
          break
        } else stringsornot[i] = part.toLowerCase()
      }
      return stringsornot.join("'")
    })
    .join("\n")
}

function abapLintPrettyPrint(path: string, source: string) {
  const name = path.replace(/.*\//, "")
  const f = parseAbapFile(name, source)
  const result = f && new PrettyPrinter(f, getConfig()).run()
  if (source && !result)
    throw new Error(`Abaplint formatting failed for ${path}`)
  return result
}
export function prettyPrint(uri: Uri, source: string) {
  const { diff_formatter } = RemoteManager.get().byId(uri.authority) || {}
  switch (diff_formatter) {
    case "Simple":
      return normalizeAbap(source)
    case "AbapLint":
      return abapLintPrettyPrint(uri.path, source)
    case "ADT formatter":
    default:
      const client = getClient(uri.authority)
      return client.prettyPrinter(source)
  }
}