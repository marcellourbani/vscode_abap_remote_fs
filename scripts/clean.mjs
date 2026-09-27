#!/usr/bin/env node
// Root workspace clean: removes build artefacts and any *.vsix files.
// Uses readdir+filter instead of shell-specific globbing.
// maxRetries/retryDelay match rimraf defaults for Windows EPERM/EBUSY on node_modules.
import { rm, readdir } from "node:fs/promises"

const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }
const dirs = [
  "out",
  "node_modules",
  "client/node_modules",
  "server/node_modules",
  "modules/abapObject/node_modules",
  "modules/abapfs/node_modules",
  "modules/sharedapi/node_modules"
]
const vsix = (await readdir(".").catch(() => [])).filter(f => f.endsWith(".vsix"))
await Promise.all([...dirs, ...vsix].map(p => rm(p, RM_OPTS)))
