import { debug, DebugConfigurationProviderTriggerKind, DebugSession, ExtensionContext } from "vscode"
import { AbapConfigurationProvider, DEBUGTYPE } from "./abapConfigurationProvider"
import { AbapDebugAdapterFactory } from "./AbapDebugAdapterFactory"

export const LogOutPendingDebuggers = () => AbapDebugAdapterFactory.instance.closeSessions()

export const registerAbapDebugger = (context: ExtensionContext) => {
    const provider = new AbapConfigurationProvider()
    const providerReg = debug.registerDebugConfigurationProvider(DEBUGTYPE, provider, DebugConfigurationProviderTriggerKind.Dynamic)
    const factoryReg = debug.registerDebugAdapterDescriptorFactory(DEBUGTYPE, AbapDebugAdapterFactory.instance)
    context.subscriptions.push(factoryReg, providerReg)
}