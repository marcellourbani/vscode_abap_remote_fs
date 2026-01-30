import { XMLParser } from "fast-xml-parser"

interface HttpService {
    handlerClass: string,
    author: string,
    name: string,
    text: string,
    url: string,
}
const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: false,
    parseAttributeValue: true
})

export const parseHTTP = (s: string): HttpService => {
    const raw = parser.parse(s)
    const {
        "@_http:handler_servicehandler": handlerClass = "",
        "@_adtcore:responsible": author = "",
        "@_adtcore:name": name = "",
        "@_adtcore:description": text = "",
        "@_http:header_canonicalurl": url = "", } = raw["http:abap"] || {}

    return { handlerClass, author, name, text, url }
}