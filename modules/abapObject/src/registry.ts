export interface ObjectTypeConfig {
  type: string
  label: string | ((mainProgram?: any) => string)
  gui_objects: "yes" | "no" | "better"
  transactionInfo?: {
    transaction: string
    dynprofield: string
    okcode: string
  }
  extension?: string
  filterLabel?: string
  viewable?: boolean
  creatorClass?:
    | "AbapClass"
    | "AbapClassInclude"
    | "AbapCds"
    | "AbapInclude"
    | "AbapInterface"
    | "AbapFunction"
    | "AbapFunctionGroup"
    | "AbapProgram"
    | "AbapSimple"
    | "AbapXml"
  customEditor?: string
  sourceRequired?: boolean
}

const REGISTRY: ObjectTypeConfig[] = [
  // --- Source Code / VS Code Native Objects ---
  {
    type: "CLAS/OC",
    label: "Class",
    gui_objects: "no",
    transactionInfo: {
      transaction: "SE24",
      dynprofield: "SEOCLASS-CLSNAME",
      okcode: "WB_EXEC"
    },
    filterLabel: "Classes",
    creatorClass: "AbapClass",
    sourceRequired: true
  },
  {
    type: "CLAS/OM",
    label: "Class Method",
    gui_objects: "no"
  },
  {
    type: "CLAS/I",
    label: "Class Include",
    gui_objects: "no",
    transactionInfo: {
      transaction: "SE24",
      dynprofield: "SEOCLASS-CLSNAME",
      okcode: "WB_EXEC"
    },
    creatorClass: "AbapClassInclude"
  },
  {
    type: "INTF/OI",
    label: "Interface",
    gui_objects: "no",
    filterLabel: "Interfaces",
    creatorClass: "AbapInterface",
    sourceRequired: true
  },
  {
    type: "PROG/P",
    label: "Program",
    gui_objects: "no",
    transactionInfo: {
      transaction: "SE38",
      dynprofield: "RS38M-PROGRAMM",
      okcode: "STRT"
    },
    filterLabel: "Programs (Reports)",
    creatorClass: "AbapProgram",
    sourceRequired: true
  },
  {
    type: "PROG/I",
    label: (mainProgram?: any) => (mainProgram ? "Include" : "Program Include"),
    gui_objects: "no",
    filterLabel: "Includes",
    creatorClass: "AbapInclude"
  },
  {
    type: "FUGR/F",
    label: "Function Group",
    gui_objects: "no",
    filterLabel: "Function Groups",
    creatorClass: "AbapFunctionGroup"
  },
  {
    type: "FUGR/FF",
    label: "Function Module",
    gui_objects: "no",
    transactionInfo: {
      transaction: "SE37",
      dynprofield: "RS38L-NAME",
      okcode: "WB_EXEC"
    },
    filterLabel: "Function Modules",
    creatorClass: "AbapFunction",
    sourceRequired: true
  },
  {
    type: "FUGR/I",
    label: "Function Group Include",
    gui_objects: "no",
    creatorClass: "AbapInclude"
  },
  {
    type: "FUNC/FM",
    label: "Function Module",
    gui_objects: "no",
    transactionInfo: {
      transaction: "SE37",
      dynprofield: "RS38L-NAME",
      okcode: "WB_EXEC"
    },
    sourceRequired: true
  },
  {
    type: "TYPE/TY",
    label: "Type Group",
    gui_objects: "no",
    filterLabel: "Type Groups"
  },
  {
    type: "DEVC/K",
    label: "Package",
    gui_objects: "no",
    filterLabel: "Packages"
  },
  {
    type: "DDLS/DF",
    label: "CDS View",
    gui_objects: "no",
    filterLabel: "CDS Data Definitions",
    viewable: true,
    creatorClass: "AbapCds"
  },
  {
    type: "STOB/DO",
    label: "CDS Entity",
    gui_objects: "no",
    filterLabel: "CDS Entities"
  },
  {
    type: "DCLS/DL",
    label: "CDS Access Control",
    gui_objects: "no",
    creatorClass: "AbapCds"
  },
  {
    type: "DDLX/EX",
    label: "CDS Metadata Extension",
    gui_objects: "no",
    creatorClass: "AbapCds"
  },
  {
    type: "BDEF/BDO",
    label: "Behavior Definition",
    gui_objects: "no",
    creatorClass: "AbapCds"
  },
  {
    type: "SRVD/SRV",
    label: "Service Definition",
    gui_objects: "no",
    creatorClass: "AbapCds"
  },

  // --- XML / Metadata Objects (GUI or Code) ---
  {
    type: "MSAG/N",
    label: "Message Class",
    gui_objects: "better",
    extension: ".msagn.xml",
    filterLabel: "Message Classes",
    creatorClass: "AbapXml",
    customEditor: "abapfs.msagn"
  },
  {
    type: "XSLT/VT",
    label: "Simple Transformation",
    gui_objects: "better",
    extension: ".xslt.source.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "XSLT/XT",
    label: "XSLT Program",
    gui_objects: "better",
    extension: ".xslt.xml",
    filterLabel: "XSLT Programs"
  },
  {
    type: "STOB/ST",
    label: "Simple Transformation",
    gui_objects: "better",
    extension: ".stob.xml",
    filterLabel: "Simple Transformations"
  },
  {
    type: "HTTP",
    label: "HTTP Service",
    gui_objects: "better",
    extension: ".http.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "SRVB/SVB",
    label: "Service Binding",
    gui_objects: "better",
    extension: ".srvb.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "SUSO/SO",
    label: "Authorization Object",
    gui_objects: "better",
    extension: ".suso.xml",
    filterLabel: "Authorization Objects"
  },
  {
    type: "SUSO/B",
    label: "Authorization Object Set",
    gui_objects: "better",
    extension: ".susob.xml",
    filterLabel: "Authorization Object Sets",
    creatorClass: "AbapXml"
  },
  {
    type: "SUSC/SC",
    label: "Authorization Object Class",
    gui_objects: "better",
    extension: ".susc.xml",
    filterLabel: "Authorization Object Classes"
  },
  {
    type: "AUTH",
    label: "Authorization Object",
    gui_objects: "better",
    extension: ".auth.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "SUSH",
    label: "Authorization Objects",
    gui_objects: "better",
    extension: ".sush.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "DTEL/DE",
    label: "Data Element",
    gui_objects: "better",
    extension: ".dtel.xml",
    filterLabel: "Data Elements",
    creatorClass: "AbapXml"
  },
  {
    type: "SIA6",
    label: "SIA6 Object",
    gui_objects: "better",
    extension: ".sia6.xml",
    creatorClass: "AbapXml"
  },
  {
    type: "TTYP/DA",
    label: "Table Type",
    gui_objects: "better",
    extension: ".ttyp.xml",
    filterLabel: "Table Types"
  },
  {
    type: "TTYP/TT",
    label: "Table Type",
    gui_objects: "better",
    extension: ".ttyp.xml"
  },
  {
    type: "DOMA/DD",
    label: "Domain",
    gui_objects: "better",
    extension: ".doma.xml",
    filterLabel: "Domains"
  },
  {
    type: "DOMA/DO",
    label: "Domain",
    gui_objects: "better",
    extension: ".doma.xml"
  },
  {
    type: "VIEW/DV",
    label: "View",
    gui_objects: "better",
    extension: ".view.xml",
    filterLabel: "Views",
    viewable: true
  },
  {
    type: "VIEW/V",
    label: "Dictionary View",
    gui_objects: "better",
    extension: ".view.xml"
  },
  {
    type: "SHLP/DH",
    label: "Search Help",
    gui_objects: "better",
    extension: ".shlp.xml",
    filterLabel: "Search Helps"
  },
  {
    type: "ENQU/DL",
    label: "Lock/Enqueue Object",
    gui_objects: "better",
    extension: ".enqu.xml",
    filterLabel: "Lock/Enqueue Objects"
  },
  {
    type: "PINF/PI",
    label: "Package Interface",
    gui_objects: "better",
    extension: ".pinf.xml",
    filterLabel: "Package Interfaces"
  },
  {
    type: "NROB/NR",
    label: "Number Range Object",
    gui_objects: "better",
    extension: ".nrob.xml",
    filterLabel: "Number Range Objects"
  },

  // --- GUI Only Objects ---
  {
    type: "TABL/DT",
    label: "Database Table",
    gui_objects: "yes",
    filterLabel: "Database Tables",
    viewable: true,
    creatorClass: "AbapSimple"
  },
  {
    type: "TABL/DS",
    label: "Structure",
    gui_objects: "yes",
    filterLabel: "Structures",
    creatorClass: "AbapSimple"
  },
  {
    type: "SRFC",
    label: "RFC Connection",
    gui_objects: "yes",
    creatorClass: "AbapSimple"
  },
  {
    type: "TRAN/T",
    label: "Transaction",
    gui_objects: "yes",
    filterLabel: "Transactions",
    creatorClass: "AbapSimple"
  },
  {
    type: "PARA/R",
    label: "Parameter ID",
    gui_objects: "yes",
    creatorClass: "AbapSimple"
  },
  {
    type: "IWSV",
    label: "Gateway Service",
    gui_objects: "yes"
  },

  // --- Enhancement / BAdI Objects ---
  {
    type: "ENHO/XHB",
    label: "Enhancement Implementation",
    gui_objects: "better",
    filterLabel: "Enhancement Implementations"
  },
  {
    type: "ENHO/XHH",
    label: "Enhancement Implementation",
    gui_objects: "better",
    filterLabel: "Enhancement Implementations"
  },
  {
    type: "ENHS/XS",
    label: "Enhancement Spot",
    gui_objects: "better",
    filterLabel: "Enhancement Spots"
  },
  {
    type: "SXSD/XD",
    label: "BAdI Definition",
    gui_objects: "better",
    filterLabel: "BAdI Definitions"
  },
  {
    type: "SXCI/XI",
    label: "BAdI Implementation",
    gui_objects: "better",
    filterLabel: "BAdI Implementations"
  },

  // --- Additional types to prevent helper hardcoding ---
  {
    type: "TABL/TA",
    label: "Table",
    gui_objects: "yes",
    sourceRequired: true
  }
]

export function getObjectTypeConfig(type: string): ObjectTypeConfig | undefined {
  return REGISTRY.find(r => r.type === type)
}

export function getAllConfigs(): ObjectTypeConfig[] {
  return REGISTRY
}
