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
  nodes: ObjectNode[]
  categories: Map<string, CategoryNode>
  objectTypes: Map<string, ObjectTypeNode>
}
