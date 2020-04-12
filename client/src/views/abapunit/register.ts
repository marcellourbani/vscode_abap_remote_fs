import { Adapter } from "./testAdapter"
import { extensions, Uri } from "vscode"
import { testExplorerExtensionId, TestHub } from "vscode-test-adapter-api"
import { ADTSCHEME } from "../../adt/AdtServer"
import { context } from "../../extension"
const testAdapters = new Map<string, Adapter>()

export function getTestAdapter(uri: Uri) {
  if (uri.scheme !== ADTSCHEME) return
  const ext = extensions.getExtension<TestHub>(testExplorerExtensionId)
  if (!ext?.isActive) return
  const { authority: key } = uri
  let adapter = testAdapters.get(key)
  if (!adapter) {
    adapter = new Adapter(key)
    ext.exports.registerTestAdapter(adapter)
    testAdapters.set(key, adapter)
    context.subscriptions.push({
      dispose: () => {
        ext.exports.unregisterTestAdapter(adapter!)
        testAdapters.delete(key)
      }
    })
  }
  return adapter
}
