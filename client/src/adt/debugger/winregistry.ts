import { extensions } from "vscode";
import { GetStringRegKey } from "vscode-windows-registry";
const winregistryExtensionId = "murbani.winregistry"

export function getWinRegistryReader() {
    const ext = extensions.getExtension<{ GetStringRegKey: typeof GetStringRegKey }>(winregistryExtensionId)
    if (!ext?.isActive) return
    return ext.exports.GetStringRegKey
}