import { objectPath, session_types, type ADTClient } from "abap-adt-api"
import { isAbapFolder } from "abapfs"
import { getOrCreateRoot } from "../../adt/conections"
import { activateReferences } from "../../adt/operations/activation/adtActivationApi"
import { ensureConnected, objectName } from "./query"
import { callEngine } from "./engine"
import { loadPayload, ENGINE_VERSION, SAP_OBJECTS, sourceVersion } from "./payload"
import { buildSicfReport, SICF_REPORT } from "./sicfReport"
import { verifyInactiveSource } from "../inactiveSourceVerification"

async function installationObjectExists(
  client: ADTClient,
  object: { name: string; type: string }
): Promise<boolean> {
  const results = await client.searchObject(object.name, object.type, 100)
  const expectedType = object.type.split("/")[0]
  return results.some(
    result =>
      result["adtcore:name"].toUpperCase() === object.name.toUpperCase() &&
      result["adtcore:type"].split("/")[0] === expectedType
  )
}
/** Some SAP releases report a missing version even when the report itself is absent. */
async function readInstallationSource(
  client: ADTClient,
  path: string,
  version: "active" | "inactive"
) {
  try {
    return await client.getObjectSource(`${path}/source/main`, { version })
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/does not have any (?:in)?active version\.?$/i.test(error.message)
    )
      throw error
    // A forbidden/unreachable resource must never be treated as permission to create it.
    await client.objectStructure(path)
    if (version === "inactive")
      return client.getObjectSource(`${path}/source/main`, { version: "active" })
    throw error
  }
}

export interface ObjectStatus {
  name: string
  status: "current" | "outdated" | "unversioned" | "missing" | "error"
  version?: string
  error?: string
  detail?: string
}
export interface ServiceStatus {
  path: string
  reachable: boolean
  expectedVersion: string
  version?: string
  error?: string
  detail?: string
}
export interface SetupStatus {
  version: string
  objects: ObjectStatus[]
  services: ServiceStatus[]
  ready: boolean
}
export type SetupProgress = (message: string) => void
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function checkInstallation(
  connectionId: string,
  knownServices: ServiceStatus[] = []
): Promise<SetupStatus> {
  const client = await ensureConnected(connectionId)
  const objects: ObjectStatus[] = []
  for (const object of SAP_OBJECTS) {
    try {
      if (!(await installationObjectExists(client, object))) {
        objects.push({
          name: object.name,
          status: "missing",
          error: `${object.type === "CLAS/OC" ? "ABAP class" : "ABAP report"} is not installed in this SAP system. Deploy the objects or import the abapGit ZIP.`
        })
        continue
      }
      const source = await readInstallationSource(client, object.path, "active")
      const version = sourceVersion(source)
      objects.push({
        name: object.name,
        version,
        status: !version ? "unversioned" : version === ENGINE_VERSION ? "current" : "outdated"
      })
    } catch (error) {
      objects.push({
        name: object.name,
        status: "error",
        error:
          "Could not check this ABAP object. Check connection, authorizations, and whether the object is activated.",
        detail: message(error)
      })
    }
  }
  const services: ServiceStatus[] = []
  for (const object of SAP_OBJECTS) {
    if (!object.service) continue
    const known = knownServices.find(service => service.path === object.service)
    if (known) {
      services.push(known)
      continue
    }
    try {
      const result = await callEngine(connectionId, { operation: "ping" }, object.service)
      services.push({
        path: object.service,
        reachable: result.STATUS === "ok",
        expectedVersion: ENGINE_VERSION,
        version: result.VERSION,
        error: result.STATUS === "ok" ? undefined : (result.MESSAGES ?? []).join("; ")
      })
    } catch (error) {
      services.push({
        path: object.service,
        reachable: false,
        expectedVersion: ENGINE_VERSION,
        error:
          "SICF service is unavailable. Check that it exists, is active (including its parents), and permits authenticated access. Use Configure SICF services or the manual guide.",
        detail: message(error)
      })
    }
  }
  return {
    version: ENGINE_VERSION,
    objects,
    services,
    ready:
      objects.every(object => object.status === "current") &&
      services.every(service => service.reachable && service.version === ENGINE_VERSION)
  }
}

