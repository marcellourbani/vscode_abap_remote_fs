#!/usr/bin/env node
// Cross-platform rm -rf for npm scripts. Usage: node scripts/rm.mjs path1 path2 ...
// maxRetries/retryDelay match rimraf defaults for Windows EPERM/EBUSY on node_modules.
import { rm } from "node:fs/promises"

const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }
const targets = process.argv.slice(2)
await Promise.all(targets.map(t => rm(t, RM_OPTS)))
