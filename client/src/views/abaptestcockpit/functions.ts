import { Comment } from "@abaplint/core"
import { decodeEntity, isDefined, parseAbapFile } from "../../lib/functions"

export const extractPragmas = (text: string): string[] => {
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
        return codes.map(c => c[1]).filter(isDefined)
    }
    const pcmatch = text.match(/([^>]+)pseudo comment\s+([^<]+)/)
    if (pcmatch && !pcmatch[1]?.match(/can(\s*)not/i)) {
        return decodeEntity(pcmatch[2] || "").split(" or ").map(fixResult(false)).filter(isDefined)
    }
    const prmatch = text.match(/([^>]+)pragma\s+([^<]+)/)
    if (prmatch && !prmatch[1]?.match(/can(\s*)not/i)) {
        return extractPragma(prmatch[2] || "").map(fixResult(true)).filter(isDefined)
    }
    return []
}

export const insertPosition = (line: string, pragma: string): number => {
    const isPragma = pragma.match(/^##/)
    const tokens = parseAbapFile("foo.prog.abap", line)?.getTokens()
    if (!tokens) {
        line = line.replace(/\r$/, "").replaceAll(/''/g, "  ")
        while (line.match(/('[^"]*)"([^']*')/)) line = line.replaceAll(/('[^"]*)"([^"]*')/g, "$1 $2")
        if (!pragma.match(/^##/)) return line.replace(/".*/, "").length
        return line.replace(/".*/, "").replace(/\.\s*/, "").length
    }
    const last = tokens[tokens.length - 1]
    const lastofs = last?.getStr().match(/^"/) ? 2 : 1
    const prev = tokens[tokens.length - lastofs]
    if (isPragma) {
        if (prev?.getStr() === '.') return prev.getStart().getCol() - 1
    } else if (prev) return prev.getEnd().getCol() - 1

    return line.length
}
