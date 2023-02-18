import { decodeEntity } from "../../lib/functions"

export const extractPragmas = (text: string) => {
    const fixResult = (isPragma: boolean) => (s: string) => {
        const prefix = isPragma ? "" : "(?:EC )?"
        const re = `(?:<code>|<CODE>).*\\s("?#+${prefix}${s})[\\s\\.].*(?:<\\/code>|<\\/CODE>)`
        const m = new RegExp(re, "i")
        const example = text.match(m)
        if (example) return example[1]
        if (isPragma) {
            if (s.startsWith("##")) return s
            if (s.startsWith("#")) return `#${s}`
            return `##${s}`
        } else {
            if (s.startsWith("EC ")) return `#${s}`
            if (s.startsWith('#')) return isPragma ? s : `"${s}`
            if (s.startsWith('"')) return s
            return `"#${"EC "}${s}`
        }
    }
    const extractPragma = (s: string) => {
        if (!s.match(/refer to/)) return decodeEntity(s).split(" or ")
        const codes = [...text.matchAll(/<code>([\w_]*)<\/code>/ig)]
        return codes.map(c => c[1])
    }
    const pcmatch = text.match(/([^>]+)pseudo comment\s+([^<]+)/)
    if (pcmatch && !pcmatch[1].match(/can(\s*)not/i)) {
        return decodeEntity(pcmatch[2]).split(" or ").map(fixResult(false))
    }
    const prmatch = text.match(/([^>]+)pragma\s+([^<]+)/)
    if (prmatch && !prmatch[1].match(/can(\s*)not/i)) {
        return extractPragma(prmatch[2]).map(fixResult(true))
    }
    return []
}

export const insertPosition = (line: string, pragma: string) => {
    line = line.replace(/\r$/, "")
    if (!pragma.match(/^##/)) return line.replace(/".*/, "").length
    return line.replace(/".*/, "").replace(/\.\s*/, "").length
}
