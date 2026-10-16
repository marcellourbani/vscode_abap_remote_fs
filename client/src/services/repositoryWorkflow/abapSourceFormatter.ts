import { Config, PrettyPrinter } from "@abaplint/core"
import { parseAbapFile } from "../../lib/functions"

export const REPOSITORY_ABAP_FORMAT_VERSION = "abaplint-upper-token-space-class-method-order-v8"

let config: Config | undefined

function repositoryFormatConfig(): Config {
  if (config) return config
  config = new Config(
    JSON.stringify({
      rules: {
        sequential_blank: {
          lines: 4
        },
        keyword_case: {
          style: "upper",
          ignoreExceptions: true,
          ignoreLowerClassImplmentationStatement: true,
          ignoreGlobalClassDefinition: false,
          ignoreGlobalInterface: false,
          ignoreFunctionModuleName: false
        }
      }
    })
  )
  return config
}

export function formatRepositoryAbap(fileName: string, source: string): string {
  const normalizedName = abapFileName(fileName)
  const parsed =
    parseAbapFile(normalizedName, source) ??
    parseAbapFile(`${normalizedName.replace(/\.abap$/i, "")}.prog.abap`, source)
  const formatted = parsed && new PrettyPrinter(parsed, repositoryFormatConfig()).run()
  if (source && !formatted) throw new Error(`ABAPLint formatting failed for ${fileName}`)
  return normalizeRepositoryAbapWhitespace(normalizedName, formatted || "")
}

function abapFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith(".abap") ? fileName : `${fileName}.prog.abap`
}

export function normalizeRepositoryAbapWhitespace(fileName: string, source: string): string {
  if (!source) return ""
  const parsed =
    parseAbapFile(fileName, source) ??
    parseAbapFile(`${fileName.replace(/\.abap$/i, "")}.prog.abap`, source)
  if (!parsed) throw new Error(`ABAPLint tokenization failed for ${fileName}`)

  let cursor = 0
  let normalized = ""
  for (const token of parsed.getTokens(true)) {
    let start = cursor
    while (start < source.length && /[ \t\r\n]/.test(source[start])) start++
    const tokenText = token.getStr()
    if (!source.startsWith(tokenText, start))
      throw new Error(`ABAPLint token coverage is inconsistent for ${fileName}`)
    normalized += normalizeWhitespaceGap(source.slice(cursor, start), fileName)
    normalized += tokenText
    cursor = start + tokenText.length
  }
  normalized += normalizeWhitespaceGap(source.slice(cursor), fileName)
  return normalized
}

function normalizeWhitespaceGap(gap: string, fileName: string): string {
  if (!/^[ \t\r\n]*$/.test(gap))
    throw new Error(`ABAPLint token coverage is incomplete for ${fileName}`)
  return gap.replace(/[ \t]+/g, " ")
}
