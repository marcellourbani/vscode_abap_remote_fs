*----------------------------------------------------------------------*
* CLASS ZCL_ABAP_REPL
* ABAP REPL - Remote Code Execution Service
*
* Accepts ABAP code via HTTP POST, executes it server-side using
* INSERT REPORT + SUBMIT, and returns the WRITE output as JSON.
* Supports full ABAP syntax including classes, inline declarations,
* SELECT, and all standard statements.
*----------------------------------------------------------------------*
CLASS zcl_abap_repl DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_http_extension.

  PRIVATE SECTION.
    CONSTANTS:
      c_version TYPE string VALUE '1.1'.

    METHODS:
      handle_get
        IMPORTING server TYPE REF TO if_http_server,

      handle_post
        IMPORTING server TYPE REF TO if_http_server,

      execute_code
        IMPORTING iv_code    TYPE string
        EXPORTING ev_output  TYPE string
                  ev_error   TYPE string
                  ev_runtime TYPE i,

      check_authorization
        RETURNING VALUE(rv_ok) TYPE abap_bool,

      is_production_system
        RETURNING VALUE(rv_is_prod) TYPE abap_bool,

      log_execution
        IMPORTING
          iv_code    TYPE string
          iv_error   TYPE string
          iv_runtime TYPE i,

      set_json_response
        IMPORTING
          server    TYPE REF TO if_http_server
          iv_json   TYPE string
          iv_status TYPE i DEFAULT 200,

      escape_for_json
        IMPORTING iv_text           TYPE string
        RETURNING VALUE(rv_escaped) TYPE string.
ENDCLASS.


