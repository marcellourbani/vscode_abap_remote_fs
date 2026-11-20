import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { requireCustomizingBackend } from "../customizing/engine"
import { handleImgSearch } from "../customizing/discovery"
import { handleCustomizingDescribe, handleCustomizingRead } from "../customizing/inspection"
import { handleCustomizingDiff, handleCustomizingPlanChange } from "../customizing/comparison"
import {
  mutateConfiguration,
  configurationStatus,
  type ChangeInput
} from "../customizing/mutations"
import { checkInstallation } from "../customizing/setup"

// Only implementation routing belongs here. AI-facing schemas, descriptions and tags
// live in package.json; the existing LM/MCP infrastructure publishes them.
function handler<T>(run: (input: T) => Promise<unknown>) {
  return (input: unknown) => run(input as T)
}
const setupGuidance = {
  ready:
    "SAP Customizing tools are ready for this system. No setup action is needed; checks are system-specific.",
  required:
    "SAP Customizing tools are not ready on this system. This is not a full system inventory; an unavailable service alone does not prove setup is missing. Ask the user to check ABAP FS > Customizing Setup for this SAP connection. Setup is user-handled and system-specific.",
  failed:
    "The readiness check could not complete. Verify the selected SAP connection and access, or ask the user to check ABAP FS > Customizing Setup. A connection error alone does not prove setup is missing."
}
async function checkSetup(input: { connectionId: string }) {
  try {
    const installation = await checkInstallation(input.connectionId)
    return {
      ...installation,
      guidance: installation.ready ? setupGuidance.ready : setupGuidance.required
    }
  } catch (error) {
    return {
      checked: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
      guidance: setupGuidance.failed
    }
  }
}
const handlers = {
  search_img: handler(handleImgSearch),
  describe_customizing: handler(handleCustomizingDescribe),
  read_customizing: handler(handleCustomizingRead),
  diff_customizing: handler(handleCustomizingDiff),
  plan_customizing_change: handler(handleCustomizingPlanChange),
  apply_customizing: handler((input: ChangeInput) => mutateConfiguration("write", input)),
  create_customizing: handler((input: ChangeInput) => mutateConfiguration("create", input)),
  delete_customizing: handler((input: ChangeInput) => mutateConfiguration("delete", input)),
  get_customizing_status: handler((input: { connectionId: string; runId: string }) =>
    configurationStatus(input.connectionId, input.runId)
  ),
  check_customizing_setup: handler(checkSetup)
}
const invocationMessages: Record<keyof typeof handlers, string> = {
  search_img: "Searching SAP IMG activities",
  describe_customizing: "Inspecting SAP Customizing object",
  read_customizing: "Reading SAP configuration",
  diff_customizing: "Comparing SAP configuration",
  plan_customizing_change: "Planning SAP configuration change",
  apply_customizing: "Applying SAP configuration change",
  create_customizing: "Creating SAP configuration entries",
  delete_customizing: "Deleting SAP configuration entries",
  get_customizing_status: "Checking SAP Customizing run status",
  check_customizing_setup: "Checking SAP Customizing setup"
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result
  if (result === null || typeof result !== "object") return String(result)
  if (Array.isArray(result)) return JSON.stringify(result, null, 2)

  const value = result as Record<string, unknown>
  if (Object.keys(value).length === 1 && Array.isArray(value.content) && value.content.length > 0) {
    const text = value.content.filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        Object.keys(part).length === 2 &&
        part.type === "text" &&
        typeof part.text === "string"
    )
    if (text.length === value.content.length) return text.map(part => part.text).join("\n\n")
  }

  const formatted = { ...value }
  for (const [source, target] of [
    ["DATA_JSON", "DATA"],
    ["EXTRAS_JSON", "EXTRAS"]
  ]) {
    if (typeof value[source] !== "string" || Object.hasOwn(value, target)) continue
    try {
      formatted[target] = JSON.parse(value[source])
      delete formatted[source]
    } catch {
      continue
    }
  }
  return JSON.stringify(formatted, null, 2)
}

export async function invokeCustomizing(suffix: string, input: unknown, cancelled: () => boolean) {
  if (cancelled()) throw new vscode.CancellationError()
  if (!Object.hasOwn(handlers, suffix)) throw new Error(`Unknown Customizing tool: ${suffix}`)
  if (
    !input ||
    typeof input !== "object" ||
    !("connectionId" in input) ||
    typeof input.connectionId !== "string" ||
    !input.connectionId.trim()
  )
    throw new Error("connectionId is required. Choose an SAP connection explicitly.")
  if (suffix !== "check_customizing_setup") await requireCustomizingBackend(input.connectionId)
  if (cancelled()) throw new vscode.CancellationError()
  return handlers[suffix as keyof typeof handlers](input)
}

class CustomizingTool implements vscode.LanguageModelTool<unknown> {
  constructor(private readonly suffix: string) {}
  prepareInvocation() {
    return { invocationMessage: invocationMessages[this.suffix as keyof typeof handlers] }
  }
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<unknown>,
    token: vscode.CancellationToken
  ) {
    assertToolInvocationAuthorized(options)
    const result = await invokeCustomizing(
      this.suffix,
      options.input,
      () => token.isCancellationRequested
    )
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(formatToolResult(result))
    ])
  }
}

export function registerCustomizingTools(context: vscode.ExtensionContext) {
  for (const suffix of Object.keys(handlers))
    context.subscriptions.push(
      registerToolWithRegistry(`abapfs_${suffix}`, new CustomizingTool(suffix))
    )
}
