/** Data types for S/4HANA Readiness Dashboard */

export interface SimplificationItem {
  id: string
  version: string
  title: string
  note: number
  replacementId: string
}

export interface CustomReference {
  extractionSysid: string
  extractionName: string
  referenceKind: string
  hash: string
  refObjType: string
  refObjName: string
  refSubType: string
  refSubName: string
  refIntType: string
  refIntName: string
  objType: string
  objName: string
  subType: string
  subName: string
  includeName: string
  devclass: string
  genflag: string
  dlvunit: string
  refApplComponent: string
}

export interface PiecelistEntry {
  piecelistId: string
  pgmid: string
  objectType: string
  objectName: string
  packageName: string
  applicationComponent: string
}

export interface ItemPiecelistLink {
  id: string
  version: string
  piecelistId: string
}

/** A custom reference enriched with its linked simplification item */
export interface EnrichedReference {
  ref: CustomReference
  item: SimplificationItem | undefined
}

/** Grouped data ready for tree rendering */
export interface GroupedData {
  /** Items that have matching custom references */
  groups: ItemGroup[]
  /** References that couldn't be linked to any simplification item */
  ungrouped: CustomReference[]
  /** Total reference count */
  totalRefs: number
}

export interface ItemGroup {
  item: SimplificationItem
  refs: CustomReference[]
}
