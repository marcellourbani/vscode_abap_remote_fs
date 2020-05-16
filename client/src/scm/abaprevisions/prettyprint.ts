import {
  ABAPFile,
  Registry,
  MemoryFile,
  ABAPObject,
  PrettyPrinter,
  Config
} from "@abaplint/core"

function parse(name: string, abap: string): ABAPFile {
  const reg = new Registry().addFile(new MemoryFile(name, abap)).parse()
  const objects = reg.getObjects().filter(ABAPObject.is)
  return objects[0]?.getABAPFiles()[0]
}

let config: Config
function getConfig() {
  if (!config) {
    const foo: any = {}
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

export function prettyPrint(path: string, source: string) {
  const name = path.replace(/.*\//, "")
  const f = parse(name, source)
  const result = new PrettyPrinter(f, getConfig()).run()
  if (source && !result)
    throw new Error(`Abaplint formatting failed for ${path}`)
  return result
}
