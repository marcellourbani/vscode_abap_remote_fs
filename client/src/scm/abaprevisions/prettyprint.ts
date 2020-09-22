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

function parse(name: string, abap: string): ABAPFile {
  const reg = new Registry().addFile(new MemoryFile(name, abap)).parse()
  const objects = [...reg.getObjects()].filter(ABAPObject.is)
  return objects[0]?.getABAPFiles()[0]
}

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
        const part = stringsornot[i]
        const c = stringsornot[i].indexOf('"')
        if (c >= 0) {
          // comment
          stringsornot[i] = part.substr(0, c).toLowerCase() + part.substr(c)
          break
        } else stringsornot[i] = part.toLowerCase()
      }
      return stringsornot.join("'")
    })
    .join("\n")
}

function abapLintPrettyPrint(path: string, source: string) {
  const name = path.replace(/.*\//, "")
  const f = parse(name, source)
  const pp = new PrettyPrinter(f, getConfig())
  const result = pp.run()
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