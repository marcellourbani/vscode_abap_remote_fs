import { decodeEntity } from "../../lib/functions"

export const extractPragmas = (text: string) => {
    const fixResult = (isPragma: boolean) => (s: string) => {
        const prefix = isPragma ? "" : "(?:EC )?"
        const re = `(?:<code>|<CODE>).*\\s("?#+${prefix}${s})[\\s\\.].*(?:<\\/code>|<\\/CODE>)`
        const m = new RegExp(re, "i")
        const example = text.match(m)
        if (example) return example[1]
        if (s.startsWith('"')) return s
        if (s.startsWith('#')) return `"${s}`
        if (isPragma || s.startsWith("EC ")) return `#${s}`
        return `"#${"EC "}${s}`
    }
    const pcmatch = text.match(/([^>]+)pseudo comment\s+([^<]+)/)
    if (pcmatch && !pcmatch[1].match(/can(\s*)not/i)) {
        return decodeEntity(pcmatch[2]).split(" or ").map(fixResult(false))
    }
    const prmatch = text.match(/([^>]+)pragma\s+([^<]+)/)
    if (prmatch && !prmatch[1].match(/can(\s*)not/i)) {
        return decodeEntity(prmatch[2]).split(" or ").map(fixResult(true))
    }
    return []
}