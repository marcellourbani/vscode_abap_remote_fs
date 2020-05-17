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

const removeSpaces = (name: string, source: string) => {
  const f = parse(name, source)
  const lines: string[] = []
  const line = { row: -1, end: -1, col: 0, text: "" }
  for (const t of f.getTokens()) {
    const row = t.getRow()
    const col = t.getCol()
    const str = t.getStr()
    const endcol = t.getEnd().getCol()
    if (line.row !== row) {
      if (line.row !== -1) lines.push(line.text)
      line.text = `${" ".repeat(col)}${str}`
      line.col = endcol
      line.row = row
    } else {
      if (str === ".") line.text = `${line.text}.`
      if (col - line.col) line.text = `${line.text} ${str}`
      else line.text = `${line.text} ${str}`
      line.col = endcol
    }
  }
  if (line.text && line.row > 0) lines.push(line.text)

  return lines.join("\n")
}

export function prettyPrint(path: string, source: string) {
  const name = path.replace(/.*\//, "")
  // const unspaced = removeSpaces(name, source)
  const f = parse(name, source)
  const pp = new PrettyPrinter(f, getConfig())
  const result = pp.run()
  if (source && !result)
    throw new Error(`Abaplint formatting failed for ${path}`)
  return result
}