function installationIssues(status: SetupStatus): string[] {
  const objectIssues = status.objects.flatMap(object => {
    switch (object.status) {
      case "current":
        return []
      case "outdated":
        return [
          `${object.name}: outdated (${object.version ?? "version unknown"}; expected ${ENGINE_VERSION}). Deploy backend objects.`
        ]
      case "missing":
        return [`${object.name}: not installed. Deploy backend objects or import the abapGit ZIP.`]
      case "unversioned":
        return [`${object.name}: version marker not found. Review the object before updating it.`]
      case "error":
        return [
          `${object.name}: unable to check. ${object.error ?? "Check source and authorization."}`
        ]
    }
  })
  const serviceIssues = status.services.flatMap(service => {
    if (!service.reachable)
      return [
        `${service.path}: unavailable. ${service.error ?? "Check SICF activation and access."}`
      ]
    if (service.version !== service.expectedVersion)
      return [
        `${service.path}: ${service.version ? `outdated (${service.version})` : "version not reported"}; expected ${service.expectedVersion}. Deploy backend objects.`
      ]
    return []
  })
  return [...objectIssues, ...serviceIssues]
}

export interface DeploymentInput {
  connectionId: string
  packageName: string
  transport?: string
}
export function validateDeployment(input: DeploymentInput) {
  if (!input.connectionId?.trim()) throw new Error("Choose an SAP connection")
  const rawPackageName = input.packageName.trim().toUpperCase()
  const localPackage = rawPackageName.startsWith("$")
  const packageName = localPackage ? rawPackageName : objectName(rawPackageName)
  if (packageName.length > 120 || (localPackage && !/^\$[A-Z0-9_]+$/.test(packageName)))
    throw new Error("Invalid SAP package name")
  const transport = input.transport?.trim().toUpperCase()
  if (localPackage && transport) throw new Error("Leave transport blank for a local package")
  if (!localPackage && !transport)
    throw new Error("A Workbench request is required for a transportable package")
  if (transport && !/^[A-Z0-9]{1,20}$/.test(transport)) throw new Error("Invalid transport request")
  return { ...input, packageName, transport }
}

const deployments = new Set<string>()
const SERVICE_POLL_INTERVAL_MS = 5_000
const SERVICE_POLL_TIMEOUT_MS = 120_000
async function refreshInstallationPackage(connectionId: string, packageName: string) {
  const root = await getOrCreateRoot(connectionId)
  const node =
    packageName === "$TMP"
      ? await root.getNodeAsync("/$TMP")
      : (await root.findByAdtUri(objectPath("DEVC/K", packageName)))?.file
  if (
    !node ||
    !isAbapFolder(node) ||
    node.object.type !== "DEVC/K" ||
    node.object.name.toUpperCase() !== packageName.toUpperCase()
  )
    throw new Error(`Could not resolve package ${packageName} in the ABAP FS tree`)
  await node.refresh()
}

function useStatefulSession(client: ADTClient) {
  const previousState = client.stateful
  client.stateful = session_types.stateful
  return () => {
    client.stateful = previousState
  }
}
/** Serialize the installation, never activate unrelated inactive objects or overwrite foreign names. */
export async function deployInstallation(
  input: DeploymentInput,
  assets: string,
  cancelled: () => boolean = () => false,
  report: SetupProgress = () => {}
) {
  const target = validateDeployment(input),
    key = target.connectionId.toLowerCase()
  if (deployments.has(key))
    throw new Error("A Customizing deployment is already running for this connection")
  deployments.add(key)
  const completed: string[] = []
  const created: string[] = []
  let restoreSession: (() => void) | undefined
  try {
    report("Connecting to SAP")
    const client = await ensureConnected(key, false)
    restoreSession = useStatefulSession(client)
    const payload = loadPayload(assets)
    // Preflight the entire installation before the first mutation.
    report("Checking inactive changes and package assignments")
    const inactive = await client.inactiveObjects()
    for (const record of inactive) {
      if (payload.some(object => record.object?.["adtcore:uri"] === object.path))
        throw new Error(
          "Installation has inactive changes. Review and activate or discard them before deploying."
        )
    }
    const existing = new Set<string>()
    const previousSources = new Map<string, string>()
    for (const object of payload) {
      if (!(await installationObjectExists(client, object))) continue
      const source = await readInstallationSource(client, object.path, "inactive")
      if (!sourceVersion(source))
        throw new Error(`Refusing to overwrite unversioned object ${object.name}`)
      previousSources.set(object.name, source)
      const info = await client.transportInfo(`${object.path}/source/main`, target.packageName)
      const currentPackage = info.TADIRDEVC || info.DEVCLASS
      if (currentPackage && currentPackage !== target.packageName)
        throw new Error(
          `${object.name} belongs to ${currentPackage}; package moves are not part of installation`
        )
      const assigned = info.LOCKS?.HEADER
      const tasks = info.LOCKS?.TASKS ?? []
      if (
        assigned &&
        target.transport &&
        assigned.TRKORR !== target.transport &&
        !tasks.some(task => task.TRKORR === target.transport)
      )
        throw new Error(
          `${object.name} is assigned to ${assigned.TRKORR}; select that request or one of its tasks`
        )
      existing.add(object.name)
    }
    for (const [index, object] of payload.entries()) {
      if (cancelled())
        throw new Error("Deployment cancelled; already saved objects were not rolled back")
      report(`Saving ${object.name} (${index + 1}/${payload.length})`)
      if (!existing.has(object.name)) {
        await client.createObject({
          objtype: object.type,
          name: object.name,
          parentName: target.packageName,
          description: "ABAP FS Customizing",
          parentPath: "",
          transport: target.transport
        })
        created.push(object.name)
      }
      await saveSource(
        client,
        object.path,
        object.source,
        target.transport,
        previousSources.get(object.name) ?? ""
      )
      completed.push(object.name)
    }
    report("Activating backend objects")
    const result = await activateReferences(
      client,
      payload.map(object => ({ uri: object.path, name: object.name, type: object.type }))
    )
    if (!result.success)
      throw new Error(
        `Activation failed: ${result.messages.map(item => item.shortText).join("; ")}`
      )
    if (cancelled())
      throw new Error("Deployment cancelled before SICF setup; objects remain installed")
    const services = await configureServices(client, target, cancelled, created, report)
    report("Refreshing ABAP FS package trees")
    for (const packageName of new Set([target.packageName, "$TMP"]))
      await refreshInstallationPackage(key, packageName)
    return { completed, ...services }
  } catch (error) {
    throw new Error(
      `Customizing deployment stopped. Saved objects: ${completed.join(", ") || "none"}. Created objects: ${created.join(", ") || "none"}. ${message(error)}`
    )
  } finally {
    restoreSession?.()
    deployments.delete(key)
  }
}

