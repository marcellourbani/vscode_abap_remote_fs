/**
 * RAP Generator ADT API — Type definitions
 *
 * Pure TypeScript types with no VS Code dependencies.
 */

export interface RapGeneratorMetadata {
  package: string
  masterLanguage?: string
}

export interface RapGeneratorGeneral {
  referenceObjectName?: string
  description: string
}

export interface RapGeneratorDataModelEntity {
  cdsName: string
  entityName?: string
}

export interface RapGeneratorBehavior {
  implementationType: string
  implementationClass: string
  draftTable: string
}

export interface RapGeneratorBusinessObject {
  dataModelEntity: RapGeneratorDataModelEntity
  behavior: RapGeneratorBehavior
}

export interface RapGeneratorServiceProjection {
  name: string
}

export interface RapGeneratorServiceDefinition {
  name: string
}

export interface RapGeneratorServiceBinding {
  name: string
  bindingType: string
}

export interface RapGeneratorBusinessService {
  serviceDefinition: RapGeneratorServiceDefinition
  serviceBinding: RapGeneratorServiceBinding
}

export interface RapGeneratorContent {
  metadata?: RapGeneratorMetadata
  general: RapGeneratorGeneral
  businessObject: RapGeneratorBusinessObject
  serviceProjection: RapGeneratorServiceProjection
  businessService: RapGeneratorBusinessService
}

export interface RapGeneratorValidationResult {
  severity: "ok" | "error" | "warning" | "info"
  shortText: string
  longText?: string
}

export interface RapGeneratorPreviewObject {
  uri: string
  type: string
  name: string
  description: string
}

export type RapGeneratorBindingType =
  | "OData V2 - UI"
  | "OData V2 - Web API"
  | "OData V4 - UI"
  | "OData V4 - Web API"

export const BINDING_TYPES: RapGeneratorBindingType[] = [
  "OData V4 - UI",
  "OData V4 - Web API",
  "OData V2 - UI",
  "OData V2 - Web API"
]

export type RapGeneratorId = "uiservice" | "webapiservice"
