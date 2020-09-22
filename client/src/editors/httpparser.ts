import { parse } from "fast-xml-parser"

interface HttpService {
    handlerClass: string,
    author: string,
    name: string,
    text: string,
    url: string,
}

export const parseHTTP = (s: string): HttpService => {
    const raw = parse(s, {
        ignoreAttributes: false,
        trimValues: false,
        parseAttributeValue: true
    })
    const {
        "@_http:handler_servicehandler": handlerClass = "",
        "@_adtcore:responsible": author = "",
        "@_adtcore:name": name = "",
        "@_adtcore:description": text = "",
        "@_http:header_canonicalurl": url = "", } = raw["http:abap"] || {}

    return { handlerClass, author, name, text, url }
}