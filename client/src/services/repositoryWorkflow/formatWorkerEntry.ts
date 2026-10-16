import { parentPort } from "worker_threads"
import { formatRepositoryAbap } from "./abapSourceFormatter"
import { alphabetizeClassMethods } from "./classMethodOrder"
import type { FormatWorkerRequest, FormatWorkerResponse } from "./formatWorker"

parentPort?.on("message", (request: FormatWorkerRequest) => {
  let response: FormatWorkerResponse
  try {
    const map = request.methodMap
    const source = map
      ? alphabetizeClassMethods(request.source, map.className, map.sourceUrl, map.elements)
      : request.source
    response = { result: formatRepositoryAbap(request.fileName, source) }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(response)
})
