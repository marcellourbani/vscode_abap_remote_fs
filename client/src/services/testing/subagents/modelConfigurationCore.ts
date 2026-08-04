import { SUBAGENT_REGISTRY } from "./registry"

export interface AvailableModel {
  id: string
  name: string
  vendor: string
  family: string
  version: string
}

export interface ModelValidation {
  missingAgentIds: string[]
  unavailable: Array<{ agentId: string; modelName: string }>
}

export interface FileChange {
  path: string
  previousContent: string
  nextContent: string
}

export function getFrontmatterModel(content: string): string | undefined {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return undefined
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex < 0) return undefined
  const modelLine = lines.slice(1, closingIndex).find(line => /^model\s*:/.test(line))
  const rawValue = modelLine?.replace(/^model\s*:\s*/, "").trim()
  if (!rawValue) return undefined
  if (rawValue.startsWith('"')) {
    try {
      const parsed = JSON.parse(rawValue)
      return typeof parsed === "string" ? parsed : undefined
    } catch {
      return undefined
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1).replace(/''/g, "'")
  }
  return rawValue
}

export function setFrontmatterModel(content: string, modelName: string): string {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") {
    throw new Error("Agent file does not start with YAML frontmatter.")
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex < 0) {
    throw new Error("Agent file has no closing YAML frontmatter delimiter.")
  }

  const modelLine = `model: ${JSON.stringify(modelName)}`
  const modelIndex = lines.findIndex(
    (line, index) => index > 0 && index < closingIndex && /^model\s*:/.test(line)
  )
  if (modelIndex >= 0) {
    lines[modelIndex] = modelLine
  } else {
    lines.splice(closingIndex, 0, modelLine)
  }
  return lines.join(lineEnding)
}

export function validateModelSelections(
  selections: Record<string, string>,
  availableModels: readonly AvailableModel[]
): ModelValidation {
  const availableNames = new Set(availableModels.map(model => model.name))
  const missingAgentIds: string[] = []
  const unavailable: Array<{ agentId: string; modelName: string }> = []

  for (const agent of SUBAGENT_REGISTRY) {
    const modelName = selections[agent.id]?.trim()
    if (!modelName) {
      missingAgentIds.push(agent.id)
    } else if (!availableNames.has(modelName)) {
      unavailable.push({ agentId: agent.id, modelName })
    }
  }
  return { missingAgentIds, unavailable }
}

export function modelSetsMatch(
  first: readonly AvailableModel[],
  second: readonly AvailableModel[]
): boolean {
  if (first.length !== second.length) return false
  const firstNames = first.map(model => model.name).sort()
  const secondNames = second.map(model => model.name).sort()
  return firstNames.every((name, index) => name === secondNames[index])
}

export async function writeChangesWithRollback(
  changes: readonly FileChange[],
  writeFile: (path: string, content: string) => Promise<void>
): Promise<void> {
  const attempted: FileChange[] = []
  try {
    for (const change of changes) {
      attempted.push(change)
      await writeFile(change.path, change.nextContent)
    }
  } catch (error) {
    await Promise.allSettled(
      attempted.map(change => writeFile(change.path, change.previousContent))
    )
    throw error
  }
}
