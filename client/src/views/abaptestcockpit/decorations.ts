import { DecorationOptions, ExtensionContext, Position, Range, workspace } from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { atcProvider } from "."
import { AtcFind, hasExemption } from "./view"
let timeout: NodeJS.Timeout | undefined

const empty = window.createTextEditorDecorationType({})
const decorators = {
    error: empty,
    warning: empty,
    info: empty,
    exempted: empty
}


const toDecoration = (m: AtcFind): DecorationOptions =>
    ({ range: new Range(m.start, m.start), hoverMessage: m.finding.messageTitle })

const fileFindings = new Map<string, AtcFind[]>()

/**
 * Get current decoration state for Copilot/AI analysis
 * @param fileUri Optional specific file URI to get decorations for
 * @returns Decoration data for the file(s)
 */
export function getATCDecorations(fileUri?: string) {
    if (fileUri) {
        const findings = fileFindings.get(fileUri) || [];
        return {
            fileUri,
            decorations: findings.map(finding => ({
                line: finding.start.line + 1, // Convert to 1-based for display
                character: finding.start.character + 1,
                priority: finding.finding.priority,
                priorityText: finding.finding.priority === 1 ? 'Error' : 
                             finding.finding.priority === 2 ? 'Warning' : 'Info',
                message: finding.finding.messageTitle,
                checkTitle: finding.finding.checkTitle,
                hasExemption: !!finding.finding.exemptionApproval,
                decorationType: !!finding.finding.exemptionApproval ? 'exempted' :
                               finding.finding.priority === 1 ? 'error' :
                               finding.finding.priority === 2 ? 'warning' : 'info'
            }))
        };
    }
    
    // Return all files with decorations
    const allDecorations: Record<string, any> = {};
    for (const [uri, findings] of fileFindings.entries()) {
        allDecorations[uri] = findings.map(finding => ({
            line: finding.start.line + 1,
            character: finding.start.character + 1,
            priority: finding.finding.priority,
            priorityText: finding.finding.priority === 1 ? 'Error' : 
                         finding.finding.priority === 2 ? 'Warning' : 'Info',
            message: finding.finding.messageTitle,
            checkTitle: finding.finding.checkTitle,
            hasExemption: !!finding.finding.exemptionApproval,
            decorationType: !!finding.finding.exemptionApproval ? 'exempted' :
                           finding.finding.priority === 1 ? 'error' :
                           finding.finding.priority === 2 ? 'warning' : 'info'
        }));
    }
    
    return {
        totalFiles: fileFindings.size,
        totalFindings: Array.from(fileFindings.values()).reduce((sum, findings) => sum + findings.length, 0),
        decorations: allDecorations
    };
}
function updateDecorations() {
    const editor = window.activeTextEditor
    if (!editor) return

    const markers = fileFindings.get(editor.document.uri.toString()) || []
    const exempt = markers.filter(m => hasExemption(m.finding)).map(toDecoration)
    const infos = markers.filter(m => !hasExemption(m.finding) && m.finding.priority !== 2 && m.finding.priority !== 1).map(toDecoration)
    const warnings = markers.filter(m => !hasExemption(m.finding) && m.finding.priority === 2).map(toDecoration)
    const errors = markers.filter(m => !hasExemption(m.finding) && m.finding.priority === 1).map(toDecoration)
    editor.setDecorations(decorators.exempted, exempt)
    editor.setDecorations(decorators.info, infos)
    editor.setDecorations(decorators.warning, warnings)
    editor.setDecorations(decorators.error, errors)
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
            for (const finding of fileFindings.get(event.document.uri.toString()) || []) {
                finding.applyEdits(event.contentChanges)
            }
        }
    }, null, context.subscriptions)

    workspace.onDidSaveTextDocument(event => {
        for (const finding of fileFindings.get(event.uri.toString()) || []) finding.savePosition()

    }, null, context.subscriptions)
    workspace.onDidCloseTextDocument(event => {
        for (const finding of fileFindings.get(event.uri.toString()) || []) finding.cancelEdits()

    }, null, context.subscriptions)

     window.onDidChangeActiveTextEditor(() => {
         if (window.activeTextEditor) triggerUpdateDecorations()
     }, null, context.subscriptions)
    atcProvider.onDidChangeTreeData(() => {
        const findings = atcProvider.findings()
        fileFindings.clear()
        for (const finding of findings) {
            const current = fileFindings.get(finding.uri)
            if (current) current.push(finding)
            else fileFindings.set(finding.uri, [finding])
        }
        triggerUpdateDecorations()
    })
}

