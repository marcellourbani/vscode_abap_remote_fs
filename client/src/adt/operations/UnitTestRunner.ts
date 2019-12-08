import {
  DiagnosticCollection,
  Uri,
  Diagnostic,
  DiagnosticSeverity,
  Range,
  Position,
  languages,
  commands
} from "vscode"
import { fromUri } from "../AdtServer"
import { parts, toInt, mapGet } from "../../helpers/functions"
import {
  UnitTestSeverity,
  UnitTestAlert,
  UnitTestStackEntry
} from "abap-adt-api"

let abapUnitcollection: DiagnosticCollection

const createDiag = (
  text: string,
  line: number,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error
): Diagnostic => {
  const diag = new Diagnostic(
    new Range(new Position(line, 0), new Position(line, 1000)),
    text,
    severity
  )
  diag.source = "ABAP Unit"
  return diag
}

async function abapUnitMain(uri: Uri) {
  const rv = {
    classes: 0,
    methods: 0,
    failed: 0,
    diag: new Map<string, Diagnostic[]>()
  }
  const uriTranslation: Map<string, string> = new Map()
  const server = fromUri(uri)
  if (!server) return

  async function basetovsc(url: string) {
    const [base, line] = parts(url, /([^#]*)(?:#.*start=([\d]+))?/)
    let decoded = uriTranslation.get(base)
    if (!decoded) {
      const finder = server.objectFinder
      decoded = await finder.vscodeUri(base, true)
      decoded = Uri.parse(decoded).toString() // to encode parts
      uriTranslation.set(base, decoded)
    }
    return {
      uri: decoded,
      line: line ? toInt(line) - 1 : 0
    }
  }
  async function addDiag(
    alert: UnitTestAlert,
    entry: UnitTestStackEntry,
    last = false
  ) {
    if (!entry) return
    const decoded = await basetovsc(entry["adtcore:uri"])
    if (!decoded.uri) return
    const curdiag = mapGet(rv.diag, decoded.uri, [])
    let description = alert.details.join("\n")
    if (last) description = "Exception source for\n" + description
    curdiag.push(createDiag(description, decoded.line))
  }

  const object = await server.findAbapObject(uri)
  const results = await server.client.runUnitTest(object.path)
  rv.classes = results.length

  for (const clas of results) {
    rv.methods += clas.testmethods.length
    for (const meth of clas.testmethods) {
      // a method failed if it has at least a valid link
      const alerts = meth.alerts.filter(
        alert =>
          alert.severity !== UnitTestSeverity.tolerable &&
          alert.stack.length > 0
      )
      if (alerts.length) rv.failed++
      for (const alert of alerts) {
        const [entry] = alert.stack.slice(-1)
        await addDiag(alert, entry)
        if (alert.stack.length > 1) await addDiag(alert, alert.stack[0], true)
      }
    }
  }
  return rv
}
let lastUtUri: Uri | undefined
export function clearUTResultsIfLastRun(uri: Uri) {
  if (!lastUtUri) return
  if (uri.toString() !== lastUtUri.toString()) return
  lastUtUri = undefined
  if (abapUnitcollection) abapUnitcollection.clear()
}
export async function abapUnit(uri: Uri) {
  lastUtUri = uri
  if (!abapUnitcollection)
    abapUnitcollection = languages.createDiagnosticCollection(
      "ABAPfs unit test"
    )
  else abapUnitcollection.clear()
  const results = await abapUnitMain(uri)
  if (results) {
    const diagnostics = mapGet(results.diag, uri.toString(), [])
    diagnostics.unshift(
      createDiag(
        `ABAP Unit results:${results.classes} test classes ${
          results.methods
        } methods ${results.failed} failed`,
        0,
        DiagnosticSeverity.Information
      )
    )
    if (lastUtUri === uri) {
      for (const entry of results.diag)
        abapUnitcollection.set(Uri.parse(entry[0]), entry[1])
      if (results.failed) commands.executeCommand("workbench.action.keepEditor")
    }
  }
}
