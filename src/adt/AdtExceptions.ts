import {
  parseToPromise,
  getFieldAttribute,
  recxml2js
} from "./parsers/AdtParserBase"
import { Response } from "request"
const TYPEID = Symbol()

export class AdtException extends Error {
  // namespace: string
  // type: string
  // message: string
  // localizedMessage: string
  // properties: Map<string, string>
  get typeID(): Symbol {
    return TYPEID
  }

  constructor(
    public type: string,
    public message: string,
    public namespace?: string,
    public localizedMessage?: string,
    public properties?: Map<string, string>
  ) {
    super()
  }

  static async fromXml(xml: string): Promise<AdtException> {
    const raw: any = await parseToPromise()(xml)
    const root: any = raw["exc:exception"]
    const namespace = getFieldAttribute("namespace", "id", root)
    const type = getFieldAttribute("type", "id", root)
    const values = recxml2js(root)
    return new AdtException(
      type,
      values.message,
      namespace,
      values.localizedMessage,
      new Map()
    )
  }
}
export class AdtHttpException extends Error {
  statusCode: number
  statusMessage: string
  message: string

  constructor(response: Response, message?: string) {
    super()
    this.statusCode = response.statusCode
    this.statusMessage = response.statusMessage
    this.message =
      message ||
      `Error ${this.statusCode}:${this.statusMessage} fetching ${
        response.request.uri.path
      } from ${response.request.uri.hostname}`
  }
}
export function isAdtException(e: Error): e is AdtException {
  return (<AdtException>e).typeID === TYPEID
}
