import * as vscode from "vscode"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import {
  type KeywordDocuVersion,
  getKeywordDocuRoute,
  getKeywordDocuTopic,
  searchKeywordDocu
} from "./abapKeywordDocu/keywordDocuAdt"
import { type DocuLink, type DocuPage, readDocuPage } from "./abapKeywordDocu/docuMarkdown"

export const ABAP_KEYWORD_DOCU_TOOL = "abapfs_get_abap_keyword_documentation"

export interface IAbapKeywordDocuParameters {
  connectionId: string
  keyword?: string
  topicId?: string
  language?: string
  version?: KeywordDocuVersion
  format?: "markdown" | "html"
  maxChars?: number
}

interface KeywordDocuRequest {
  connectionId: string
  keyword?: string
  topicId?: string
  language: string
  version: KeywordDocuVersion
  format: "markdown" | "html"
  maxChars: number
}

const DEFAULT_MAX_CHARS = 20000
const MIN_MAX_CHARS = 1000
const MAX_MAX_CHARS = 100000
const MAX_KEYWORD_LENGTH = 200
const MAX_HITS = 30
const MAX_LINKS = 40
const TOPIC_ID = /^[A-Z0-9_./-]{1,100}$/
const LANGUAGE = /^[A-Z]{1,2}$/
const VERSIONS: readonly string[] = ["X", "5"]
const FORMATS: readonly string[] = ["markdown", "html"]

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

function normalizeRequest(input: IAbapKeywordDocuParameters): KeywordDocuRequest {
  const connectionId = input.connectionId?.trim().toLowerCase()
  if (!connectionId) throw new Error("connectionId is required.")
  const keyword = input.keyword?.trim() || undefined
  const topicId = input.topicId?.trim().toUpperCase() || undefined
  if (!keyword && !topicId) throw new Error("Provide a keyword or topicId.")
  if (keyword && keyword.length > MAX_KEYWORD_LENGTH)
    throw new Error(`keyword must be at most ${MAX_KEYWORD_LENGTH} characters.`)
  if (topicId && !TOPIC_ID.test(topicId))
    throw new Error(
      `Invalid topicId "${topicId}". Use a topicId returned by a previous call of this tool.`
    )
  const language = (input.language?.trim() || "EN").toUpperCase()
  if (!LANGUAGE.test(language))
    throw new Error(`Invalid language "${language}". Use e.g. EN or DE.`)
  const version = input.version ?? "X"
  if (!VERSIONS.includes(version)) throw new Error(`version must be one of ${VERSIONS.join(", ")}.`)
  const format = input.format ?? "markdown"
  if (!FORMATS.includes(format)) throw new Error(`format must be one of ${FORMATS.join(", ")}.`)
  const requested = Math.floor(Number(input.maxChars ?? DEFAULT_MAX_CHARS))
  const maxChars = Number.isFinite(requested)
    ? Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, requested))
    : DEFAULT_MAX_CHARS
  return { connectionId, keyword, topicId, language, version, format, maxChars }
}

function truncate(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  const notice = "\n\n[Truncated. Call again with a larger maxChars to read more.]"
  return text.slice(0, maxChars - notice.length) + notice
}

