import type { ADTClient } from "abap-adt-api"

const USAGE_REFERENCES_PATH = "/sap/bc/adt/repository/informationsystem/usageReferences"
const patchedHttpClients = new WeakSet<object>()

export function installUsageReferencesNamespacePatch(client: ADTClient): void {
  const httpClient = client.httpClient
  if (patchedHttpClients.has(httpClient)) return

  const originalRequest = httpClient.request.bind(httpClient)
  httpClient.request = async (url, options) => {
    const response = await originalRequest(url, options)
    const requestPath = url.split(/[?#]/, 1)[0] || url
    if (!requestPath.endsWith(USAGE_REFERENCES_PATH)) return response

    return {
      ...response,
      body: response.body.replace(/\busagereferences(?=[:=])/gi, "usageReferences")
    }
  }
  patchedHttpClients.add(httpClient)
}
