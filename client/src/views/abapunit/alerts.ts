import { UnitTestSeverity, UnitTestAlert, UnitTestClass } from "abap-adt-api"
import { DiagnosticSeverity, Range, Position, Diagnostic } from "vscode"
import { AdtServer } from "../../adt/AdtServer"

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

export const convertTestAlert = async (
  server: AdtServer,
  alrt: UnitTestAlert,
  maxSeverity = DiagnosticSeverity.Warning
) => {
  const severity = convertSeverity(alrt.severity)
  if (severity > maxSeverity) return
  const [error] = alrt.stack
  const { uri, start } = await server.objectFinder.vscodeRange(
    error["adtcore:uri"]
  )
  if (!start) return
  const range = new Range(start, new Position(start.line, 1000))
  const diagnostic = new Diagnostic(range, alrt.details.join("\n"), severity)
  diagnostic.source = `Abap Unit ${server.connectionId}`
  return { uri, diagnostic }
}

export const classesAlerts = async (
  testClasses: UnitTestClass[],
  server: AdtServer
) => {
  const newAlerts = new Map<string, Diagnostic[]>()
  // ToDo: clear old alerts
  for (const clas of testClasses)
    for (const method of clas.testmethods) {
      for (const alrt of method.alerts) {
        const { uri, diagnostic } = (await convertTestAlert(server, alrt)) || {}
        if (uri && diagnostic) {
          const fileDiags = newAlerts.get(uri) || []
          if (fileDiags.length === 0) newAlerts.set(uri, fileDiags)
          fileDiags.push(diagnostic)
        }
      }
    }
  return newAlerts
}
