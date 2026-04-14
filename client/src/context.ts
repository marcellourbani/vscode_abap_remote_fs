import { commands } from "vscode"

export type AbapFsContexts =
  | "abapfs:showActivate"
  | "abapfs:atc:autorefreshOn"
  | "abapfs:atc:exemptFilterOn"
  | "abapfs:atcdoc:navigation:back"
  | "abapfs:atcdoc:navigation:next"
  | "abapfs:extensionActive"
  | "abapfs:showTableContentIcon"
  | "abapfs:enableLeftPrevRev"
  | "abapfs:enableLeftNextRev"
  | "abapfs:enableRightPrevRev"
  | "abapfs:enableRightNextRev"
  | "abapfs:blameActive"
  | "abapfs:blameAvailable"
  | "abapfs:activeEditorIsTable"

export const setContext = (key: AbapFsContexts, value: unknown) =>
  commands.executeCommand("setContext", key, value)