function formatLinks(links: DocuLink[], legacy: boolean, keyword?: string) {
  if (!links.length) return ""
  const ordered = [...links.filter(link => link.parent), ...links.filter(link => !link.parent)]
  const nextCall = legacy
    ? `topicId and the original keyword${keyword ? ` (\"${keyword}\")` : ""}`
    : "topicId"
  const lines = ["", "", "---", `Related topics (call this tool with ${nextCall} to read one):`]
  for (const link of ordered.slice(0, MAX_LINKS))
    lines.push(`- ${link.topicId} | ${link.title}${link.parent ? " (parent)" : ""}`)
  if (ordered.length > MAX_LINKS)
    lines.push(`${ordered.length - MAX_LINKS} more related topics not shown.`)
  return lines.join("\n")
}

function formatPage(
  page: DocuPage,
  format: KeywordDocuRequest["format"],
  label: string,
  legacy: boolean,
  keyword?: string
) {
  if (page.kind === "empty") {
    const reply = page.message ? ` SAP returned: ${page.message}` : ""
    return `No ABAP keyword documentation found for ${label}.${reply}\nTry a more precise statement such as "READ TABLE itab", or a different term.`
  }
  if (format === "html") return `Cleaned HTML for ${label}:\n\n${page.html}`
  if (page.kind === "hits") {
    const { hits } = page
    const selectionInput = legacy ? "topicId and the same keyword" : "topicId"
    const lines = [
      `${label} matched ${hits.length} topics. No topic was fetched: call this tool again with ${selectionInput} for the topic you need.`
    ]
    let group: string | undefined
    for (const hit of hits.slice(0, MAX_HITS)) {
      if (hit.group && hit.group !== group) lines.push("", `${hit.group}:`)
      group = hit.group
      lines.push(`- ${hit.topicId} | ${hit.title}`)
    }
    if (hits.length > MAX_HITS)
      lines.push(
        "",
        `${hits.length - MAX_HITS} more topics not shown. Use a more specific keyword.`
      )
    return lines.join("\n")
  }
  const header = page.topicId ? `Topic ${page.topicId}\n\n` : ""
  const body = page.complete
    ? page.markdown
    : `The Markdown conversion may have lost content. Returning cleaned HTML instead.\n\n${page.html}`
  return `${header}${body}${formatLinks(page.links, legacy, keyword)}`
}

type DocuClient = ReturnType<typeof getClient>

async function fetchDocumentation(
  client: DocuClient,
  request: KeywordDocuRequest,
  route: Awaited<ReturnType<typeof getKeywordDocuRoute>>
) {
  if (!route) throw new Error("No supported ABAP keyword documentation route was found.")
  const { keyword, topicId, language, version, format } = request
  const html = topicId
    ? await getKeywordDocuTopic(client, route, topicId, language, version, keyword)
    : await searchKeywordDocu(client, route, keyword ?? "", language, version)
  const label = topicId ? `topic ${topicId}` : `Search "${keyword}"`
  return formatPage(readDocuPage(html, topicId), format, label, route.kind === "legacy", keyword)
}

async function readKeywordDocumentation(request: KeywordDocuRequest): Promise<string> {
  const { connectionId } = request
  let client: DocuClient
  try {
    client = getClient(connectionId)
  } catch (error) {
    return `Could not use SAP connection ${connectionId}: ${errorMessage(error)}`
  }
  let route: Awaited<ReturnType<typeof getKeywordDocuRoute>>
  try {
    route = await getKeywordDocuRoute(client)
  } catch (error) {
    return `Could not read ADT discovery on ${connectionId}: ${errorMessage(error)}. Keyword documentation support could not be checked.`
  }
  if (!route)
    return `No ABAP keyword documentation search route was found in ADT discovery for ${connectionId}.`
  try {
    return await fetchDocumentation(client, request, route)
  } catch (error) {
    return `The ABAP keyword documentation request on ${connectionId} failed: ${errorMessage(error)}`
  }
}

export class AbapKeywordDocuTool implements vscode.LanguageModelTool<IAbapKeywordDocuParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IAbapKeywordDocuParameters>,
    _token: vscode.CancellationToken
  ) {
    const { keyword, topicId } = options.input
    return {
      invocationMessage: topicId
        ? `Reading ABAP documentation topic ${topicId}`
        : `Searching ABAP keyword documentation for "${keyword ?? ""}"`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IAbapKeywordDocuParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const request = normalizeRequest(options.input)
    logTelemetry("tool_abap_keyword_documentation_called", { connectionId: request.connectionId })
    const text = truncate(await readKeywordDocumentation(request), request.maxChars)
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)])
  }
}

export function registerAbapKeywordDocuTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry(ABAP_KEYWORD_DOCU_TOOL, new AbapKeywordDocuTool())
  )
}
