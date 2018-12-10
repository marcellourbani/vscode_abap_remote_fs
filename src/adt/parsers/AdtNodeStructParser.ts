import { getNode, recxml2js, parseToPromise } from "./AdtParserBase"

import { mapWith, ArrayToMap, filterComplex, defaultVal } from "../../functions"
import { convertableToString } from "xml2js"

export interface ObjectNode {
  OBJECT_TYPE: string
  OBJECT_NAME: string
  TECH_NAME: string
  OBJECT_URI: string
  OBJECT_VIT_URI: string
  EXPANDABLE: string
}

interface CategoryNode {
  CATEGORY: string
  CATEGORY_LABEL: string
}

interface ObjectTypeNode {
  OBJECT_TYPE: string
  CATEGORY_TAG: string
  OBJECT_TYPE_LABEL: string
  NODE_ID: string
}

export interface NodeStructure {
  nodes: Array<ObjectNode>
  categories: Map<string, CategoryNode>
  objectTypes: Map<string, ObjectTypeNode>
}

const treecontentParser = defaultVal(
  [],
  getNode(
    "asx:abap/asx:values/DATA/TREE_CONTENT/SEU_ADT_REPOSITORY_OBJ_NODE",
    filterComplex(true),
    mapWith(recxml2js)
  )
) as (xml: string) => Array<ObjectNode>
const categoryNodeParser: (a: string) => Map<string, CategoryNode> = defaultVal(
  new Map(),
  getNode(
    "asx:abap/asx:values/DATA/CATEGORIES",
    filterComplex(true),
    "SEU_ADT_OBJECT_CATEGORY_INFO",
    mapWith(recxml2js),
    ArrayToMap("CATEGORY")
  )
)

const ObjectTypeParser: (a: string) => Map<string, ObjectTypeNode> = defaultVal(
  new Map(),
  getNode(
    "asx:abap/asx:values/DATA/OBJECT_TYPES",
    filterComplex(true),
    "SEU_ADT_OBJECT_TYPE_INFO",
    mapWith(recxml2js),
    ArrayToMap("OBJECT_TYPE")
  )
)

export const parseNode: (
  rawpayload: convertableToString
) => Promise<NodeStructure> = parseToPromise((payload: any) => {
  return {
    nodes: treecontentParser(payload),
    categories: categoryNodeParser(payload),
    objectTypes: ObjectTypeParser(payload)
  }
})
