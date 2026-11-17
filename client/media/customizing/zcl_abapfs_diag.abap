CLASS zcl_abapfs_diag DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

* ABAP FS read-only readiness backend. Operation: ping.
* Endpoint: /sap/bc/zabapfs_diag. Reports client settings and capabilities;
* does not write repository objects or Customizing data.

  PUBLIC SECTION.
    INTERFACES if_http_extension.
    CONSTANTS c_version TYPE string VALUE '{{ENGINE_VERSION}}'.

  PRIVATE SECTION.
    METHODS version.
    TYPES: BEGIN OF ty_request,
             operation TYPE string,
           END OF ty_request.

    TYPES: BEGIN OF ty_response,
             status       TYPE string,
             operation    TYPE string,
             version      TYPE string,
             messages     TYPE stringtab,
             data_json    TYPE string,
           END OF ty_response.

    TYPES: BEGIN OF ty_client_caps,
             category TYPE t000-cccategory,
             coractiv TYPE t000-cccoractiv,
             nocliind TYPE t000-ccnocliind,
             records  TYPE abap_bool,
             changes  TYPE abap_bool,
             text     TYPE string,
           END OF ty_client_caps.

    TYPES: BEGIN OF ty_env,
             SYSID        TYPE sy-sysid,
             CLIENT       TYPE sy-mandt,
             SAPRL        TYPE sy-saprl,
             SAP_BASIS    TYPE string,
             S4CORE       TYPE string,
             IS_S4        TYPE abap_bool,
             CLIENT_ROLE  TYPE t000-cccategory,
             HAS_CTS_TASK TYPE abap_bool,
             HAS_MC_GUI   TYPE abap_bool,
           END OF ty_env.

    METHODS handle_ping        RETURNING VALUE(rs_resp) TYPE ty_response.
    METHODS client_caps       RETURNING VALUE(rs_caps) TYPE ty_client_caps.
    METHODS probe_environment RETURNING VALUE(rs_env)  TYPE ty_env.
    METHODS fm_exists IMPORTING iv_fm TYPE rs38l_fnam RETURNING VALUE(rv_ok) TYPE abap_bool.
ENDCLASS.



CLASS zcl_abapfs_diag IMPLEMENTATION.

  METHOD version.
