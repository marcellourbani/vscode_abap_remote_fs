export interface AdtPath {
  method: string
  path: string
  connectionName: string
  isFolder: boolean
  url: string
}
export const adtPathResolver = (url: string): AdtPath | undefined => {
  const match = url.match(/adt:\/\/([^\/]+)\/sap\/bc\/adt(.*)/i)
  if (match) {
    let method = "GET"
    let isFolder = true
    let [connectionName, path] = match.splice(1)
    if (path.match(/^(\/?|(\/repository(\/?nodestructure)?))$/i)) {
      //partial root
      path = "/sap/bc/adt/repository/nodestructure"
      method = "POST"
    } else if (!path.match(/\/(.*)\//)) {
      throw new Error("Not found")
    }
    return { method, path, connectionName, isFolder, url }
  }
}
