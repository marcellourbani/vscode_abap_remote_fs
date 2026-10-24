import { CreatableTypes, type ADTClient } from "abap-adt-api"
import { log } from "../lib"

interface RequestConfig {
  url?: unknown
  method?: unknown
  headers?: any
}

function getObjectCreationContentType(url: string) {
  const requestPath = url.split(/[?#]/, 1)[0]
  const adtPath = "/sap/bc/adt/"
  const adtPathIndex = requestPath.indexOf(adtPath)
  if (adtPathIndex === -1) return undefined

  const requestSegments = requestPath.slice(adtPathIndex + adtPath.length).split("/")
  const creatableType = [...CreatableTypes.values()].find(type => {
    const creationSegments = type.creationPath.split("/")
    return (
      creationSegments.length === requestSegments.length &&
      creationSegments.every((segment, index) =>
        segment === "%s" ? requestSegments[index].length > 0 : segment === requestSegments[index]
      )
    )
  })
  if (!creatableType) return undefined

  const contentTypePath = creatableType.creationPath.replace("/%s", "").replace(/\//g, ".")
  return `application/vnd.sap.adt.${contentTypePath}+xml`
}

function updateContentType(config: RequestConfig) {
  if (typeof config.url !== "string" || typeof config.method !== "string") return config
  if (config.method.toUpperCase() !== "POST") return config

  const headers = config.headers
  if (!headers || typeof headers !== "object") return config
  const currentContentType =
    typeof headers.get === "function"
      ? headers.get("Content-Type")
      : (headers["Content-Type"] ?? headers["content-type"])
  if (currentContentType !== "application/*") return config

  const contentType = getObjectCreationContentType(config.url)
  if (!contentType) return config

  if (typeof headers.set === "function") headers.set("Content-Type", contentType)
  else headers["Content-Type"] = contentType
  return config
}

export function installObjectCreationContentTypeInterceptor(client: ADTClient) {
  try {
    const httpClient = client.httpClient as any
    const requestInterceptors = httpClient?.httpclient?.axios?.interceptors?.request
    if (typeof requestInterceptors?.use !== "function") return

    requestInterceptors.use((config: RequestConfig) => {
      try {
        return updateContentType(config)
      } catch {
        return config
      }
    })
  } catch (error) {
    log(`Failed to install object-creation Content-Type interceptor: ${error}`)
  }
}