* ABAP FS Customizing {{ENGINE_VERSION}}
* Adapted from abap-config-mcp (MIT), Copyright (c) 2026 Geert Steyaert.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA: ls_req  TYPE ty_request,
          ls_resp TYPE ty_response,
          lv_body TYPE string,
          lv_xbody TYPE xstring,
          lv_out  TYPE string.
    TRY.
        lv_xbody = server->request->get_data( ).
        IF lv_xbody IS NOT INITIAL.
          TRY.
              lv_body = cl_abap_codepage=>convert_from( source = lv_xbody codepage = '4110' ).
            CATCH cx_root.
              lv_body = server->request->get_cdata( ).
          ENDTRY.
        ELSE.
          lv_body = server->request->get_cdata( ).
        ENDIF.
        TRY.
            /ui2/cl_json=>deserialize( EXPORTING json = lv_body
                        pretty_name = /ui2/cl_json=>pretty_mode-none
              CHANGING data = ls_req ).
          CATCH cx_root INTO DATA(lx_parse).
            ls_resp-status = 'error'.
            APPEND |Cannot parse JSON body: { lx_parse->get_text( ) }| TO ls_resp-messages.
        ENDTRY.
        IF ls_resp-status <> 'error'.
          CASE to_lower( ls_req-operation ).
            WHEN 'ping'.        ls_resp = handle_ping( ).
            WHEN OTHERS.
              ls_resp-status = 'error'.
              APPEND |Unknown operation '{ ls_req-operation }'; supported operation: ping| TO ls_resp-messages.
          ENDCASE.
        ENDIF.
        ls_resp-version = c_version.
        /ui2/cl_json=>serialize( EXPORTING data = ls_resp
                    pretty_name = /ui2/cl_json=>pretty_mode-none
          RECEIVING r_json = lv_out ).
      CATCH cx_root INTO DATA(lx_all).
        DATA lv_msg TYPE string.
        lv_msg = lx_all->get_text( ).
        REPLACE ALL OCCURRENCES OF '"' IN lv_msg WITH '\"'.
        CONCATENATE '{"STATUS":"error","VERSION":"' c_version
                    '","MESSAGES":["' lv_msg '"]}' INTO lv_out.
    ENDTRY.
    IF lv_out IS INITIAL.
      CONCATENATE '{"STATUS":"error","MESSAGES":'
                  '["Handler returned no output"]}' INTO lv_out.
    ENDIF.
    server->response->set_content_type( 'application/json; charset=utf-8' ).
    server->response->set_cdata( lv_out ).
    server->response->set_status( code = 200 reason = 'OK' ).
  ENDMETHOD.


  METHOD handle_ping.
    rs_resp-status    = 'ok'.
    rs_resp-operation = 'ping'.
    rs_resp-version   = c_version.
    APPEND |ABAP FS diagnostic backend alive on { sy-sysid } client { sy-mandt }|
      TO rs_resp-messages.

    " Report the current client's change and transport settings on ping.
    DATA(ls_caps) = client_caps( ).
    APPEND |Client { sy-mandt }: category '{ ls_caps-category }', | &&
           |client-dependent changes = { ls_caps-text } (CCCORACTIV='{ ls_caps-coractiv }'), | &&
           |cross-client/repository CCNOCLIIND='{ ls_caps-nocliind }'|
      TO rs_resp-messages.
    APPEND COND string(
      WHEN ls_caps-changes = abap_false
        THEN '-> customizing changes are BLOCKED in this client'
      WHEN ls_caps-records = abap_true
        THEN '-> client-dependent customizing changes are auto-recorded onto a transport'
      ELSE '-> client-dependent customizing changes are written WITHOUT transport recording' )
      TO rs_resp-messages.

    " Environment/capability probe so the caller adapts to THIS box (release +
    " live feature flags) instead of assuming a release. Full struct in data_json.
    DATA(ls_env) = probe_environment( ).
    APPEND |Environment: { ls_env-sysid } SAP_BASIS { ls_env-sap_basis } | &&
           COND string( WHEN ls_env-is_s4 = abap_true
                          THEN |/ S4CORE { ls_env-s4core }|
                          ELSE |(non-S/4)| ) &&
           |; features: cts_task={ ls_env-has_cts_task } | &&
           |migration_cockpit_gui(LTMC)={ ls_env-has_mc_gui }|
      TO rs_resp-messages.
    /ui2/cl_json=>serialize(
      EXPORTING data        = ls_env
                pretty_name = /ui2/cl_json=>pretty_mode-none
      RECEIVING r_json      = rs_resp-data_json ).
  ENDMETHOD.










  METHOD client_caps.
    SELECT SINGLE cccategory cccoractiv ccnocliind
      FROM t000 INTO (rs_caps-category, rs_caps-coractiv, rs_caps-nocliind)
      WHERE mandt = sy-mandt.
    " CCCORACTIV: '1' = automatic recording; '' = changes w/o recording;
    " '2' = no changes allowed; '3' = changes w/o recording, no transport.
    rs_caps-records = COND #( WHEN rs_caps-coractiv = '1' THEN abap_true ELSE abap_false ).
    rs_caps-changes = COND #( WHEN rs_caps-coractiv = '2' THEN abap_false ELSE abap_true ).
    rs_caps-text = SWITCH string( rs_caps-coractiv
      WHEN '1' THEN 'automatic recording of changes'
      WHEN '2' THEN 'no changes allowed'
      WHEN '3' THEN 'changes without automatic recording, no transport'
      ELSE          'changes without automatic recording' ).
  ENDMETHOD.


  METHOD probe_environment.
    rs_env-sysid       = sy-sysid.
    rs_env-client      = sy-mandt.
    rs_env-saprl       = sy-saprl.
    SELECT SINGLE release FROM cvers INTO @rs_env-sap_basis WHERE component = 'SAP_BASIS'.
    SELECT SINGLE release FROM cvers INTO @rs_env-s4core    WHERE component = 'S4CORE'.
    rs_env-is_s4       = boolc( rs_env-s4core IS NOT INITIAL ).
    rs_env-client_role = client_caps( )-category.
    " Feature flags - probed live, so the engine reports (and the AI adapts to)
    " what THIS box actually has rather than assuming any release baseline.
    rs_env-has_cts_task = fm_exists( 'TRINT_INSERT_NEW_COMM' ).
    SELECT SINGLE @abap_true FROM tstc INTO @rs_env-has_mc_gui WHERE tcode = 'LTMC'.
  ENDMETHOD.


  METHOD fm_exists.
    SELECT SINGLE @abap_true FROM tfdir INTO @rv_ok
      WHERE funcname = @iv_fm.
  ENDMETHOD.

ENDCLASS.
