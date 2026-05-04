import { CreatableTypes, CreatableType, CreatableTypeIds } from "abap-adt-api"

export const BDEF_TYPE_ID = "BDEF/BDO" as CreatableTypeIds

const bdefType: CreatableType = {
  creationPath: "bo/behaviordefinitions",
  validationPath: "bo/behaviordefinitions/validation",
  rootName: "blue:blueSource",
  nameSpace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
  label: "Behavior Definition",
  typeId: BDEF_TYPE_ID,
  maxLen: 30
}

export function registerBdefType() {
  if (!CreatableTypes.has(BDEF_TYPE_ID)) {
    CreatableTypes.set(BDEF_TYPE_ID, bdefType)
  }
}