/** View-only entry point, also available after an abapGit import. Never registered as an LM tool. */
export async function provisionServices(
  input: DeploymentInput,
  _assets: string,
  cancelled: () => boolean = () => false,
  report: SetupProgress = () => {}
) {
  const target = validateDeployment(input),
    key = target.connectionId.toLowerCase()
  if (deployments.has(key))
    throw new Error("A Customizing deployment is already running for this connection")
  deployments.add(key)
  let restoreSession: (() => void) | undefined
  try {
    report("Connecting to SAP")
    const client = await ensureConnected(key, false)
    restoreSession = useStatefulSession(client)
    const services = await configureServices(client, target, cancelled, [], report)
    report("Refreshing the $TMP package tree")
    await refreshInstallationPackage(key, "$TMP")
    return services
  } catch (error) {
    throw new Error(
      `SICF setup stopped. Changes may already have been committed; check installation before retrying. ${message(error)}`
    )
  } finally {
    restoreSession?.()
    deployments.delete(key)
  }
}

async function configureServices(
  client: ADTClient,
  target: DeploymentInput,
  cancelled: () => boolean,
  created: string[] = [],
  report: SetupProgress = () => {}
) {
  if (cancelled()) throw new Error("SICF setup cancelled")
  // Require imported/deployed active handlers before creating any service.
  report("Checking active backend handlers")
  for (const object of SAP_OBJECTS.filter(object => object.service)) {
    const source = await readInstallationSource(client, object.path, "active")
    if (sourceVersion(source) !== ENGINE_VERSION)
      throw new Error(`Install and activate the matching ${object.name} first`)
  }
  const inactive = await client.inactiveObjects()
  if (inactive.some(record => record.object?.["adtcore:uri"] === SICF_REPORT.path))
    throw new Error("SICF installer has inactive changes; review them before continuing")
  const exists = await installationObjectExists(client, SICF_REPORT)
  let previousSource = ""
  if (exists) {
    const source = await readInstallationSource(client, SICF_REPORT.path, "inactive")
    if (!sourceVersion(source))
      throw new Error("Refusing to overwrite an unversioned SICF installer")
    previousSource = source
    const info = await client.transportInfo(`${SICF_REPORT.path}/source/main`, "$TMP")
    if ((info.TADIRDEVC || info.DEVCLASS) !== "$TMP")
      throw new Error("The SICF installer must be a local $TMP report; review the existing object")
  }
  if (cancelled()) throw new Error("SICF setup cancelled")
  if (!exists) {
    await client.createObject({
      objtype: SICF_REPORT.type,
      name: SICF_REPORT.name,
      parentName: "$TMP",
      description: "ABAP FS user-triggered SICF installer",
      parentPath: ""
    })
    created.push(SICF_REPORT.name)
  }
  await saveSource(
    client,
    SICF_REPORT.path,
    buildSicfReport(target.packageName, target.transport),
    undefined,
    previousSource
  )
  report("Activating the SICF installer")
  const activation = await activateReferences(client, [
    { uri: SICF_REPORT.path, name: SICF_REPORT.name, type: SICF_REPORT.type }
  ])
  if (!activation.success)
    throw new Error(
      `SICF installer activation failed: ${activation.messages.map(item => item.shortText).join("; ")}`
    )
  if (cancelled()) throw new Error("SICF setup cancelled before execution")
  report("Running the SICF service installer")
  // Deliberately permit dangerous setup only for this exact installer, not generic unit tests.
  const flags = {
    harmless: true,
    dangerous: false,
    critical: false,
    short: true,
    medium: false,
    long: false
  }
  const classes = await client.unitTestRun(`${SICF_REPORT.path}/source/main`, flags)
  const setup = classes.find(item => item["adtcore:name"].toLowerCase() === "ltc_setup")
  if (
    !setup ||
    !setup.testmethods.some(method => method["adtcore:name"].toLowerCase() === "run_setup")
  )
    throw new Error("SICF installer did not execute. Check ABAP Unit risk-level permissions")
  const alerts = [
    ...classes.flatMap(item => [
      ...item.alerts,
      ...item.testmethods.flatMap(method => method.alerts)
    ])
  ]
  const failures = alerts.filter(alert => alert.kind !== "warning")
  if (failures.length)
    throw new Error(
      `SICF installer failed: ${failures.map(alert => [alert.title, ...alert.details].join(" ")).join("; ")}`
    )
  const serviceStatuses = await waitForServices(target.connectionId, cancelled, report)
  report("Checking installed objects and service versions")
  const installation = await checkInstallation(target.connectionId, serviceStatuses)
  return {
    installation,
    note: installation.ready
      ? "ABAP objects and authenticated SICF services are ready. No transport was released."
      : `SICF setup finished, but installation is not ready:\n- ${installationIssues(installation).join("\n- ")}\nSICF changes may already have been committed. Check service state before retrying; no transport was released.`
  }
}

