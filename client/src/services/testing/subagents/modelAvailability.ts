export interface LanguageModelMetadata {
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
