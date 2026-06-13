import { getAllConfigs } from "abapobject"

export * from "./functions"
export * from "./externalmodules"
export * from "./logger"
export * from "./vscodefunctions"
export * from "./rfsTaskEither"
export const viewableObjecttypes: Set<string | undefined> = new Set(
  getAllConfigs()
    .filter(config => config.viewable)
    .map(config => config.type)
)
