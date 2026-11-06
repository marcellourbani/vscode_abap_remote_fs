interface UsageReferenceLike {
  objectIdentifier?: string
  isResult?: boolean | string
  usageInformation?: string
  parentUri?: string
  uri?: string
  "adtcore:name"?: string
  "adtcore:type"?: string
}

export function normalizeUsageReferences<Reference extends UsageReferenceLike>(
  references: readonly Reference[]
): (Reference & { fullName: string })[] {
  const result: (Reference & { fullName: string })[] = []
  for (const reference of references) {
    const parts = reference.objectIdentifier?.split(";")
    const sourceName = parts?.[0] === "ABAPFullName" ? parts[1]?.trim() : undefined
    const explicitlyNotResult = reference.isResult === false || reference.isResult === "false"
    if (explicitlyNotResult && !(sourceName && reference.usageInformation?.trim())) continue
    const isPackageParent = reference.parentUri?.includes("/devck/") ?? false
    const parentName = !isPackageParent
      ? reference.parentUri?.split(/[/?#]/).filter(Boolean).pop()?.toUpperCase()
      : undefined
    const metadataResult =
      (reference.isResult === true || reference.isResult === "true") &&
      reference["adtcore:type"]?.trim() &&
      reference.uri?.trim()
    const fullName =
      parentName || sourceName || (metadataResult ? reference["adtcore:name"]?.trim() : undefined)
    if (fullName) result.push({ ...reference, fullName })
  }
  return result
}
