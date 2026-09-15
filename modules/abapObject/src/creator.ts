import { AbapObjectBase, type AbapObjectConstructor, type AbapObject } from "./AbapObject.js"
import { type AbapObjectService } from "./AOService.js"
import { type Node } from "abap-adt-api"
import { AbapObjectError } from "./AOError.js"

import { AbapClass } from "./objectTypes/AbapClass.js"
import { AbapClassInclude } from "./objectTypes/AbapClassInclude.js"
import { AbapCds } from "./objectTypes/AbapCds.js"
import { AbapInclude } from "./objectTypes/AbapInclude.js"
import { AbapInterface } from "./objectTypes/AbapInterface.js"
import { AbapFunction } from "./objectTypes/AbapFunction.js"
import { AbapFunctionGroup } from "./objectTypes/AbapFunctionGroup.js"
import { AbapProgram } from "./objectTypes/AbapProgram.js"
import { AbapSimple } from "./objectTypes/AbapSimple.js"
import { AbapXml } from "./objectTypes/AbapXml.js"

import { getObjectTypeConfig } from "./registry.js"

const classMap: Record<string, AbapObjectConstructor> = {
  AbapClass,
  AbapClassInclude,
  AbapCds,
  AbapInclude,
  AbapInterface,
  AbapFunction,
  AbapFunctionGroup,
  AbapProgram,
  AbapSimple,
  AbapXml
}

export const create = (
  type: string,
  name: string,
  path: string,
  expandable: boolean,
  techName: string,
  parent: AbapObject | undefined,
  sapguiUri: string,
  client: AbapObjectService,
  owner = ""
) => {
  if (!type || !path)
    throw new AbapObjectError(
      "Invalid",
      undefined,
      "Abap Object can't be created without a type and path"
    )
  const config = getObjectTypeConfig(type)
  const creatorClass = config?.creatorClass
  const cons = (creatorClass && classMap[creatorClass]) || AbapObjectBase
  return new cons(type, name, path, expandable, techName, parent, sapguiUri, client, owner)
}

export const fromNode = (node: Node, parent: AbapObject | undefined, client: AbapObjectService) =>
  create(
    node.OBJECT_TYPE,
    node.OBJECT_NAME,
    node.OBJECT_URI,
    !!node.EXPANDABLE,
    node.TECH_NAME,
    parent,
    node.OBJECT_VIT_URI,
    client
  )
