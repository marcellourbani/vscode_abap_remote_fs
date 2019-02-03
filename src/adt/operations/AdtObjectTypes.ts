import { CreatableType, CreatableTypes, parentTypeId } from "abap-adt-api"
import { window } from "vscode"

export const PACKAGE = "DEVC/K"

export async function selectObjectType(
  parentType?: string
): Promise<CreatableType | undefined> {
  const rawtypes = [...CreatableTypes.values()]
  const types = parentType
    ? rawtypes.filter(t => parentTypeId(t.typeId) === parentType)
    : rawtypes
  return window.showQuickPick(types || rawtypes)
}
