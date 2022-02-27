import { CompletionProposal } from "abap-adt-api"
import { CompletionItem, Position, Range, TextEdit } from "vscode-languageserver"

const INTERFACEROLE = 58 // sccmp_role_intftype in abap


export const formatItem = (textLine: string, p: Position) => (i: CompletionProposal): CompletionItem => {
    const { line, character } = p
    const before = textLine.substring(0, character)
    const start = before.length - i.PREFIXLENGTH
    const isMethodCall = !!before.substring(start - 2).match(/^[-=]>/)
    const label =
        i.IDENTIFIER + (i.ROLE === INTERFACEROLE && isMethodCall ? "~" : "")
    let insertText = label
    // handle wildcards
    if (before.match(/\*/)) {
        const mpref = before.match(/(<?[\w\*]+)$/)
        const len = mpref ? mpref[1].length : i.PREFIXLENGTH
        const prefixLen = label.match(/(\/[\w]+\/)/)?.[1].length || 0
        const range = { start: { line, character: character - len - prefixLen }, end: { line, character } }
        return {
            label,
            sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
            textEdit: TextEdit.insert(p, label),
            additionalTextEdits: [TextEdit.del(range)],
            data: i
        }
    }
    // fix namespaces
    const match = label.match(/^(\/\w+\/)/)
    if (match) {
        const lastChar = before.substring(start, start + 1)
        const len = match[1].length
        if (i.PREFIXLENGTH >= len) insertText = insertText.substring(len)
        else if (lastChar === "/") insertText = insertText.substring(1)
    }
    // fix field-symbols
    if (label[0] === "<") {
        if (textLine[p.character - i.PREFIXLENGTH] === "<")
            insertText = insertText.substring(1)
        if (textLine[p.character] === ">")
            insertText = insertText.substring(0, insertText.length - 1)
    }
    const item: CompletionItem = {
        label,
        insertText,
        sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
        data: i
    }
    return item
}