CLASS zcl_abap_repl IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA(lv_method) = server->request->get_method( ).

    CASE lv_method.
      WHEN 'GET'.
        handle_get( server ).
      WHEN 'POST'.
        handle_post( server ).
      WHEN OTHERS.
        set_json_response(
          server    = server
          iv_json   = '{"error":"Method not allowed. Use GET or POST."}'
          iv_status = 405
        ).
    ENDCASE.
  ENDMETHOD.


  METHOD handle_get.
    DATA(lv_json) = |\{"status":"ready","version":"{ c_version }",| &&
                    |"user":"{ sy-uname }",| &&
                    |"system":"{ sy-sysid }",| &&
                    |"client":"{ sy-mandt }",| &&
                    |"production":{ COND #( WHEN is_production_system( ) = abap_true
                                            THEN 'true' ELSE 'false' ) }\}|.
    set_json_response( server = server iv_json = lv_json ).
  ENDMETHOD.


  METHOD handle_post.
    IF check_authorization( ) = abap_false.
      set_json_response(
        server    = server
        iv_json   = '{"error":"Not authorized. S_DEVELOP access required."}'
        iv_status = 403
      ).
      RETURN.
    ENDIF.

    DATA(lv_body) = server->request->get_cdata( ).
    IF lv_body IS INITIAL.
      set_json_response(
        server    = server
        iv_json   = '{"error":"Empty request body. Send JSON: {\"code\":\"...\"}"}'
        iv_status = 400
      ).
      RETURN.
    ENDIF.

    DATA lv_code TYPE string.
    FIND PCRE '"code"\s*:\s*"((?:[^"\\]|\\.)*)' IN lv_body SUBMATCHES lv_code.
    IF lv_code IS INITIAL.
      set_json_response(
        server    = server
        iv_json   = '{"error":"Missing \"code\" field in JSON body."}'
        iv_status = 400
      ).
      RETURN.
    ENDIF.

    " Unescape JSON string
    REPLACE ALL OCCURRENCES OF '\\n' IN lv_code WITH cl_abap_char_utilities=>newline.
    REPLACE ALL OCCURRENCES OF '\\t' IN lv_code WITH cl_abap_char_utilities=>horizontal_tab.
    REPLACE ALL OCCURRENCES OF '\\"' IN lv_code WITH '"'.
    REPLACE ALL OCCURRENCES OF '\\\\' IN lv_code WITH '\'.

    IF is_production_system( ) = abap_true.
      set_json_response(
        server    = server
        iv_json   = '{"error":"REPL is disabled on production systems."}'
        iv_status = 403
      ).
      RETURN.
    ENDIF.

    DATA: lv_output  TYPE string,
          lv_error   TYPE string,
          lv_runtime TYPE i.

    execute_code(
      EXPORTING iv_code    = lv_code
      IMPORTING ev_output  = lv_output
                ev_error   = lv_error
                ev_runtime = lv_runtime
    ).

    log_execution(
      iv_code    = lv_code
      iv_error   = lv_error
      iv_runtime = lv_runtime
    ).

    DATA(lv_safe_output) = escape_for_json( lv_output ).
    DATA(lv_safe_error) = escape_for_json( lv_error ).

    DATA(lv_json) = |\{"success":{ COND #( WHEN lv_error IS INITIAL
                                            THEN 'true' ELSE 'false' ) },| &&
                    |"output":"{ lv_safe_output }",| &&
                    |"error":"{ lv_safe_error }",| &&
                    |"runtime_ms":{ lv_runtime }\}|.

    set_json_response( server = server iv_json = lv_json ).
  ENDMETHOD.


  METHOD execute_code.
    DATA(lv_start) = sy-uzeit.

    DATA: lt_code    TYPE TABLE OF string,
          lv_repname TYPE syrepid,
          lt_asci    TYPE STANDARD TABLE OF char255.

    " Generate a short unique report name (must be < 30 chars)
    DATA(lv_user) = CONV string( sy-uname ).
    DATA(lv_short) = 'ZR' && lv_user(4) && sy-uzeit.
    TRANSLATE lv_short TO UPPER CASE.
    lv_repname = lv_short.

    " Build report source
    APPEND |REPORT { lv_repname }.| TO lt_code.

    SPLIT iv_code AT cl_abap_char_utilities=>newline INTO TABLE DATA(lt_user_lines).
    LOOP AT lt_user_lines INTO DATA(lv_line_text).
      APPEND lv_line_text TO lt_code.
    ENDLOOP.

    TRY.
        INSERT REPORT lv_repname FROM lt_code.
        IF sy-subrc <> 0.
          ev_error = |Failed to create temporary report { lv_repname }.|.
          RETURN.
        ENDIF.

        GENERATE REPORT lv_repname.
        IF sy-subrc <> 0.
          ev_error = |Compilation failed for { lv_repname }. Check ABAP syntax.|.
          DELETE REPORT lv_repname.
          RETURN.
        ENDIF.

        TRY.
            SUBMIT (lv_repname) AND RETURN
              EXPORTING LIST TO MEMORY.
          CATCH cx_root INTO DATA(lx_submit).
            ev_error = |Runtime error: { lx_submit->get_text( ) }|.
        ENDTRY.

        DATA: lt_list TYPE TABLE OF abaplist.

        CALL FUNCTION 'LIST_FROM_MEMORY'
          TABLES
            listobject = lt_list
          EXCEPTIONS
            not_found  = 1
            OTHERS     = 2.

        IF sy-subrc = 0 AND lt_list IS NOT INITIAL.
          CALL FUNCTION 'LIST_TO_ASCI'
            TABLES
              listasci           = lt_asci
              listobject         = lt_list
            EXCEPTIONS
              empty_list         = 1
              list_index_invalid = 2
              OTHERS             = 3.

          IF sy-subrc = 0.
            LOOP AT lt_asci INTO DATA(lv_asci_line).
              IF ev_output IS NOT INITIAL.
                ev_output = ev_output && cl_abap_char_utilities=>newline.
              ENDIF.
              ev_output = ev_output && lv_asci_line.
            ENDLOOP.
          ENDIF.
        ENDIF.

        CALL FUNCTION 'LIST_FREE_MEMORY'.

      CATCH cx_root INTO DATA(lx_err).
        ev_error = |Error: { lx_err->get_text( ) }|.
    ENDTRY.

    " Always clean up
    TRY.
        DELETE REPORT lv_repname.
      CATCH cx_root.
    ENDTRY.

    DATA(lv_end) = sy-uzeit.
    ev_runtime = ( lv_end - lv_start ) * 1000.
  ENDMETHOD.


  METHOD check_authorization.
    AUTHORITY-CHECK OBJECT 'S_DEVELOP'
      ID 'DEVCLASS' DUMMY
      ID 'OBJTYPE'  FIELD 'PROG'
      ID 'OBJNAME'  DUMMY
      ID 'P_GROUP'  DUMMY
      ID 'ACTVT'    FIELD '03'.

    rv_ok = COND #( WHEN sy-subrc = 0 THEN abap_true ELSE abap_false ).
  ENDMETHOD.


  METHOD is_production_system.
    SELECT SINGLE cccategory FROM t000
      WHERE mandt = @sy-mandt
      INTO @DATA(lv_category).

    rv_is_prod = COND #( WHEN lv_category = 'P' THEN abap_true ELSE abap_false ).
  ENDMETHOD.


  METHOD log_execution.
    DATA: ls_log    TYPE bal_s_log,
          ls_msg    TYPE bal_s_msg,
          lv_handle TYPE balloghndl.

    ls_log-object    = 'ZREPL'.
    ls_log-subobject = 'EXEC'.
    ls_log-extnumber = |REPL { sy-uname } { sy-datum } { sy-uzeit }|.

    CALL FUNCTION 'BAL_LOG_CREATE'
      EXPORTING  i_s_log      = ls_log
      IMPORTING  e_log_handle = lv_handle
      EXCEPTIONS OTHERS       = 1.

    IF sy-subrc = 0.
      ls_msg-msgty = COND #( WHEN iv_error IS INITIAL THEN 'S' ELSE 'E' ).
      ls_msg-msgid = '00'.
      ls_msg-msgno = '001'.

      DATA(lv_len) = strlen( iv_code ).
      IF lv_len > 50.
        lv_len = 50.
      ENDIF.
      ls_msg-msgv1 = iv_code(lv_len).

      CALL FUNCTION 'BAL_LOG_MSG_ADD'
        EXPORTING  i_log_handle = lv_handle
                   i_s_msg      = ls_msg
        EXCEPTIONS OTHERS       = 1.

      CALL FUNCTION 'BAL_DB_SAVE'
        EXPORTING  i_save_all = abap_true
        EXCEPTIONS OTHERS     = 1.
    ENDIF.
  ENDMETHOD.


  METHOD set_json_response.
    server->response->set_status( code = iv_status reason = '' ).
    server->response->set_content_type( 'application/json' ).
    server->response->set_cdata( iv_json ).
  ENDMETHOD.


  METHOD escape_for_json.
    rv_escaped = iv_text.
    IF rv_escaped IS INITIAL.
      RETURN.
    ENDIF.
    REPLACE ALL OCCURRENCES OF '\' IN rv_escaped WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_escaped WITH '\"'.
    IF cl_abap_char_utilities=>cr_lf IS NOT INITIAL.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_escaped WITH '\n'.
    ENDIF.
    IF cl_abap_char_utilities=>newline IS NOT INITIAL.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_escaped WITH '\n'.
    ENDIF.
    IF cl_abap_char_utilities=>horizontal_tab IS NOT INITIAL.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_escaped WITH '\t'.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
