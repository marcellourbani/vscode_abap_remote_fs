import { MainInclude } from "abap-adt-api"

type TypeLabel = string | ((mainProgram?: MainInclude) => string)

const TYPE_LABELS: Record<string, TypeLabel> = {
  "CLAS/OC": "Class",
  "CLAS/OM": "Class Method",
  "INTF/OI": "Interface",
  "PROG/P": "Program",
  "PROG/I": (mainProgram?: MainInclude) => mainProgram ? "Include" : "Program Include",
  "FUGR/F": "Function Group",
  "FUGR/FF": "Function Module",
  "TYPE/TY": "Type Group",
  "DEVC/K": "Package",
  "TABL/DT": "Database Table",
  "TABL/DS": "Structure",
  "DDLS/DF": "CDS Data Definition",
  "STOB/DO": "CDS Entity",
  "STOB/ST": "Simple Transformation",
  "MSAG/N": "Message Class",
  "TTYP/DA": "Table Type",
  "TTYP/TT": "Table Type",
  "DOMA/DD": "Domain",
  "DOMA/DO": "Domain",
  "DTEL/DE": "Data Element",
  "VIEW/DV": "View",
  "VIEW/V": "Dictionary View",
  "SHLP/DH": "Search Help",
  "ENQU/DL": "Lock/Enqueue Object",
  "TRAN/T": "Transaction",
  "ENHO/XHB": "Enhancement Implementation",
  "ENHO/XHH": "Enhancement Implementation",
  "ENHS/XS": "Enhancement Spot",
  "SXSD/XD": "BAdI Definition",
  "SXCI/XI": "BAdI Implementation",
  "XSLT/XT": "XSLT Program",
  "SUSO/SO": "Authorization Object",
  "SUSO/B": "Authorization Object Set",
  "SUSC/SC": "Authorization Object Class",
  "PINF/PI": "Package Interface",
  "NROB/NR": "Number Range Object"
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