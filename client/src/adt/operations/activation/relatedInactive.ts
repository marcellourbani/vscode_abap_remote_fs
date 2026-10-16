import type { InactiveObjectElement, InactiveObjectRecord } from "abap-adt-api"

/** Object URI without query, fragment or /source/main suffix */
export const adtObjectUri = (uri: string) =>
  uri
    .replace(/[?#].*$/, "")
    .replace(/\/source\/main$/i, "")
    .replace(/\/+$/, "")

/** Compares object, source and include-context URIs of the same object as equal */
export const sameAdtUri = (left?: string, right?: string) =>
  !!left && !!right && adtObjectUri(left).toLowerCase() === adtObjectUri(right).toLowerCase()

export const objectsOf = (records: InactiveObjectRecord[]): InactiveObjectElement[] =>
  records.flatMap(record => (record.object ? [record.object] : []))

export const findInactive = (records: InactiveObjectRecord[], uri: string) =>
  records.find(record => sameAdtUri(record.object?.["adtcore:uri"], uri))

export const uniqueRecords = (records: (InactiveObjectRecord | undefined)[]) => {
  const result: InactiveObjectRecord[] = []
  for (const record of records) {
    const uri = record?.object?.["adtcore:uri"]
    if (!record || result.some(known => sameAdtUri(known.object?.["adtcore:uri"], uri))) continue
    result.push(record)
  }
  return result
}

/** Inactive parts of a program: the main program, the edited include and the program's includes */
export const inactiveProgramUnit = (
  records: InactiveObjectRecord[],
  mainProgramUri: string,
  includeUris: string[],
  currentIncludeUri?: string
) =>
  uniqueRecords([
    findInactive(records, mainProgramUri),
    currentIncludeUri ? findInactive(records, currentIncludeUri) : undefined,
    ...includeUris.map(uri => findInactive(records, uri))
  ])

/** Inactive objects sharing the parent of the given object, i.e. the parts of a class */
export const inactiveSiblings = (records: InactiveObjectRecord[], uri: string) => {
  const parentUri = findInactive(records, uri)?.object?.["adtcore:parentUri"]
  if (!parentUri || records.length <= 1) return []
  return records.filter(record => sameAdtUri(record.object?.["adtcore:parentUri"], parentUri))
}

/** Whether the list has inactive includes besides the given one, worth a program structure lookup */
export const hasOtherInactiveIncludes = (records: InactiveObjectRecord[], currentUri?: string) =>
  records.some(
    record =>
      record.object?.["adtcore:type"] === "PROG/I" &&
      !sameAdtUri(record.object["adtcore:uri"], currentUri)
  )
