import { DecorationOptions, ExtensionContext, Range, ThemeColor, window, workspace } from "vscode"
import { atcProvider } from "."
import { FindingMarker, hasExemption } from "./view"
let timeout: NodeJS.Timeout | undefined

let warningDecorator = window.createTextEditorDecorationType({})

let exemptedDecorator = warningDecorator

const toDecoration = (m: FindingMarker): DecorationOptions =>
    ({ range: new Range(m.start, m.start), hoverMessage: m.finding.messageTitle })

function updateDecorations() {
    const editor = window.activeTextEditor
    if (!editor) return
    const markers = atcProvider.markers(editor.document.uri)
    const exempt = markers.filter(m => hasExemption(m.finding)).map(toDecoration)
    const notexempt = markers.filter(m => !hasExemption(m.finding)).map(toDecoration)
    editor.setDecorations(warningDecorator, notexempt)
    editor.setDecorations(exemptedDecorator, exempt)
}

export function triggerUpdateDecorations() {
    if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
    }
    timeout = setTimeout(updateDecorations, 100)
}
export function registerSCIDecorator(context: ExtensionContext) {
    warningDecorator = window.createTextEditorDecorationType({
        light: {
            gutterIconPath: context.asAbsolutePath("client/images/light/issues.svg"),
            backgroundColor: "lightblue",
        },
        dark: {
            gutterIconPath: context.asAbsolutePath("client/images/dark/issues.svg"),
            backgroundColor: "darkblue",
        },
        isWholeLine: true
    })

    exemptedDecorator = window.createTextEditorDecorationType({
        light: {
            gutterIconPath: context.asAbsolutePath("client/images/light/check.svg"),
            backgroundColor: "lightgreen"
        },
        dark: {
            gutterIconPath: context.asAbsolutePath("client/images/dark/check.svg"),
            backgroundColor: "darkgreen",
        },
        isWholeLine: true,
    })

    workspace.onDidChangeTextDocument(event => {
        if (window.activeTextEditor && event.document === window.activeTextEditor.document) {
            triggerUpdateDecorations()
        }
    }, null, context.subscriptions)

    window.onDidChangeActiveTextEditor(() => {
        if (window.activeTextEditor) triggerUpdateDecorations()
    }, null, context.subscriptions)
}

