import { DecorationOptions, ExtensionContext, Range, ThemeColor, window, workspace } from "vscode"
import { atcProvider } from "."
import { FindingMarker, hasExemption } from "./view"
let timeout: NodeJS.Timeout | undefined

const empty = window.createTextEditorDecorationType({})
const decorators = {
    error: empty,
    warning: empty,
    info: empty,
    exempted: empty
}


const toDecoration = (m: FindingMarker): DecorationOptions =>
    ({ range: new Range(m.start, m.start), hoverMessage: m.finding.messageTitle })

function updateDecorations() {
    const editor = window.activeTextEditor
    if (!editor) return
    const markers = atcProvider.markers(editor.document.uri)
    const exempt = markers.filter(m => hasExemption(m.finding)).map(toDecoration)
    const infos = markers.filter(m => !hasExemption(m.finding) && m.finding.priority !== 2 && m.finding.priority !== 1).map(toDecoration)
    const warnings = markers.filter(m => !hasExemption(m.finding) && m.finding.priority === 2).map(toDecoration)
    const errors = markers.filter(m => !hasExemption(m.finding) && m.finding.priority === 1).map(toDecoration)
    editor.setDecorations(decorators.warning, warnings)
    editor.setDecorations(decorators.error, errors)
    editor.setDecorations(decorators.info, infos)
    editor.setDecorations(decorators.exempted, exempt)
}

export function triggerUpdateDecorations() {
    if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
    }
    timeout = setTimeout(updateDecorations, 100)
}
export function registerSCIDecorator(context: ExtensionContext) {
    const decoratorConfig = {
        light: {
            gutterIconPath: context.asAbsolutePath("client/images/light/issues.svg"),
            backgroundColor: "lightblue",
        },
        dark: {
            gutterIconPath: context.asAbsolutePath("client/images/dark/issues.svg"),
            backgroundColor: "darkblue",
        },
        isWholeLine: true
    }
    decorators.info = window.createTextEditorDecorationType(decoratorConfig)
    decoratorConfig.light.backgroundColor = "#f0f000"
    decoratorConfig.dark.backgroundColor = "#404000"
    decorators.warning = window.createTextEditorDecorationType(decoratorConfig)
    decoratorConfig.light.backgroundColor = "lightred"
    decoratorConfig.dark.backgroundColor = "darkred"
    decorators.error = window.createTextEditorDecorationType(decoratorConfig)
    decoratorConfig.light.backgroundColor = "lightgreen"
    decoratorConfig.dark.backgroundColor = "darkgreen"
    decorators.exempted = window.createTextEditorDecorationType(decoratorConfig)

    workspace.onDidChangeTextDocument(event => {
        if (window.activeTextEditor && event.document === window.activeTextEditor.document) {
            triggerUpdateDecorations()
        }
    }, null, context.subscriptions)

    window.onDidChangeActiveTextEditor(() => {
        if (window.activeTextEditor) triggerUpdateDecorations()
    }, null, context.subscriptions)
}

