import { MainInclude } from "abap-adt-api"
import { getAllConfigs } from "abapobject"

type TypeLabel = string | ((mainProgram?: MainInclude) => string)

const TYPE_LABELS: Record<string, TypeLabel> = {}
for (const config of getAllConfigs()) {
  TYPE_LABELS[config.type] = config.label
}


export const OBJECT_TYPE_FILTER_OPTIONS = [
  { type: "PROG/P", label: "Programs (Reports)" },
  { type: "PROG/I", label: "Includes" },
  { type: "CLAS/OC", label: "Classes" },
  { type: "INTF/OI", label: "Interfaces" },
  { type: "FUGR/F", label: "Function Groups" },
  { type: "FUGR/FF", label: "Function Modules" },
  { type: "TYPE/TY", label: "Type Groups" },
  { type: "TABL/DT", label: "Database Tables" },
  { type: "TABL/DS", label: "Structures" },
  { type: "DTEL/DE", label: "Data Elements" },
  { type: "DOMA/DD", label: "Domains" },
  { type: "TTYP/DA", label: "Table Types" },
  { type: "VIEW/DV", label: "Views" },
  { type: "SHLP/DH", label: "Search Helps" },
  { type: "ENQU/DL", label: "Lock/Enqueue Objects" },
  { type: "DDLS/DF", label: "CDS Data Definitions" },
  { type: "STOB/DO", label: "CDS Entities" },
  { type: "MSAG/N", label: "Message Classes" },
  { type: "TRAN/T", label: "Transactions" },
  { type: "DEVC/K", label: "Packages" },
  { type: "ENHO/XHB", label: "Enhancement Implementations" },
  { type: "ENHO/XHH", label: "Enhancement Implementations" },
  { type: "ENHS/XS", label: "Enhancement Spots" },
  { type: "SXSD/XD", label: "BAdI Definitions" },
  { type: "SXCI/XI", label: "BAdI Implementations" },
  { type: "XSLT/XT", label: "XSLT Programs" },
  { type: "STOB/ST", label: "Simple Transformations" },
  { type: "SUSO/SO", label: "Authorization Objects" },
  { type: "SUSO/B", label: "Authorization Object Sets" },
  { type: "SUSC/SC", label: "Authorization Object Classes" },
  { type: "PINF/PI", label: "Package Interfaces" },
  { type: "NROB/NR", label: "Number Range Objects" }
]

export function getObjectTypeLabel(type: string, mainProgram?: MainInclude): string {
  const entry = TYPE_LABELS[type]
  if (!entry) return type
  return typeof entry === "function" ? entry(mainProgram) : entry
}

export function getCombinedObjectTypeLabel(type: string, mainProgram?: MainInclude): string {
  const label = getObjectTypeLabel(type, mainProgram)
  return label === type ? type : `${label} (${type})`
}