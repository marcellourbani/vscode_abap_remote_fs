import { readFileSync } from "node:fs"
import { join } from "node:path"

export const ENGINE_VERSION = "1.0.1"
export const SAP_OBJECTS = [
  {
    name: "ZCL_ABAPFS_DIAG",
    file: "zcl_abapfs_diag",
    type: "CLAS/OC",
    path: "/sap/bc/adt/oo/classes/zcl_abapfs_diag",
    service: "/sap/bc/zabapfs_diag"
  },
  {
    name: "ZCL_ABAPFS_CUST_ENGINE",
    file: "zcl_abapfs_cust_engine",
    type: "CLAS/OC",
    path: "/sap/bc/adt/oo/classes/zcl_abapfs_cust_engine",
    service: "/sap/bc/zabapfs_cust"
  },
  {
    name: "ZABAPFS_CUST_WRITE",
    file: "zabapfs_cust_write",
    type: "PROG/P",
    path: "/sap/bc/adt/programs/programs/zabapfs_cust_write",
    service: undefined
  }
] as const
export type PayloadObject = (typeof SAP_OBJECTS)[number] & { source: string }

export function hsrchAreaCases(): string {
  const order = "DEABCFGHIJKLMNOPQRSTUVWXYZ0123456789deabcfghijklmnopqrstuvwxyz"
  return [...order]
    .map(
      (language, index) =>
        `          WHEN '${language}'.\n` +
        `            IMPORT p_structure_texts = lt_txt p_child_structures = lt_chl\n` +
        `              FROM DATABASE indx_hsrch(${String(index + 1).padStart(2, "0")}) ID lv_sid.\n` +
        `            lv_got = abap_true.`
    )
    .join("\n")
}

/** Resolve once for both deployment methods. Never maintain a second generated source tree. */
export function loadPayload(directory: string): PayloadObject[] {
  return SAP_OBJECTS.map(object => {
    const raw = readFileSync(join(directory, `${object.file}.abap`), "utf8")
    const source = raw
      .replaceAll("{{ENGINE_VERSION}}", ENGINE_VERSION)
      .replaceAll("{{HSRCH_AREA_CASES}}", hsrchAreaCases())
    if (/\{\{[A-Z_]+\}\}/.test(source))
      throw new Error(`Unresolved source placeholder in ${object.name}`)
    if (/[^\x00-\x7F]/.test(source))
      throw new Error(`Unsupported non-ASCII character in ${object.name} payload`)
    const commentPrefix = "*"
    const versionComment = `${commentPrefix} ABAP FS Customizing ${ENGINE_VERSION}`
    const attribution = `${commentPrefix} Adapted from abap-config-mcp (MIT), Copyright (c) 2026 Geert Steyaert.`
    let versionedSource: string
    if (object.type === "CLAS/OC") {
      if (sourceVersion(source) !== ENGINE_VERSION)
        throw new Error(`Class payload ${object.name} must carry its marker in METHOD version`)
      versionedSource = source
    } else {
      versionedSource = `${versionComment}\n${attribution}\n${source}`
    }
    return {
      ...object,
      source: versionedSource
    }
  })
}

export function sourceVersion(source: string): string | undefined {
  if (/^CLASS[ \t]+\S+[ \t]+DEFINITION\b/i.test(source)) {
    const method =
      /^[ \t]*METHOD[ \t]+version[ \t]*\.[ \t]*\r?\n([\s\S]*?)^[ \t]*ENDMETHOD[ \t]*\./im.exec(
        source
      )?.[1]
    return method && /^\* ABAP FS Customizing ([\w.-]+)\r?$/m.exec(method)?.[1]
  }
  return /^\* ABAP FS Customizing ([\w.-]+)\r?(?:\n|$)/.exec(source)?.[1]
}
