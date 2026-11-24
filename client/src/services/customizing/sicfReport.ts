// Adapted from abap-config-mcp engineDeploy.ts (MIT), Copyright (c) 2026 Geert Steyaert.
import { SAP_OBJECTS, ENGINE_VERSION } from "./payload"

export const SICF_REPORT = {
  name: "ZABAPFS_ICF_SETUP",
  path: "/sap/bc/adt/programs/programs/zabapfs_icf_setup",
  type: "PROG/P"
} as const

/** This is an explicit installer, not a harmless regression test. Never include it in the ZIP. */
export function buildSicfReport(packageName: string, transport?: string): string {
  if (
    !/^(?:\$[A-Z0-9_]+|(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+)$/.test(packageName) ||
    (transport && !/^[A-Z0-9]{1,20}$/.test(transport))
  )
    throw new Error("Invalid SICF installation package or transport")
  const calls = SAP_OBJECTS.filter(object => object.service)
    .map(object => {
      const node = object.service!.split("/").pop()!.toUpperCase()
      return `    install( node = '${node}' handler = '${object.name}' url = '${object.service}' ).`
    })
    .join("\n")
  return `* ABAP FS Customizing ${ENGINE_VERSION}
* Adapted from abap-config-mcp (MIT), Copyright (c) 2026 Geert Steyaert.
REPORT zabapfs_icf_setup.
" USER-INITIATED INSTALLER: creates/activates SICF nodes and commits changes.
" ABAP Unit is only the ADT execution mechanism. 
CLASS ltc_setup DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS run_setup FOR TESTING.
    METHODS install IMPORTING node TYPE icfname handler TYPE seoclsname url TYPE string.
ENDCLASS.
CLASS ltc_setup IMPLEMENTATION.
  METHOD run_setup.
${calls}
  ENDMETHOD.
  METHOD install.
    DATA parent TYPE icfnodguid.
    DATA suffix TYPE icfredurl.
    DATA active TYPE c.
    DATA handlers TYPE icfhndlist.
    DATA handler_row TYPE icfhandler.
    DATA request TYPE trkorr VALUE '${transport ?? ""}'.
    DATA detail TYPE string.
    cl_icf_tree=>if_icf_tree~service_from_url(
      EXPORTING url = '/sap/bc' hostnumber = 0
      IMPORTING icfnodguid = parent urlsuffix = suffix
      EXCEPTIONS OTHERS = 1 ).
    IF sy-subrc <> 0 OR parent IS INITIAL OR suffix IS NOT INITIAL.
      cl_abap_unit_assert=>fail( msg = 'Cannot resolve /sap/bc; ask BASIS to check the default virtual host and authorizations' ).
    ENDIF.
    " Never take over a node owned by a different handler.
    SELECT icfhandler FROM icfhandler INTO TABLE @DATA(existing_handlers)
      WHERE icf_name = @node AND icfparguid = @parent.
    LOOP AT existing_handlers INTO DATA(existing_handler).
      IF existing_handler <> handler.
        cl_abap_unit_assert=>fail( msg = |{ url }: another handler is assigned; review manually in SICF| ).
      ENDIF.
    ENDLOOP.
    handler_row = handler.
    APPEND handler_row TO handlers.
    cl_icf_tree=>if_icf_tree~insert_node(
      EXPORTING icf_name = node icfparguid = parent
        icfdocu = VALUE #( icf_langu = 'E' icf_docu = 'ABAP FS Customizing' )
        icfhandlst = handlers icfactive = 'X' package = '${packageName}'
        application = space i_dark_transport = abap_true
      CHANGING transport = request
      EXCEPTIONS node_already_existing = 2 OTHERS = 1 ).
    IF sy-subrc = 2.
      " Existing logon/security settings are not supplied or changed.
      cl_icf_tree=>if_icf_tree~change_node(
        EXPORTING icf_name = node icfparguid = parent
          icfhandlst = handlers icfactive = 'X' package = '${packageName}'
          display_transport = space
        CHANGING transport = request
        EXCEPTIONS OTHERS = 1 ).
    ENDIF.
    IF sy-subrc <> 0.
      detail = |{ url }: SICF setup failed ({ sy-msgid }/{ sy-msgno } { sy-msgv1 }); check authorization, package and Workbench request|.
      cl_abap_unit_assert=>fail( msg = detail ).
    ENDIF.
    COMMIT WORK AND WAIT.
    cl_icf_tree=>if_icf_tree~check_service_active(
      EXPORTING url = url hostnr = 0
      IMPORTING active = active
      EXCEPTIONS OTHERS = 1 ).
    IF sy-subrc <> 0 OR active IS INITIAL.
      cl_abap_unit_assert=>fail( msg = |{ url }: service or parent is inactive; check SICF| ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`
}
