interface UsageReferenceLike {
  objectIdentifier?: string
  isResult?: boolean | string
  uri?: string
  "adtcore:name"?: string
  "adtcore:type"?: string
}

export function normalizeUsageReferences<Reference extends UsageReferenceLike>(
  references: readonly Reference[]
): (Reference & { fullName: string })[] {
  const result: (Reference & { fullName: string })[] = []
  for (const reference of references) {
    if (reference.isResult === false || reference.isResult === "false") continue
    const parts = reference.objectIdentifier?.split(";")
    const sourceName = parts?.[0] === "ABAPFullName" ? parts[1]?.trim() : undefined
    const metadataResult =
      (reference.isResult === true || reference.isResult === "true") &&
      reference["adtcore:type"]?.trim() &&
      reference.uri?.trim()
    const fullName = sourceName || (metadataResult ? reference["adtcore:name"]?.trim() : undefined)
    if (fullName) result.push({ ...reference, fullName })
  }
  return result
}
