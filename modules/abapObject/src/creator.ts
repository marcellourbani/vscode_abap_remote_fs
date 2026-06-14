import { AbapObjectBase, AbapObjectConstructor, AbapObject } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { Node } from "abap-adt-api"
import { AbapObjectError } from "./AOError"

import { AbapClass } from "./objectTypes/AbapClass"
import { AbapClassInclude } from "./objectTypes/AbapClassInclude"
import { AbapCds } from "./objectTypes/AbapCds"
import { AbapInclude } from "./objectTypes/AbapInclude"
import { AbapInterface } from "./objectTypes/AbapInterface"
import { AbapFunction } from "./objectTypes/AbapFunction"
import { AbapFunctionGroup } from "./objectTypes/AbapFunctionGroup"
import { AbapProgram } from "./objectTypes/AbapProgram"
import { AbapSimple } from "./objectTypes/AbapSimple"
import { AbapXml } from "./objectTypes/AbapXml"

import { getObjectTypeConfig } from "./registry"

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
