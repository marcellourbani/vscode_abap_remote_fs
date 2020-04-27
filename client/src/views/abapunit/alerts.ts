import {
  UnitTestSeverity,
  UnitTestAlert,
  UnitTestClass,
  UnitTestMethod
} from "abap-adt-api"
import {
  DiagnosticSeverity,
  Range,
  Position,
  Diagnostic,
  languages,
  DiagnosticCollection,
  Uri,
  workspace
} from "vscode"
import { cache } from "../../lib"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"

export const convertSeverity = (s: UnitTestSeverity) => {
  switch (s) {
    case UnitTestSeverity.critical:
    case UnitTestSeverity.fatal:
      return DiagnosticSeverity.Error
    case UnitTestSeverity.tolerable:
      return DiagnosticSeverity.Warning
    case UnitTestSeverity.tolerant:
      return DiagnosticSeverity.Information
  }
}

const convertTestAlert = async (
  connId: string,
  alrt: UnitTestAlert,
  maxSeverity = DiagnosticSeverity.Warning
) => {
  const severity = convertSeverity(alrt.severity)
  if (severity > maxSeverity) return
  const [error] = alrt.stack
  const { uri, start } = await new AdtObjectFinder(connId).vscodeRange(
    error["adtcore:uri"]
  )
  if (!start) return
  const range = new Range(start, new Position(start.line, 1000))
  const diagnostic = new Diagnostic(range, alrt.details.join("\n"), severity)
  diagnostic.source = `Abap Unit ${connId}`
  return { uri, diagnostic }
}

const classesAlerts = async (testClasses: UnitTestClass[], connId: string) => {
  const newAlerts = new Map<string, Diagnostic[]>()
  // ToDo: clear old alerts
  for (const clas of testClasses)
    for (const method of clas.testmethods) {
      for (const alrt of method.alerts) {
        const { uri, diagnostic } = (await convertTestAlert(connId, alrt)) || {}
        if (uri && diagnostic) {
          const fileDiags = newAlerts.get(uri) || []
          if (fileDiags.length === 0) newAlerts.set(uri, fileDiags)
          fileDiags.push(diagnostic)
        }
      }
    }
  return newAlerts
}

class AbapUnitAlertsManager {
  private alerts: DiagnosticCollection
  constructor(private connId: string) {
    this.alerts = languages.createDiagnosticCollection(
      `Abap Unit ${this.connId}`
    )

    workspace.onDidCloseTextDocument(d => {
      const uri = d.uri
      if (this.alerts.has(uri)) this.alerts.set(uri, [])
    })
  }

  public update(testClasses: UnitTestClass[], withSummary = false) {
    return classesAlerts(testClasses, this.connId).then(clAlerts => {
      this.alerts.clear()

      for (const [uri, diags] of clAlerts) {
        if (withSummary) {
          const start = new Position(0, 0)
          const range = new Range(start, start)
          const methods = testClasses
            .map(c => c.testmethods.length)
            .reduce((x, y) => x + y, 0)
          const methodFailed = (m: UnitTestMethod) =>
            m.alerts.find(
              a => convertSeverity(a.severity) === DiagnosticSeverity.Error
            )
          const failed = testClasses
            .map(c => c.testmethods.filter(methodFailed).length)
            .reduce((x, y) => x + y, 0)

          const summary: Diagnostic = {
            message: `ABAP Unit results:${testClasses.length} test classes ${methods} methods ${failed} failed`,
            severity: DiagnosticSeverity.Information,
            range
          }
          diags.unshift(summary)
        }
        this.alerts.set(Uri.parse(uri), diags)
      }
    })
  }
}

export const alertManagers = cache(
  (conn: string) => new AbapUnitAlertsManager(conn)
)
