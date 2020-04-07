import { Adapter } from "./adapter"
import { ExtensionContext, extensions, workspace, Uri } from "vscode"
import { testExplorerExtensionId, TestHub } from "vscode-test-adapter-api"
import { ADTSCHEME } from "../../adt/AdtServer"

const testAdapters = new Map<string, Adapter>()

export function getTestAdapter(uri: Uri) {
  if (uri.scheme !== ADTSCHEME) return
  const ext = extensions.getExtension<TestHub>(testExplorerExtensionId)
  if (!ext?.isActive) return
  let adapter = testAdapters.get(uri.authority)
  if (!adapter) {
    adapter = new Adapter(uri.authority)
    ext.exports.registerTestAdapter(adapter)
  }
  return adapter
}