async function waitForServices(
  connectionId: string,
  cancelled: () => boolean,
  report: SetupProgress
): Promise<ServiceStatus[]> {
  const pending = new Map<string, ServiceStatus>()
  for (const object of SAP_OBJECTS)
    if (object.service)
      pending.set(object.service, {
        path: object.service,
        reachable: false,
        expectedVersion: ENGINE_VERSION,
        error: "Waiting for the SICF service to respond."
      })

  const latest = new Map(pending)
  const deadline = Date.now() + SERVICE_POLL_TIMEOUT_MS
  while (pending.size) {
    for (const path of pending.keys()) {
      if (cancelled()) throw new Error("SICF setup cancelled while waiting for services")
      report(`Checking SICF service ${path}`)
      try {
        const result = await callEngine(connectionId, { operation: "ping" }, path)
        const service: ServiceStatus = {
          path,
          reachable: result.STATUS === "ok",
          expectedVersion: ENGINE_VERSION,
          version: result.VERSION,
          error:
            result.STATUS === "ok"
              ? result.VERSION === ENGINE_VERSION
                ? undefined
                : `Service reports version ${result.VERSION ?? "not reported"}; expected ${ENGINE_VERSION}.`
              : (result.MESSAGES ?? []).join("; ") || "Service is not ready yet."
        }
        latest.set(path, service)
        if (service.reachable && service.version === ENGINE_VERSION) {
          pending.delete(path)
          report(`SICF service ${path} is available`)
        } else if (service.reachable) {
          report(
            `SICF service ${path} reports version ${service.version ?? "not reported"}; waiting for ${ENGINE_VERSION}`
          )
        }
      } catch (error) {
        latest.set(path, {
          path,
          reachable: false,
          expectedVersion: ENGINE_VERSION,
          error: "SICF service is not responding yet.",
          detail: message(error)
        })
      }
    }
    if (!pending.size || Date.now() >= deadline) break
    const remaining = deadline - Date.now()
    report(
      `Waiting 5 seconds to retry ${[...pending.keys()].join(", ")} (${Math.ceil(remaining / 1000)}s remaining)`
    )
    await new Promise(resolve => setTimeout(resolve, Math.min(SERVICE_POLL_INTERVAL_MS, remaining)))
  }

  for (const path of pending.keys()) {
    const service = latest.get(path)!
    latest.set(path, {
      ...service,
      error: `Did not report the expected version within 2 minutes. ${service.error ?? "Check SICF activation and authenticated access."}`
    })
  }
  return SAP_OBJECTS.flatMap(object => (object.service ? [latest.get(object.service)!] : []))
}

async function saveSource(
  client: ADTClient,
  path: string,
  source: string,
  transport?: string,
  previousSource = ""
) {
  const lock = await client.lock(path)
  try {
    await client.setObjectSource(`${path}/source/main`, source, lock.LOCK_HANDLE, transport)
  } finally {
    await client.unLock(path, lock.LOCK_HANDLE)
  }
  await verifyInactiveSource(
    () => client.getObjectSource(`${path}/source/main`, { version: "inactive" }),
    source,
    previousSource
  )
}
