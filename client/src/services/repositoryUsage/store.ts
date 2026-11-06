import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"
import type { UsageAnalysis } from "./types"
import { reconcileSt03nIssues } from "./options"

export class UsageStore {
  private readonly queue = new Map<string, Promise<unknown>>()
  private readonly session = randomUUID()
  constructor(readonly root = path.join(os.homedir(), ".abapfs", "repository-usage")) {}

  private directory(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid analysis id")
    return path.join(this.root, id)
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true })
    for (const state of await this.list()) {
      const lock = await this.readLock(state.id)
      if (lock && this.alive(lock.pid)) continue
      await fs.rm(path.join(this.directory(state.id), "run.lock"), { force: true })
      if (state.run.status === "running")
        await this.update(state.id, current => {
          current.run.elapsedMs += current.run.startedAt
            ? Math.max(0, Date.now() - Date.parse(current.run.startedAt))
            : 0
          current.run.startedAt = undefined
          current.run.status = "interrupted"
        })
    }
  }

  async create(name: string) {
    await fs.mkdir(this.root, { recursive: true })
    const lockPath = path.join(this.root, "create.lock")
    let handle
    try {
      handle = await fs.open(lockPath, "wx")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const owner = await fs.readFile(lockPath, "utf8")
      const pid = Number(owner)
      if (!Number.isInteger(pid) || pid <= 0 || this.alive(pid))
        throw new Error("An analysis is already being created. Try again.")
      await fs.rm(lockPath)
      handle = await fs.open(lockPath, "wx")
    }
    try {
      await handle.writeFile(String(process.pid))
      const error = await this.nameError(name)
      if (error) throw new Error(error)
      return await this.createUnique(name.trim())
    } finally {
      await handle.close()
      await fs.rm(lockPath, { force: true })
    }
  }

  async nameError(name: string): Promise<string | undefined> {
    const normalized = name.trim().toLowerCase()
    if (!normalized) return "Enter an analysis name"
    if ((await this.list()).some(state => state.name.trim().toLowerCase() === normalized)) {
      return "An analysis with this name already exists. Choose a different name."
    }
    return undefined
  }

  private async createUnique(name: string) {
    const now = new Date().toISOString()
    const state: UsageAnalysis = {
      schemaVersion: 1,
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      connectionId: "",
      packages: [],
      includeSubpackages: true,
      discoveryMode: "connected",
      jobMode: "upload",
      jobConnection: "",
      includeReleasedJobs: false,
      includeScheduledJobs: false,
      periodLabel: "",
      inventory: [],
      inputs: [],
      observations: [],
      transactions: [],
      functions: [],
      jobPrograms: [],
      edges: [],
      checks: {},
      completedPackages: [],
      completedFunctionGroups: [],
      dependencyConnectionId: "",
      concurrency: 5,
      jobsFrom: "",
      jobsTo: "",
      issues: [],
      run: { stage: "discovery", status: "idle", completed: 0, elapsedMs: 0 }
    }
    await fs.mkdir(this.directory(state.id), { recursive: true })
    await this.write(state)
    return state
  }

  async list() {
    await fs.mkdir(this.root, { recursive: true })
    const states: UsageAnalysis[] = []
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
      states.push(await this.get(entry.name))
    }
    return states.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async get(id: string): Promise<UsageAnalysis> {
    const value = JSON.parse(
      await fs.readFile(path.join(this.directory(id), "workflow.json"), "utf8")
    ) as UsageAnalysis
    if (
      value.schemaVersion !== 1 ||
      value.id !== id ||
      !Array.isArray(value.inventory) ||
      !Array.isArray(value.observations)
    )
      throw new Error("Invalid or unsupported usage analysis state")
    reconcileSt03nIssues(value)
    return value
  }

  async update(id: string, edit: (state: UsageAnalysis) => void) {
    const previous = this.queue.get(id) || Promise.resolve()
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        const state = await this.get(id)
        edit(state)
        reconcileSt03nIssues(state)
        state.updatedAt = new Date().toISOString()
        state.revision++
        await this.write(state)
        return state
      })
    this.queue.set(id, pending)
    try {
      return await pending
    } finally {
      if (this.queue.get(id) === pending) this.queue.delete(id)
    }
  }

  private async write(state: UsageAnalysis) {
    const file = path.join(this.directory(state.id), "workflow.json")
    const temporary = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(state), "utf8")
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporary, file)
        break
      } catch (error) {
        if (
          attempt === 4 ||
          !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")
        )
          throw error
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
      }
    }
    await fs.appendFile(
      path.join(this.directory(state.id), "events.jsonl"),
      `${JSON.stringify({ at: state.updatedAt, revision: state.revision, run: state.run })}\n`
    )
  }

  async saveOriginal(id: string, inputId: string, extension: string, bytes: Uint8Array) {
    if (!/^[a-f0-9]{64}$/.test(inputId) || ![".xlsx", ".csv"].includes(extension.toLowerCase()))
      throw new Error("Invalid input artifact")
    const folder = path.join(this.directory(id), "inputs")
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, `${inputId}${extension.toLowerCase()}`), bytes)
  }

  async removeOriginal(id: string, inputId: string) {
    if (!/^[a-f0-9]{64}$/.test(inputId)) throw new Error("Invalid input artifact")
    const folder = path.join(this.directory(id), "inputs")
    await Promise.all(
      [".xlsx", ".csv"].map(extension =>
        fs.rm(path.join(folder, `${inputId}${extension}`), { force: true })
      )
    )
  }

  private alive(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  private async readLock(id: string): Promise<{ session: string; pid: number } | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory(id), "run.lock"), "utf8"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }
  async lock(id: string) {
    try {
      const handle = await fs.open(path.join(this.directory(id), "run.lock"), "wx")
      try {
        await handle.writeFile(JSON.stringify({ session: this.session, pid: process.pid }))
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("This analysis is already running")
      throw error
    }
  }
  async unlock(id: string) {
    if ((await this.readLock(id))?.session === this.session)
      await fs.rm(path.join(this.directory(id), "run.lock"), { force: true })
  }
  async remove(id: string) {
    await this.lock(id)
    try {
      await this.queue.get(id)
      await fs.rm(this.directory(id), { recursive: true, force: true })
    } catch (error) {
      await this.unlock(id)
      throw error
    }
  }
}
