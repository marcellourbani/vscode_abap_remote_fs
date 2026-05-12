/**
 * Test OData Service command
 *
 * Opens the published OData service URL in the browser for quick testing.
 */

import { env, Uri, window, commands } from "vscode"
import { pickAdtRoot, RemoteManager } from "../config"
import { getOrCreateClient, uriRoot, ADTSCHEME } from "../adt/conections"
import { parseServiceBinding, servicePreviewUrl } from "abap-adt-api"
import { caughtToString } from "../lib"
import { isAbapStat } from "abapfs"

export async function testServiceBindingCommand() {
  try {
    const editor = window.activeTextEditor
    let defaultName = ""
    let connId = ""

    // Try to detect from active editor
    if (editor?.document.uri.scheme === ADTSCHEME) {
      const uri = editor.document.uri
      connId = uri.authority
      try {
        const root = uriRoot(uri)
        const file = root.getNode(uri.path)
        if (isAbapStat(file) && file.object.type === "SRVB/SVB") {
          defaultName = file.object.name
        }
      } catch { /* ignore */ }
    }

    if (!connId) {
      const root = await pickAdtRoot()
      if (!root) return
      connId = root.uri.authority
    }

    const srvbName = defaultName || await window.showInputBox({
      prompt: "Enter the service binding name",
      placeHolder: "e.g. ZUI_MY_SERVICE_O4",
      ignoreFocusOut: true,
      validateInput: v => v?.trim() ? null : "Service binding name is required"
    })
    if (!srvbName) return

    const client = await getOrCreateClient(connId)

    await window.withProgress(
      { location: { viewId: "workbench.panel.output" }, title: `Loading service binding ${srvbName}...` },
      async () => {
        // Read binding XML and parse using abap-adt-api
        const bindingUrl = `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(srvbName.toLowerCase())}`
        const resp = await client.httpClient.request(bindingUrl, {
          method: "GET",
          headers: { Accept: "application/*" }
        })
        const binding = parseServiceBinding(resp.body)

        if (binding.services.length === 0) {
          window.showWarningMessage(`No services found in binding ${srvbName}. Has it been generated?`)
          return
        }

        if (!binding.published) {
          const publish = await window.showWarningMessage(
            `Service ${srvbName} is not published. Publish it now?`,
            "Publish", "Cancel"
          )
          if (publish === "Publish") {
            commands.executeCommand("abapfs.publishServiceBinding")
          }
          return
        }

        // Get binding details (service URLs, collections)
        const details = await client.bindingDetails(binding)

        if (details.services.length === 0) {
          window.showWarningMessage(`No service details available for ${srvbName}`)
          return
        }

        // Pick service if multiple
        let service = details.services[0]
        if (details.services.length > 1) {
          const pick = await window.showQuickPick(
            details.services.map(s => ({
              label: s.serviceId,
              description: `v${s.serviceVersion}`,
              service: s
            })),
            { placeHolder: "Select service to test" }
          )
          if (!pick) return
          service = pick.service
        }

        // Build the service URL
        const config = RemoteManager.get().byId(connId)
        if (!config) {
          window.showErrorMessage(`Connection config not found for ${connId}`)
          return
        }
        let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, "")
        if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl

        let serviceUrl = service.serviceInformation?.url || service.serviceUrl
        if (!serviceUrl) {
          // Standard SAP URL convention fallback
          const isV4 = binding.binding.version === "V4"
          serviceUrl = isV4
            ? `${baseUrl}/sap/opu/odata4/sap/${service.serviceId.toLowerCase()}/0001/`
            : `${baseUrl}/sap/opu/odata/sap/${service.serviceId}/`
        } else if (!serviceUrl.startsWith("http")) {
          serviceUrl = `${baseUrl}${serviceUrl}`
        }

        // Auth params
        const authParams = `sap-client=${config.client}&sap-language=${config.language || "EN"}&saml2=disabled`
        const metadataUrl = `${serviceUrl}$metadata?${authParams}`
        const sep = serviceUrl.includes("?") ? "&" : "?"
        serviceUrl += `${sep}${authParams}`

        // Build Fiori preview URL if collections and URL available
        const previewUrl = service.serviceInformation?.url && service.serviceInformation?.collection?.length
          ? servicePreviewUrl(service, service.serviceInformation.collection[0].name)
          : undefined

        // Show options
        const options: Array<{ label: string; description: string; action: string }> = [
          { label: "$(globe) Open Service Document", description: serviceUrl, action: "open" },
          { label: "$(json) Open $metadata", description: metadataUrl, action: "metadata" },
          { label: "$(clippy) Copy Service URL", description: "Copy to clipboard", action: "copy" },
        ]
        if (previewUrl) {
          options.push({ label: "$(preview) Fiori Elements Preview", description: "Open in ADT preview", action: "preview" })
        }

        const action = await window.showQuickPick(options, {
          placeHolder: `Service: ${service.serviceId} v${service.serviceVersion}`
        })

        if (!action) return

        switch (action.action) {
          case "open":
            env.openExternal(Uri.parse(serviceUrl))
            break
          case "metadata":
            env.openExternal(Uri.parse(metadataUrl))
            break
          case "copy":
            env.clipboard.writeText(serviceUrl)
            window.showInformationMessage(`Service URL copied to clipboard`)
            break
          case "preview":
            if (previewUrl) env.openExternal(Uri.parse(previewUrl))
            break
        }
      }
    )
  } catch (e: any) {
    window.showErrorMessage(`Service test failed: ${caughtToString(e)}`)
  }
}
