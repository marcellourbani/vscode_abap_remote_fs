interface AbapSource {
  "abapsource:sourceUri": string
  "abapsource:fixPointArithmetic"?: string
  "abapsource:activeUnicodeCheck"?: string
}
export interface BaseHeader extends AbapSource {
  "adtcore:name": string
  "adtcore:type": string
  "adtcore:changedAt": string
  "adtcore:version": string
  "adtcore:createdAt": string
  "adtcore:changedBy": string
  "adtcore:createdBy": string
  "adtcore:responsible"?: string
  "adtcore:masterLanguage"?: string
  "adtcore:masterSystem"?: string
  "adtcore:description"?: string
  "adtcore:descriptionTextLimit"?: string
  "adtcore:language"?: string
}
interface ClassHeader extends BaseHeader {
  "class:final": string
  "class:abstract": string
  "class:visibility": string
  "class:category": string
  "class:sharedMemoryEnabled": string
  "class:includeType"?: string
}
interface AtomLink {
  href: string
  rel: string
  type: string
  title: string
}

export interface AdtObjectBase<T1 extends BaseHeader, T2 extends AtomLink> {
  nodeName: string
  header: T1
  links: T2[]
}
export interface AdtObjectClass<T1 extends ClassHeader, T2 extends AtomLink>
  extends AdtObjectBase<T1, T2> {
  includes: Array<{ header: T1; links: T2[] }>
}

export function parseObject<T1 extends BaseHeader, T2 extends AtomLink>(
  xmlObject: any
): AdtObjectBase<T1, T2> {
  const nodeName = Object.keys(xmlObject)[0]
  const root = nodeName && xmlObject[nodeName]
  const header = root && root["$"]
  const links = root && root["atom:link"].map((x: any) => x["$"])
  return { nodeName, header, links }
}
export function firstTextLink(links: AtomLink[]): AtomLink | undefined {
  let firstLink: AtomLink | undefined
  links.some(
    link => !!(link.type && link.type.match(/text/i) && (firstLink = link))
  )
  return firstLink
}
export function objectVersion(header: BaseHeader) {
  return header["adtcore:version"] ? `version=${header["adtcore:version"]}` : ""
}
export function parseClass<T1 extends ClassHeader, T2 extends AtomLink>(
  xmlObject: any
): AdtObjectClass<T1, T2> {
  const nodeName = Object.keys(xmlObject)[0]
  const root = nodeName && xmlObject[nodeName]
  const header = root && root["$"]
  const links = root && root["atom:link"].map((x: any) => x["$"])
  const includes = root["class:include"].map((x: any) => {
    return {
      header: x["$"],
      links: x["atom:link"].map((x: any) => x["$"])
    }
  })
  return { nodeName, header, links, includes }
}
