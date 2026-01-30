import { AbapObject } from "."

const errorTag = Symbol("abapObjectError")
export type Kind =
  | "StructureNotLoaded"
  | "NoStructure"
  | "NotLeaf"
  | "NoChildren"
  | "NotSupported"
  | "Invalid"

export class AbapObjectError extends Error {
  [errorTag]: true
  constructor(
    readonly kind: Kind,
    readonly sourceObject: AbapObject | undefined,
    message: string
  ) {
    super(message)
    this[errorTag] = true
  }
}

export const isAbapObjectError = (x: any): x is AbapObjectError => {
  const foo = x?.[errorTag]
  return !!foo
}

export const ObjectErrors = {
  isLeaf: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "NoChildren",
      o,
      message || `Object ${o.key} can't have children`
    ),
  noStructure: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "NoStructure",
      o,
      message || `Unable to retrieve metadata for ${o.key}`
    ),
  notLeaf: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "NotLeaf",
      o,
      message || `Object ${o.key} is not a leaf type and can't be read/written`
    ),
  notLoaded: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "StructureNotLoaded",
      o,
      message || `Structure of object ${o.key} not loaded yet`
    ),
  NotSupported: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "NotSupported",
      o,
      message || `Operation not supported for object ${o.key}`
    ),
  Invalid: (o: AbapObject, message?: string) =>
    new AbapObjectError(
      "Invalid",
      o,
      message || `Invalid data returned for object ${o.key}`
    )
}
