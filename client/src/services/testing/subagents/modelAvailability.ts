export interface LanguageModelMetadata {
  id?: string
  name: string
  family: string
}

export function isAutoLanguageModel(model: LanguageModelMetadata): boolean {
  return (
    (model.name ?? "").toLowerCase() === "auto" || (model.family ?? "").toLowerCase() === "auto"
  )
}

export function hasReadyLanguageModels(models: readonly LanguageModelMetadata[]): boolean {
  return models.some(model => !isAutoLanguageModel(model))
}

export function resolveModel<T extends LanguageModelMetadata>(
  selection: string | undefined,
  availableModels: readonly T[]
): T | undefined {
  const value = selection?.trim()
  if (!value) return undefined

  const byId = availableModels.find(model => model.id === value)
  if (byId) return byId

  const byName = availableModels.filter(model => model.name === value)
  return byName.length === 1 ? byName[0] : undefined
}
