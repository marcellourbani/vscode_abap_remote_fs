interface BaseHeader {
  "abapsource:sourceUri": string
  "abapsource:fixPointArithmetic": string
  "abapsource:activeUnicodeCheck": string
  "adtcore:responsible": string
  "adtcore:masterLanguage": string
  "adtcore:masterSystem": string
  "adtcore:name": string
  "adtcore:type": string
  "adtcore:changedAt": Date
  "adtcore:version": string
  "adtcore:createdAt": Date
  "adtcore:changedBy": string
  "adtcore:createdBy": string
  "adtcore:description": string
  "adtcore:descriptionTextLimit": string
  "adtcore:language": string
}
interface AdtAtomLink {
  href: string
  rel: string
  type: string
  title: string
}
//payload[Object.keys(payload)[0]]["$"]
//payload[Object.keys(payload)[0]]["atom:link"].map(x=>x["$"])
//payload[Object.keys(payload)[0]]["class:include"].map(x=>x["$"])
export interface AdtObjectBase<T1 extends BaseHeader, T2 extends AdtAtomLink> {
  nodeName: string
  header: T1
  links: T2[]
}
