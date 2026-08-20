import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { logTelemetry } from "../telemetry"
import { getConfig } from "../../config"

export interface IConfiguredSystemsParameters {
  connectionId?: string
}

type ConfigSchema = {
  default?: unknown
  properties?: Record<string, ConfigSchema>
  patternProperties?: Record<string, ConfigSchema>
}

type ConfigurationInspection = {
  defaultValue?: unknown
  globalValue?: unknown
}

type SystemDefinition = {
  name: string
  paths: Set<string>
}

const REDACTED_SETTINGS = ["url", "username", "password", "oauth.clientSecret"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRedactedSetting(path: string): boolean {
  return REDACTED_SETTINGS.some(setting => setting.toLowerCase() === path.toLowerCase())
}

function collectPaths(value: unknown, path: string, output: Set<string>): void {
  if (isRedactedSetting(path)) return
  if (!isRecord(value) || Object.keys(value).length === 0) {
    if (path) output.add(path)
    return
  }

  for (const [key, child] of Object.entries(value)) {
    collectPaths(child, path ? `${path}.${key}` : key, output)
  }
}

function getRemoteSchema(packageJSON: unknown): ConfigSchema | undefined {
  if (!isRecord(packageJSON)) return
  const contributes = packageJSON.contributes
  if (!isRecord(contributes)) return
  const configuration = contributes.configuration
  const properties = Array.isArray(configuration)
    ? configuration.reduce<Record<string, ConfigSchema>>(
        (all, contribution) =>
          isRecord(contribution) && isRecord(contribution.properties)
            ? { ...all, ...(contribution.properties as Record<string, ConfigSchema>) }
            : all,
        {}
      )
    : isRecord(configuration) && isRecord(configuration.properties)
      ? (configuration.properties as Record<string, ConfigSchema>)
      : undefined
  const remoteSchema = properties?.["abapfs.remote"]
  const patternProperties = remoteSchema?.patternProperties
  return patternProperties ? Object.values(patternProperties)[0] : undefined
}

function collectSchemaPaths(
  schema: ConfigSchema | undefined,
  prefix = "",
  paths = new Set<string>()
) {
  if (!schema) return paths
  const properties = schema.properties
  if (!properties || Object.keys(properties).length === 0) {
    if (prefix) paths.add(prefix)
    return paths
  }

  for (const [key, child] of Object.entries(properties)) {
    collectSchemaPaths(child, prefix ? `${prefix}.${key}` : key, paths)
  }
  return paths
}

function getSystems(): { config: ReturnType<typeof getConfig>; systems: SystemDefinition[] } {
  const systems = new Map<string, SystemDefinition>()
  const config = getConfig()
  const remotes = config.inspect<Record<string, unknown>>("remote")?.globalValue
  if (isRecord(remotes)) {
    for (const [name, remote] of Object.entries(remotes)) {
      const system = { name, paths: new Set<string>() }
      collectPaths(remote, "", system.paths)
      systems.set(name.toLowerCase(), system)
    }
  }
  return { config, systems: Array.from(systems.values()) }
}

function configuredSystems(packageJSON: unknown, connectionId?: string) {
  const { config, systems } = getSystems()
  const selectedSystem = connectionId
    ? systems.find(system => system.name.toLowerCase() === connectionId.toLowerCase())
    : undefined
  if (connectionId && !selectedSystem) {
    throw new Error(`No configured SAP system found for connectionId "${connectionId}"`)
  }
  if (!selectedSystem) {
    return {
      connectionIds: systems.map(system => system.name),
      settingsSource: "global"
    }
  }

  const schema = getRemoteSchema(packageJSON)
  const schemaPaths = collectSchemaPaths(schema)
  const settings: Record<string, unknown> = {}
  const defaults: Record<string, unknown> = {}
  const paths = new Set([...schemaPaths, ...selectedSystem.paths])

  for (const path of paths) {
    if (isRedactedSetting(path)) continue
    const settingKey = `remote.${selectedSystem.name}.${path}`
    const settingInspection = config.inspect<unknown>(settingKey) as
      | ConfigurationInspection
      | undefined
    const isConfigured = settingInspection?.globalValue !== undefined
    const value = isConfigured ? settingInspection.globalValue : getSchemaValue(schema, path)
    if (value === undefined) continue

    assignPath(isConfigured ? settings : defaults, path, value)
  }

  return {
    connectionId: selectedSystem.name,
    settingsSource: "global",
    defaultsSource: "package.json",
    settings,
    defaults
  }
}

function assignPath(output: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".")
  const leaf = keys.pop()
  if (!leaf) return
  const target = keys.reduce<Record<string, unknown>>((parent, key) => {
    const child = (parent[key] as Record<string, unknown> | undefined) || {}
    parent[key] = child
    return child
  }, output)
  target[leaf] = value
}

function getSchemaValue(schema: ConfigSchema | undefined, path: string): unknown {
  let current: ConfigSchema | undefined = schema
  for (const key of path.split(".")) current = current?.properties?.[key]
  return current && Object.prototype.hasOwnProperty.call(current, "default")
    ? current.default
    : undefined
}

export class ConfiguredSystemsTool implements vscode.LanguageModelTool<IConfiguredSystemsParameters> {
  constructor(private readonly packageJSON?: unknown) {}

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IConfiguredSystemsParameters>,
    _token: vscode.CancellationToken
  ) {
    return { invocationMessage: "Getting configured SAP system settings..." }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IConfiguredSystemsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_configured_systems_called")
    try {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              ...configuredSystems(this.packageJSON, options.input?.connectionId)
            },
            null,
            2
          )
        )
      ])
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to get configured systems: ${errorMsg}`)
    }
  }
}

export function registerConfiguredSystemsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry(
      "get_configured_systems",
      new ConfiguredSystemsTool(context.extension.packageJSON)
    )
  )
}
