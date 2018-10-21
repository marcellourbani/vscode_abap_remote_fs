import { Uri } from "vscode"

export interface AdtPath {
  method: string
  path: string
  connectionName: string
  isFolder: boolean
  url: Uri
  isRoot: boolean
}
export const adtPathResolver = (url: Uri): AdtPath => {
  const urlString = url.toString()
  const match = urlString.match(/adt:\/\/([^\/]+)\/sap\/bc\/adt(.*)/i)
  if (match) {
    let method = "GET"
    let isFolder = true
    let isRoot = false
    let [connectionName, path] = match.splice(1)
    if (path.match(/^\/?|$/i)) {
      //partial root
      path = "/sap/bc/adt/repository/nodestructure"
      method = "POST"
      isRoot = true
    } else if (!path.match(/\/(.*)\//)) {
      throw new Error("Not found")
    }
    return { method, path, connectionName, isFolder, url, isRoot }
  } else throw new Error("not found")
}
