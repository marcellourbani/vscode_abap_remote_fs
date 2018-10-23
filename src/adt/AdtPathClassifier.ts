import { Uri, FileType, FileSystemError } from "vscode"
import { ObjectNode } from "./AdtParser"
import { AdtNode } from "./AdtNode"
// visual studio paths are hierarchic, adt ones aren't
// so we need a way to translate the hierarchic ones to the original ones
// this file is concerned with telling whether a path is a real ADT one or one from vscode
// /sap/bc/adt/repository/nodestructure (with ampty query) is the root of both
// also, several objects have namespaces.
//  Class /foo/bar of package /foo/baz in code will have a path like
//    /sap/bc/adt/repository/nodestructure/foo/baz/foo/bar
//  the actual adt path would be something like:
//    /sap/bc/adt/oo/classes/%2Ffoo%2Fbar
export enum AdtUrlType {
  NODESTRUCTURE,
  NAMESPACE,
  CLASS,
  SIMPLE
}

export interface AdtPathInfo {
  source: Uri
  uri: Uri
  type: AdtUrlType
  method: string
  isDirectory: FileType
}

export const isValid = (vsUri: Uri): boolean => {
  const matches = vsUri.path.match(
    /^\/sap\/bc\/adt\/repository\/nodestructure\/?(.*)/i
  )
  return !!(matches && !matches[1].match(/^\./))
}

export class AdtPathClassifier {
  private nameSpaces: Set<string> = new Set()
  private pathinfo: Map<string, AdtPathInfo> = new Map()

  private subpath(vsuri: Uri): string {
    const matches = vsuri.path.match(
      /^\/sap\/bc\/adt\/repository\/nodestructure\/?(.*)/i
    )
    if (!matches)
      throw FileSystemError.NoPermissions("Path did not originate in vscode")
    return matches[1]
  }
  public addVsPath(parent: AdtNode, name: string, path: string) {
    const sep = parent.uri.path.match(/\/$/) || name.match(/^\//) ? "" : "/"
    const vspath = parent.uri.path + sep + name
    const vsuri = parent.uri.with({ path: vspath })
    const adtUri = Uri.parse(vsuri.scheme + "://" + vsuri.authority + path)
    const info = this.uriInfo(adtUri, vsuri) //TODO error handling
    const subpart = this.subpath(vsuri)
    this.pathinfo.set(subpart, info)
  }

  public originalFromVscode(vsuri: Uri): Uri | undefined {
    const subpart = this.subpath(vsuri)
    if (subpart === "" && vsuri.query === "") return vsuri
    //root
    else {
      const info = this.pathinfo.get(subpart)
      return info ? info.uri : undefined
    }
  }
  public registerNamespace(node: ObjectNode) {
    const matches = node.OBJECT_NAME.match(/^(\/[^\/]+\/)/)
    if (matches) this.nameSpaces.add(matches[1])
  }
  public adtUriInfo(original: Uri): AdtPathInfo {
    return this.uriInfo(original, original)
  }
  public registerCodeUri(codeUri: Uri, adtUri: Uri) {}

  private uriInfo(uri: Uri, source: Uri): AdtPathInfo {
    if (!uri.path.match(/\/sap\/bc\/adt\/.*\/?/i))
      throw FileSystemError.FileNotFound(uri)
    let type, method, isDirectory
    if (uri.path.match(/\/repository\/nodestructure\/?$/i)) {
      type = AdtUrlType.NODESTRUCTURE
      method = "POST"
      isDirectory = FileType.Directory
    } else if (uri.path.match(/\/oo\/classes\//i)) {
      isDirectory = FileType.Directory
      type = AdtUrlType.CLASS
      method = "GET"
    } else if (uri.path.match(/\/wb\/object_type\/devck\/object_name\/(.*)/i)) {
      isDirectory = FileType.Directory
      type = AdtUrlType.NODESTRUCTURE
      method = "GET"
    } else {
      isDirectory = FileType.File
      type = AdtUrlType.SIMPLE
      method = "GET"
    }
    return { source, uri, type, method, isDirectory }
  }
}
