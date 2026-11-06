import { parentPort } from "worker_threads"
import { usedInventoryKeys } from "./analysis"
import type { DependencyGraphRequest, DependencyGraphResponse } from "./dependencyWorker"

parentPort?.on("message", (request: DependencyGraphRequest) => {
  let response: DependencyGraphResponse
  try {
    response = {
      used: usedInventoryKeys(
        request.inventory,
        request.observations,
        request.edges,
        request.previousUsed
      )
    }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(response)
})
