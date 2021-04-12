import { debug, DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, DebugConfigurationProviderTriggerKind, DebugSession, ExtensionContext } from "vscode"
import { AbapConfigurationProvider, DEBUGTYPE } from "./abapConfigurationProvider"
import { AbapDebugSession, AbapDebugSessionCfg } from "./abapDebugAdapter";

class AbapDebugAdapterFactory implements DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(session: AbapDebugSessionCfg): DebugAdapterDescriptor {
        return new DebugAdapterInlineImplementation(new AbapDebugSession(session));
    }
}
export const registerAbapDebugger = (context: ExtensionContext) => {
    const provider = new AbapConfigurationProvider()
    const providerReg = debug.registerDebugConfigurationProvider(DEBUGTYPE, provider, DebugConfigurationProviderTriggerKind.Dynamic)
    const factoryReg = debug.registerDebugAdapterDescriptorFactory(DEBUGTYPE, new AbapDebugAdapterFactory())
    context.subscriptions.push(factoryReg, providerReg)
}