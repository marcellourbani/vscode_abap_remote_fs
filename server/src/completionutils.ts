import { CompletionProposal } from "abap-adt-api"
import { CompletionItem } from "vscode-languageserver"

const INTERFACEROLE = 58 // sccmp_role_intftype in abap


export const formatItem = (line: string, character: number) => (i: CompletionProposal): CompletionItem => {
    const before = line.substring(0, character)
    const start = line.length - i.PREFIXLENGTH
    const lastChar = before.substring(start, start + 1)
    const isMethodCall = !!before.substring(start - 2).match(/^[-=]>/)
    const label =
        i.IDENTIFIER + (i.ROLE === INTERFACEROLE && isMethodCall ? "~" : "")
    let insertText = label
    // fix namespaces
    const match = label.match(/^(\/\w+\/)/)
    if (match) {
        let len = match[1].length
        len = i.PREFIXLENGTH >= len ? len : lastChar === "/" ? 1 : 0
        if (len) insertText = insertText.substr(len)
    }
    // fix field-symbols
    if (label[0] === "<") {
        if (line[character - i.PREFIXLENGTH] === "<")
            insertText = insertText.substr(1)
        if (line[character] === ">")
            insertText = insertText.substr(0, insertText.length - 1)
    }
    const item: CompletionItem = {
        label,
        insertText,
        sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
        data: i
    }
    return item
}
