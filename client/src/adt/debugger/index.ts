import { debug, DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, DebugSession, ExtensionContext } from "vscode"
import { AbapConfigurationProvider, DEBUGTYPE } from "./abapConfigurationProvider"
import { AbapDebugSession } from "./abapDebugAdapter";

class AbapDebugAdapterFactory implements DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(session: DebugSession): DebugAdapterDescriptor {
        return new DebugAdapterInlineImplementation(new AbapDebugSession(session));
    }
}
export const registerAbapDebugger = (context: ExtensionContext) => {
    const provider = new AbapConfigurationProvider()
    const factoryReg = debug.registerDebugAdapterDescriptorFactory(DEBUGTYPE, new AbapDebugAdapterFactory())
    context.subscriptions.push(debug.registerDebugConfigurationProvider(DEBUGTYPE, provider))
    context.subscriptions.push(factoryReg)
}