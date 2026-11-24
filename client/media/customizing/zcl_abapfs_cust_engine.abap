CLASS zcl_abapfs_cust_engine DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_http_extension.
    CONSTANTS c_version TYPE string VALUE '{{ENGINE_VERSION}}'.

  PRIVATE SECTION.
    METHODS version.
    TYPES: ty_tabkey_tt TYPE STANDARD TABLE OF trobj_name WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_request,
             operation        TYPE string,
             table            TYPE string,
             key_field        TYPE string,
             source_key       TYPE string,
             target_key       TYPE string,
             transport        TYPE string,
             only_missing     TYPE abap_bool,
             commit           TYPE abap_bool,
             max_rows         TYPE i,
             record_transport TYPE abap_bool,  " default true for C/G/E; false = direct write
             view_name        TYPE string,     " maintenance object (view or table) resolved by the ABAP FS caller
             transport_object TYPE string,     " 'VDAT' | 'TABU' | 'CDAT' - recorded transport object type
             cluster_name     TYPE string,     " view cluster (when transport_object='CDAT'); data writes through view_name
             run_id           TYPE c LENGTH 22, " for operation 'status' - poll a prior async write
             structure_id     TYPE string,     " img_index_read: IMG tree id (default root)
             language         TYPE string,     " img_index_read: 1-char SPRAS (default sy-langu)
             keyword          TYPE string,     " img_index_read: case-insensitive substring filter on node TEXT
             create_transport TYPE abap_bool,  " write: mint a new Customizing request when no TRANSPORT given
             transport_text   TYPE string,     " write: short text for the engine-created Customizing request (optional)
             action           TYPE string,     " write/delete: '' / 'INS' = upsert ; 'DEL' = delete via the view
             values_json      TYPE string,     " write: JSON array of {FIELD,VALUE} overrides applied to every planned row
             rows_json        TYPE string,     " create: JSON array of rows, each row a JSON array of {FIELD,VALUE} (full key + data)
             extras_json      TYPE string,     " apply/create (internal): JSON array of {ROW,FIELD,VALUE} for view-only fields
           END OF ty_request.

    " Field override for handle_write: applied to each planned row after the
    " key swap, so a copy can land with corrected values (name, currency, ...)
    " - or, with SOURCE_KEY = TARGET_KEY + ONLY_MISSING='', patch a row in place.
    TYPES: BEGIN OF ty_field_value,
             field TYPE string,
             value TYPE string,
           END OF ty_field_value,
           ty_field_value_tt TYPE STANDARD TABLE OF ty_field_value WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_batch_result,
             ok           TYPE abap_bool,
             rows_written TYPE i,
             e071k_count  TYPE i,
             transport    TYPE string,
             run_id       TYPE c LENGTH 22,
             pending      TYPE abap_bool,
           END OF ty_batch_result.

    " Result the batch writer (ZABAPFS_CUST_WRITE) EXPORTs to INDX(FR); both
    " submit_batch_write and handle_status IMPORT it (matched by component name).
    TYPES: BEGIN OF ty_jres,
             status       TYPE string,
             rows_written TYPE i,
             e071k_count  TYPE i,
             transport    TYPE string,
             messages     TYPE stringtab,
           END OF ty_jres.

    " Job handle EXPORTed to INDX(FJ) by every submit_* right after JOB_CLOSE, so
    " handle_status can cross-check TBTCO and tell running / queued / aborted /
    " unknown apart (instead of a blanket 'pending' that also means 'cancelled'
    " and 'never existed'). cdate/ctime anchor the retention sweep.
    TYPES: BEGIN OF ty_jhandle,
             jobname   TYPE btcjob,
             jobcount  TYPE btcjobcnt,
             run_kind  TYPE string,      " 'WRITE'
             table     TYPE string,
             transport TYPE string,
             cdate     TYPE d,
             ctime     TYPE t,
           END OF ty_jhandle.

    TYPES: BEGIN OF ty_response,
             status       TYPE string,
             operation    TYPE string,
             version      TYPE string,
             dry_run      TYPE abap_bool,
             table        TYPE string,
             rows_planned TYPE i,
             rows_written TYPE i,
             transport    TYPE string,
             messages     TYPE stringtab,
             data_json    TYPE string,
             extras_json  TYPE string,
             run_id       TYPE c LENGTH 22,  " set when status='pending' so the client can poll
           END OF ty_response.

    " Client change-recording capability, read from T000 for sy-mandt.  Decides
    " whether a customizing change is auto-recorded onto a transport (CCCORACTIV
    " for client-dependent objects, CCNOCLIIND for cross-client ones) or written
    " directly without recording - so the engine routes record-vs-direct the way
    " SCC4 configures the client, instead of assuming C/G/E always records.
    TYPES: BEGIN OF ty_client_caps,
             category TYPE t000-cccategory,
             coractiv TYPE t000-cccoractiv,
             nocliind TYPE t000-ccnocliind,
             records  TYPE abap_bool,   " automatic recording active (CCCORACTIV='1')
             changes  TYPE abap_bool,   " client-dependent changes permitted at all
             text     TYPE string,      " human-readable CCCORACTIV meaning
           END OF ty_client_caps.

    " Environment/capability probe - what THIS box actually offers, so the
    " caller (and the engine itself) can adapt instead of assuming a release.
    " Returned by handle_ping as data_json. Feature flags are probed live
    " (TFDIR / TSTC), never hardcoded per release.
    TYPES: BEGIN OF ty_env,
             SYSID        TYPE sy-sysid,
             CLIENT       TYPE sy-mandt,
             SAPRL        TYPE sy-saprl,          " SAP_BASIS short release (e.g. 758)
             SAP_BASIS    TYPE string,            " CVERS SAP_BASIS release
             S4CORE       TYPE string,            " CVERS S4CORE release ('' on non-S/4)
             IS_S4        TYPE abap_bool,
             CLIENT_ROLE  TYPE t000-cccategory,   " SCC4 client category C/T/P/...
             HAS_CTS_TASK TYPE abap_bool,         " TRINT_INSERT_NEW_COMM present
             HAS_MC_GUI   TYPE abap_bool,         " tcode LTMC present (migration cockpit GUI)
           END OF ty_env.

    METHODS handle_ping
      RETURNING VALUE(rs_resp) TYPE ty_response.


    METHODS handle_write
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.

    "! Create rows from explicit field/value maps (full key, no source row) and
    "! write them through the same recorded view-runtime path as handle_write.
    "! Unlike handle_write (a single-key copy), this supports composite keys and
    "! distinct per-row values - e.g. storage locations (WERKS+LGORT+LGOBE).
    METHODS handle_create
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.

    "! Shared commit machinery for a built plan: delivery-class routing, client
    "! capability + S_TABU_DIS check, transport resolution, then the recorded
    "! batch-job write (view runtime) or direct MODIFY. Used by both the copy
    "! (handle_write) and the explicit-row (handle_create) plan builders.
    METHODS commit_plan
      IMPORTING is_req  TYPE ty_request
                ir_plan TYPE REF TO data
      CHANGING  cs_resp TYPE ty_response.

    "! True if a row with the given key already exists in the table (key fields
    "! read from DD03L; CLNT forced to sy-mandt). Used by handle_create's
    "! ONLY_MISSING to skip rows that are already present.
    METHODS row_exists
      IMPORTING iv_table     TYPE string
                ir_row       TYPE REF TO data
      RETURNING VALUE(rv_ok) TYPE abap_bool.

    METHODS handle_delete
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.


    METHODS handle_status
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.

    METHODS handle_img_index_read
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.

    "! Server-side IMG activity search: a full CUS_IMGACT scan with LIKE over the
    "! title TEXT *and* the activity id (so component acronyms - e.g. TSW, only
    "! present in SIMG_OIJ_TSW_* ids, not the functional titles - are found),
    "! joined to CUS_ACTOBJ. Open SQL LIKE has none of the ADT Data-Preview
    "! endpoint's restrictions, so no 200-row alphabetical-window truncation.
    METHODS handle_img_search
      IMPORTING is_req         TYPE ty_request
      RETURNING VALUE(rs_resp) TYPE ty_response.

    "! Best-effort live progress for a still-running batch job: the first BGD work
    "! process of the job's user, with its current program/action/table (headless
    "! SM50). Turns a bare 'running' into 'still working: RADBTDDF reading DD02L'.
    METHODS job_progress_note
      RETURNING VALUE(rv_note) TYPE string.

    "! The error lines of a job's log (message types E/A/X), so an aborted run
    "! says why instead of "check SM37".
    METHODS job_log_errors
      IMPORTING iv_jobname  TYPE btcjob
                iv_jobcount TYPE btcjobcnt
      CHANGING  ct_messages TYPE stringtab.

    "! Age out finished/aborted run artifacts (INDX FJ/FR/FP) whose job handle is
    "! older than the retention window - results stay re-readable for a while
    "! (a lost HTTP response must not destroy the outcome) but don't accumulate.
    METHODS cleanup_stale_runs.

    "! EXPORT the job handle (name/count/kind/timestamp) to INDX(FJ) keyed by
    "! run_id, so handle_status can cross-check TBTCO. Called by every submit_*
    "! right after JOB_CLOSE succeeds.
    METHODS write_job_handle
      IMPORTING iv_run_id    TYPE c
                iv_jobname   TYPE btcjob
                iv_jobcount  TYPE btcjobcnt
                iv_kind      TYPE string
                iv_table     TYPE string OPTIONAL
                iv_transport TYPE string OPTIONAL.





    METHODS is_valid_name
      IMPORTING iv_name       TYPE string
      RETURNING VALUE(rv_ok)  TYPE abap_bool.

    "! Escape single quotes for safe interpolation into a dynamic WHERE.
    METHODS esc_quote
      IMPORTING iv_val        TYPE string
      RETURNING VALUE(rv_val) TYPE string.

    METHODS delivery_class
      IMPORTING iv_table        TYPE string
      RETURNING VALUE(rv_flag)  TYPE dd02l-contflag.

    "! Read the current client's change/transport capability from T000.
    METHODS client_caps
      RETURNING VALUE(rs_caps) TYPE ty_client_caps.

    "! True if a function module is installed on this system (TFDIR lookup) -
    "! the guard for calling non-kernel FMs that may be absent on a given release.
    METHODS fm_exists
      IMPORTING iv_fm        TYPE rs38l_fnam
      RETURNING VALUE(rv_ok) TYPE abap_bool.

    "! Probe what this box offers (release/components + live feature flags) so
    "! callers adapt to the environment instead of assuming a release.
    METHODS probe_environment
      RETURNING VALUE(rs_env) TYPE ty_env.

    "! True if IV_TABLE is client-dependent (has MANDT as a key field), so its
    "! recording is governed by CCCORACTIV; false for cross-client (CCNOCLIIND).
    METHODS is_client_dependent
      IMPORTING iv_table       TYPE string
      RETURNING VALUE(rv_flag) TYPE abap_bool.

    "! Decide whether a customizing change to IV_TABLE may proceed in this client
    "! and whether the SM30 runtime will record it onto a transport.  EV_BLOCKED
    "! = the client forbids the change; EV_RECORDS = expect transport recording
    "! (false -> no automatic recording). EV_REASON carries the message.
    METHODS eval_client_change
      IMPORTING iv_table    TYPE string
      EXPORTING ev_blocked  TYPE abap_bool
                ev_records  TYPE abap_bool
                ev_reason   TYPE string.

    METHODS auth_group
      IMPORTING iv_table        TYPE string
      RETURNING VALUE(rv_group) TYPE tddat-cclass.

    METHODS build_tabkey
      IMPORTING iv_table        TYPE string
                ir_row          TYPE REF TO data
      RETURNING VALUE(rv_key)   TYPE trobj_name.

    METHODS submit_batch_write
      IMPORTING is_req         TYPE ty_request
                ir_plan        TYPE REF TO data
      CHANGING  ct_messages    TYPE stringtab
      RETURNING VALUE(rs_res)  TYPE ty_batch_result.

    "! Create a modifiable Customizing request (TRFUNCTION 'W') owned by the
    "! current user. Customizing view data (R3TR VDAT) can only be recorded into
    "! a customizing request, not a workbench one. Returns the request trkorr
    "! (to report/release) and the customizing task trkorr (the corr_number to
    "! record objects on). Both empty on failure.
    METHODS create_cust_transport
      IMPORTING iv_text    TYPE as4text
      EXPORTING ev_request TYPE trkorr
                ev_task    TYPE trkorr.

    "! Resolve the task to record onto for a caller-supplied transport.
    "! If IV_TRANSPORT is a task, returns it (and its parent request). If it is a
    "! request, returns the current user's modifiable task under it - creating one
    "! (TRINT_INSERT_NEW_COMM) when the user has none, so a supplied request the
    "! user has no task in still records cleanly. EV_MSG set on failure.
    METHODS ensure_user_task
      IMPORTING iv_transport TYPE trkorr
      EXPORTING ev_task      TYPE trkorr
                ev_request   TYPE trkorr
                ev_created   TYPE abap_bool
                ev_msg       TYPE string.

ENDCLASS.



CLASS zcl_abapfs_cust_engine IMPLEMENTATION.

  METHOD version.
* ABAP FS Customizing {{ENGINE_VERSION}}
* Adapted from abap-config-mcp (MIT), Copyright (c) 2026 Geert Steyaert.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA: ls_req   TYPE ty_request,
          ls_resp  TYPE ty_response,
          lv_body  TYPE string,
          lv_xbody TYPE xstring,
          lv_out   TYPE string.

    " Always write a response - wrap everything so an unhandled exception
    " cannot produce an empty body (ICF silently returns 200 on handler abort).
    TRY.

        " Read POST body: get_data() -> UTF-8 decode is more reliable than
        " get_cdata() in many ICF configurations; fall back to get_cdata().
        lv_xbody = server->request->get_data( ).
        IF lv_xbody IS NOT INITIAL.
          TRY.
              lv_body = cl_abap_codepage=>convert_from(
                          source   = lv_xbody
                          codepage = '4110' ).   " 4110 = UTF-8
            CATCH cx_root.
              lv_body = server->request->get_cdata( ).
          ENDTRY.
        ELSE.
          lv_body = server->request->get_cdata( ).
        ENDIF.

        " Deserialize request JSON
        TRY.
            /ui2/cl_json=>deserialize(
              EXPORTING json        = lv_body
                        pretty_name = /ui2/cl_json=>pretty_mode-none
              CHANGING  data        = ls_req ).
          CATCH cx_root INTO DATA(lx_parse).
            ls_resp-status = 'error'.
            APPEND |Cannot parse JSON body: { lx_parse->get_text( ) }|
              TO ls_resp-messages.
            APPEND |Raw body (first 200): { substring( val = lv_body
                       off = 0
                       len = nmin( val1 = 200 val2 = strlen( lv_body ) ) ) }|
              TO ls_resp-messages.
        ENDTRY.

        " Dispatch
        IF ls_resp-status <> 'error'.
          CASE to_lower( ls_req-operation ).
            WHEN 'ping'.     ls_resp = handle_ping( ).
            WHEN 'write'.    ls_resp = handle_write( ls_req ).
            WHEN 'create'.   ls_resp = handle_create( ls_req ).
            WHEN 'delete'.   ls_resp = handle_delete( ls_req ).
            WHEN 'status'.   ls_resp = handle_status( ls_req ).
            WHEN 'img_index_read'. ls_resp = handle_img_index_read( ls_req ).
            WHEN 'img_search'.     ls_resp = handle_img_search( ls_req ).
            WHEN OTHERS.
              ls_resp-status = 'error'.
              APPEND |Unknown operation: '{ ls_req-operation }'|
                TO ls_resp-messages.
          ENDCASE.
        ENDIF.

        ls_resp-version = c_version.

        " Serialize response
        /ui2/cl_json=>serialize(
          EXPORTING data        = ls_resp
                    pretty_name = /ui2/cl_json=>pretty_mode-none
          RECEIVING r_json      = lv_out ).

      CATCH cx_root INTO DATA(lx_all).
        " Last-resort: any unhandled exception -> hand-built JSON error.
        " Include the raise position - for errors thrown deep inside standard
        " FMs (e.g. a popup attempted in a GUI-less context) the position is
        " the only way to identify the offender.
        DATA lv_msg TYPE string.
        lx_all->get_source_position(
          IMPORTING program_name = DATA(lv_xprog)
                    include_name = DATA(lv_xincl)
                    source_line  = DATA(lv_xline) ).
        lv_msg = |{ lx_all->get_text( ) } [raised at { lv_xprog }/{ lv_xincl } line { lv_xline }]|.
        REPLACE ALL OCCURRENCES OF '"' IN lv_msg WITH '\"'.
        CONCATENATE '{"STATUS":"error","VERSION":"' c_version
                    '","MESSAGES":["' lv_msg '"]}' INTO lv_out.
    ENDTRY.

    " Safety net: should never be empty after the above, but guard anyway
    IF lv_out IS INITIAL.
      CONCATENATE '{"STATUS":"error","VERSION":"' c_version
                  '","MESSAGES":["Handler returned no output"]}' INTO lv_out.
    ENDIF.

    server->response->set_content_type( 'application/json; charset=utf-8' ).
    server->response->set_cdata( lv_out ).
    server->response->set_status( code = 200 reason = 'OK' ).
  ENDMETHOD.


  METHOD handle_ping.
    rs_resp-status    = 'ok'.
    rs_resp-operation = 'ping'.
    rs_resp-version   = c_version.
    APPEND |ABAP FS Customizing backend alive on { sy-sysid } client { sy-mandt }|
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












  METHOD handle_write.
    DATA: lr_src      TYPE REF TO data,
          lr_tgt      TYPE REF TO data,
          lr_plan     TYPE REF TO data,
          lr_new      TYPE REF TO data,
          lr_one      TYPE REF TO data,
          lv_where    TYPE string,
          lv_flag     TYPE dd02l-contflag,
          lv_nk       TYPE trobj_name,
          lt_tgt_keys TYPE ty_tabkey_tt.
    FIELD-SYMBOLS: <src>  TYPE STANDARD TABLE,
                   <tgt>  TYPE STANDARD TABLE,
                   <plan> TYPE STANDARD TABLE,
                   <row>  TYPE any,
                   <new>  TYPE any,
                   <one>  TYPE any,
                   <t>    TYPE any,
                   <key>  TYPE any.

    TYPES: BEGIN OF ty_extra,
             row   TYPE i,
             field TYPE string,
             value TYPE string,
           END OF ty_extra,
           BEGIN OF ty_view_row,
             tabkey TYPE trobj_name,
             data   TYPE REF TO data,
           END OF ty_view_row.
    DATA: lt_extras     TYPE STANDARD TABLE OF ty_extra WITH DEFAULT KEY,
          lt_rowx       TYPE STANDARD TABLE OF ty_extra WITH DEFAULT KEY,
          view_rows     TYPE HASHED TABLE OF ty_view_row WITH UNIQUE KEY tabkey,
          view_fields   TYPE STANDARD TABLE OF vimnamtab WITH DEFAULT KEY,
          view_headers  TYPE STANDARD TABLE OF vimdesc WITH DEFAULT KEY,
          selections    TYPE STANDARD TABLE OF vimsellist WITH DEFAULT KEY,
          view_data     TYPE REF TO data,
          view_entry    TYPE REF TO data,
          view_name     TYPE dd02v-tabname,
          ls_req        TYPE ty_request.
    FIELD-SYMBOLS: <view_rows> TYPE STANDARD TABLE,
                   <view>      TYPE any,
                   <view_fld>  TYPE any,
                   <base_fld>  TYPE any.
    ls_req = is_req.
    DATA(in_place) = xsdbool( is_req-source_key = is_req-target_key ).

    rs_resp-operation = 'write'.
    rs_resp-table     = is_req-table.
    rs_resp-transport = is_req-transport.
    rs_resp-dry_run   = COND #( WHEN is_req-commit = abap_true
                                THEN abap_false ELSE abap_true ).

    " -- Guard rails ---------------------------------------------------------
    IF is_valid_name( is_req-table ) = abap_false
    OR is_valid_name( is_req-key_field ) = abap_false.
      rs_resp-status = 'error'.
      APPEND 'Invalid table or key field name' TO rs_resp-messages.
      RETURN.
    ENDIF.

    IF is_req-source_key IS INITIAL OR is_req-target_key IS INITIAL.
      rs_resp-status = 'error'.
      APPEND 'SOURCE_KEY and TARGET_KEY are both required' TO rs_resp-messages.
      RETURN.
    ENDIF.

    " Delivery class is needed only for the dry-run wording here; the full
    " routing/auth/transport logic now lives in commit_plan (shared with
    " handle_create) and runs at commit time.
    lv_flag = delivery_class( is_req-table ).

    " -- Read source + target ------------------------------------------------
    TRY.
        CREATE DATA lr_src  TYPE STANDARD TABLE OF (is_req-table).
        CREATE DATA lr_tgt  TYPE STANDARD TABLE OF (is_req-table).
        CREATE DATA lr_plan TYPE STANDARD TABLE OF (is_req-table).
        ASSIGN lr_src->*  TO <src>.
        ASSIGN lr_tgt->*  TO <tgt>.
        ASSIGN lr_plan->* TO <plan>.
      CATCH cx_root INTO DATA(lx_ce).
        rs_resp-status = 'error'.
        APPEND |Cannot type table { is_req-table }: { lx_ce->get_text( ) }|
          TO rs_resp-messages.
        RETURN.
    ENDTRY.

    lv_where = |{ is_req-key_field } = '{ esc_quote( is_req-source_key ) }'|.
    SELECT * FROM (is_req-table) INTO TABLE <src> WHERE (lv_where).
    lv_where = |{ is_req-key_field } = '{ esc_quote( is_req-target_key ) }'|.
    SELECT * FROM (is_req-table) INTO TABLE <tgt> WHERE (lv_where).

    " Field overrides: VALUES_JSON = [{"FIELD":"NAME1","VALUE":"..."},...] is
    " applied to every planned row after the key swap, so a copy lands with
    " corrected values; with SOURCE_KEY = TARGET_KEY and ONLY_MISSING='' this
    " patches an existing row in place through the same recorded write path.
    DATA lt_overrides TYPE ty_field_value_tt.
    IF is_req-values_json IS NOT INITIAL.
      TRY.
          /ui2/cl_json=>deserialize(
            EXPORTING json        = is_req-values_json
                      pretty_name = /ui2/cl_json=>pretty_mode-none
            CHANGING  data        = lt_overrides ).
        CATCH cx_root INTO DATA(lx_vj).
          rs_resp-status = 'error'.
          APPEND |Cannot parse VALUES_JSON: { lx_vj->get_text( ) }| TO rs_resp-messages.
          RETURN.
      ENDTRY.
      LOOP AT lt_overrides INTO DATA(ls_chk).
        IF is_valid_name( ls_chk-field ) = abap_false.
          rs_resp-status = 'error'.
          APPEND |Invalid override field name '{ ls_chk-field }'| TO rs_resp-messages.
          RETURN.
        ENDIF.
      ENDLOOP.
    ENDIF.

    IF in_place = abap_true AND
       ( is_req-only_missing = abap_true OR lt_overrides IS INITIAL ).
      rs_resp-status = 'error'.
      APPEND 'In-place updates require ONLY_MISSING=false and at least one field override'
        TO rs_resp-messages.
      RETURN.
    ENDIF.
    IF in_place = abap_true AND
       ( is_req-record_transport = abap_false OR is_req-view_name IS INITIAL OR lv_flag = 'A' ).
      rs_resp-status = 'error'.
      APPEND 'In-place updates require the maintenance runtime; direct writes are not supported'
        TO rs_resp-messages.
      RETURN.
    ENDIF.
    IF in_place = abap_true AND <src> IS INITIAL.
      rs_resp-status = 'error'.
      APPEND |No existing { is_req-table } row found for { is_req-key_field } = '{ is_req-source_key }'|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    IF is_req-view_name IS NOT INITIAL.
      TRY.
          CREATE DATA view_entry TYPE (is_req-view_name).
          ASSIGN view_entry->* TO <view>.
          IF in_place = abap_true.
            CREATE DATA view_data TYPE STANDARD TABLE OF (is_req-view_name).
            ASSIGN view_data->* TO <view_rows>.
            view_name = is_req-view_name.
            CALL FUNCTION 'VIEW_GET_DDIC_INFO'
              EXPORTING
                viewname = view_name
              TABLES
                sellist  = selections
                x_header = view_headers
                x_namtab = view_fields
              EXCEPTIONS
                error_message = 1
                OTHERS        = 2.
            IF sy-subrc <> 0 OR view_headers IS INITIAL OR view_fields IS INITIAL.
              rs_resp-status = 'error'.
              APPEND |Cannot initialize maintenance metadata for { view_name }|
                TO rs_resp-messages.
              RETURN.
            ENDIF.

            READ TABLE view_fields INTO DATA(selection_field)
              WITH KEY bastabname = is_req-table bastabfld = is_req-key_field.
            IF sy-subrc <> 0.
              rs_resp-status = 'error'.
              APPEND |Key field { is_req-table }-{ is_req-key_field } is not mapped by maintenance view { view_name }|
                TO rs_resp-messages.
              RETURN.
            ENDIF.
            DATA(selection_index) = sy-tabix.
            READ TABLE <src> ASSIGNING <row> INDEX 1.
            ASSIGN COMPONENT is_req-key_field OF STRUCTURE <row> TO <key>.
            IF sy-subrc <> 0.
              rs_resp-status = 'error'.
              APPEND |Key field { is_req-key_field } not found in { is_req-table }|
                TO rs_resp-messages.
              RETURN.
            ENDIF.
            DATA selection_value TYPE vimsellist-value.
            CALL FUNCTION 'VIEW_CONVERSION_OUTPUT'
              EXPORTING
                value_intern = <key>
                tabname      = view_name
                fieldname    = selection_field-viewfield
                inttype      = selection_field-inttype
                datatype     = selection_field-datatype
                decimals     = selection_field-decimals
                convexit     = selection_field-convexit
                sign         = selection_field-sign
                outputlen    = selection_field-outputlen
                intlen       = selection_field-flength
              IMPORTING
                value_extern = selection_value
              EXCEPTIONS
                error_message = 1
                OTHERS        = 2.
            IF sy-subrc <> 0.
              rs_resp-status = 'error'.
              APPEND |Cannot format selection field { selection_field-viewfield } for { view_name }|
                TO rs_resp-messages.
              RETURN.
            ENDIF.
            IF selections IS NOT INITIAL.
              READ TABLE selections ASSIGNING FIELD-SYMBOL(<last_selection>) INDEX lines( selections ).
              <last_selection>-and_or = 'AND'.
            ENDIF.
            APPEND VALUE #( viewfield = selection_field-viewfield operator = 'EQ'
                            value = selection_value tabix = selection_index
                            initial = xsdbool( <key> IS INITIAL ) ) TO selections.
            CALL FUNCTION 'VIEW_GET_DATA'
              EXPORTING
                view_name            = view_name
                with_authority_check = abap_true
                check_linedep_auth   = abap_true
                data_cont_type_x     = abap_true
              TABLES
                dba_sellist          = selections
                data                 = <view_rows>
                x_header             = view_headers
                x_namtab             = view_fields
              EXCEPTIONS
                error_message        = 1
                OTHERS               = 2.
            IF sy-subrc <> 0.
              rs_resp-status = 'error'.
              APPEND |Cannot read current entries through maintenance view { view_name } (subrc { sy-subrc })|
                TO rs_resp-messages.
              RETURN.
            ENDIF.
            IF <view_rows> IS INITIAL.
              rs_resp-status = 'error'.
              APPEND |Maintenance view { view_name } returned no rows for { selection_field-viewfield } = '{ selection_value }'|
                TO rs_resp-messages.
              RETURN.
            ENDIF.
            LOOP AT <view_rows> ASSIGNING <view>.
              CREATE DATA lr_one TYPE (is_req-table).
              ASSIGN lr_one->* TO <one>.
              LOOP AT view_fields INTO DATA(mapped_field) WHERE bastabname = is_req-table.
                ASSIGN COMPONENT mapped_field-viewfield OF STRUCTURE <view> TO <view_fld>.
                IF sy-subrc <> 0.
                  CONTINUE.
                ENDIF.
                ASSIGN COMPONENT mapped_field-bastabfld OF STRUCTURE <one> TO <base_fld>.
                IF sy-subrc = 0.
                  <base_fld> = <view_fld>.
                ENDIF.
              ENDLOOP.
              lv_nk = build_tabkey( iv_table = is_req-table ir_row = lr_one ).
              GET REFERENCE OF <view> INTO view_entry.
              INSERT VALUE #( tabkey = lv_nk data = view_entry ) INTO TABLE view_rows.
              IF sy-subrc <> 0.
                rs_resp-status = 'error'.
                APPEND 'Maintenance view returned multiple entries for one base key; in-place edit refused'
                  TO rs_resp-messages.
                RETURN.
              ENDIF.
            ENDLOOP.
          ENDIF.
        CATCH cx_root INTO DATA(view_error).
          rs_resp-status = 'error'.
          APPEND |Cannot read maintenance view { is_req-view_name }: { view_error->get_text( ) }|
            TO rs_resp-messages.
          RETURN.
      ENDTRY.
    ENDIF.

    " -- Build the plan ------------------------------------------------------
    " Pre-compute the KEY of every existing target row, so only_missing can skip
    " by key (not by full-row equality - that would clobber target rows whose
    " non-key values differ).  Keys are built with the same DDIC-aware builder
    " used for transport recording, so the comparison is exact.
    IF is_req-only_missing = abap_true.
      LOOP AT <tgt> ASSIGNING <t>.
        CREATE DATA lr_one LIKE <t>.
        ASSIGN lr_one->* TO <one>.
        <one> = <t>.
        APPEND build_tabkey( iv_table = is_req-table ir_row = lr_one ) TO lt_tgt_keys.
      ENDLOOP.
    ENDIF.

    LOOP AT <src> ASSIGNING <row>.
      CREATE DATA lr_new LIKE LINE OF <plan>.
      ASSIGN lr_new->* TO <new>.
      <new> = <row>.
      CLEAR lt_rowx.

      IF in_place = abap_true.
        lv_nk = build_tabkey( iv_table = is_req-table ir_row = lr_new ).
        READ TABLE view_rows INTO DATA(current_view) WITH TABLE KEY tabkey = lv_nk.
        IF sy-subrc <> 0.
          rs_resp-status = 'error'.
          APPEND |Maintenance view { view_name } returned rows but none matched base key '{ lv_nk }'; edit refused|
            TO rs_resp-messages.
          RETURN.
        ENDIF.
        ASSIGN current_view-data->* TO <view>.
        LOOP AT view_fields INTO DATA(view_field).
          ASSIGN COMPONENT view_field-viewfield OF STRUCTURE <new> TO <base_fld>.
          IF sy-subrc = 0.
            CONTINUE.
          ENDIF.
          ASSIGN COMPONENT view_field-viewfield OF STRUCTURE <view> TO <view_fld>.
          IF sy-subrc = 0.
            APPEND VALUE #( field = view_field-viewfield value = <view_fld> ) TO lt_rowx.
          ENDIF.
        ENDLOOP.
      ENDIF.

      ASSIGN COMPONENT is_req-key_field OF STRUCTURE <new> TO <key>.
      IF sy-subrc <> 0.
        rs_resp-status = 'error'.
        APPEND |Key field { is_req-key_field } not found in { is_req-table }|
          TO rs_resp-messages.
        RETURN.
      ENDIF.
      <key> = is_req-target_key.

      LOOP AT lt_overrides INTO DATA(ls_ov).
        IF in_place = abap_true.
          READ TABLE view_fields INTO DATA(override_field)
            WITH KEY viewfield = to_upper( ls_ov-field ).
          IF sy-subrc = 0 AND override_field-keyflag IS NOT INITIAL.
            rs_resp-status = 'error'.
            APPEND |In-place updates cannot change key field { ls_ov-field }|
              TO rs_resp-messages.
            RETURN.
          ENDIF.
        ENDIF.
        ASSIGN COMPONENT to_upper( ls_ov-field ) OF STRUCTURE <new>
          TO FIELD-SYMBOL(<ov>).
        IF sy-subrc <> 0.
          IF <view> IS ASSIGNED.
            ASSIGN COMPONENT to_upper( ls_ov-field ) OF STRUCTURE <view> TO <ov>.
            IF sy-subrc = 0.
              IF is_req-record_transport = abap_false OR lv_flag = 'A'.
                rs_resp-status = 'error'.
                APPEND 'View-only field overrides require the maintenance runtime; direct writes are not supported'
                  TO rs_resp-messages.
                RETURN.
              ENDIF.
              TRY.
                  <ov> = ls_ov-value.
                CATCH cx_root.
                  rs_resp-status = 'error'.
                  APPEND |Override { ls_ov-field } = '{ ls_ov-value }' does not convert to the field type|
                    TO rs_resp-messages.
                  RETURN.
              ENDTRY.
              DELETE lt_rowx WHERE field = to_upper( ls_ov-field ).
              APPEND VALUE #( field = to_upper( ls_ov-field ) value = <ov> ) TO lt_rowx.
              CONTINUE.
            ENDIF.
          ENDIF.
          rs_resp-status = 'error'.
          APPEND |Override field { ls_ov-field } not found in { is_req-table }|
            TO rs_resp-messages.
          RETURN.
        ENDIF.
        TRY.
            <ov> = ls_ov-value.
          CATCH cx_root.
            rs_resp-status = 'error'.
            APPEND |Override { ls_ov-field } = '{ ls_ov-value }' does not convert to the field type|
              TO rs_resp-messages.
            RETURN.
        ENDTRY.
      ENDLOOP.

      IF in_place = abap_true.
        IF build_tabkey( iv_table = is_req-table ir_row = lr_new ) <> lv_nk.
          rs_resp-status = 'error'.
          APPEND 'In-place updates cannot change the base-table key'
            TO rs_resp-messages.
          RETURN.
        ENDIF.
        LOOP AT view_fields INTO DATA(alias_field)
          WHERE bastabname = is_req-table.
          IF alias_field-viewfield = alias_field-bastabfld.
            CONTINUE.
          ENDIF.
          ASSIGN COMPONENT alias_field-bastabfld OF STRUCTURE <new> TO <base_fld>.
          IF sy-subrc = 0.
            DELETE lt_rowx WHERE field = alias_field-viewfield.
            APPEND VALUE #( field = alias_field-viewfield value = <base_fld> ) TO lt_rowx.
          ENDIF.
        ENDLOOP.
      ENDIF.

      IF is_req-only_missing = abap_true.
        " Key-only existence check: skip if the target already has this key.
        CREATE DATA lr_one LIKE <new>.
        ASSIGN lr_one->* TO <one>.
        <one> = <new>.
        lv_nk = build_tabkey( iv_table = is_req-table ir_row = lr_one ).
        READ TABLE lt_tgt_keys TRANSPORTING NO FIELDS
          WITH KEY table_line = lv_nk.
        IF sy-subrc = 0.
          CONTINUE.
        ENDIF.
      ENDIF.

      APPEND <new> TO <plan>.
      LOOP AT lt_rowx INTO DATA(ls_rx).
        ls_rx-row = lines( <plan> ).
        APPEND ls_rx TO lt_extras.
      ENDLOOP.
    ENDLOOP.

    rs_resp-rows_planned = lines( <plan> ).
    IF lt_extras IS NOT INITIAL.
      /ui2/cl_json=>serialize(
        EXPORTING data        = lt_extras
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        RECEIVING r_json      = ls_req-extras_json ).
      APPEND |View-only fields use SAP logon language { sy-langu }; other languages are not copied|
        TO rs_resp-messages.
    ENDIF.

    " -- Dry run -------------------------------------------------------------
    IF is_req-commit = abap_false.
      rs_resp-status = 'ok'.
      rs_resp-extras_json = ls_req-extras_json.
      IF lv_flag = 'A'.
        APPEND |DRY RUN - { rs_resp-rows_planned } row(s) planned (class A: direct write, no transport)|
          TO rs_resp-messages.
      ELSE.
        APPEND |DRY RUN - { rs_resp-rows_planned } row(s) planned|
          TO rs_resp-messages.
      ENDIF.
      /ui2/cl_json=>serialize(
        EXPORTING data        = <plan>
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        RECEIVING r_json      = rs_resp-data_json ).
      RETURN.
    ENDIF.

    " -- Commit --------------------------------------------------------------
    IF rs_resp-rows_planned = 0.
      rs_resp-status = 'ok'.
      APPEND 'Nothing to write - target already complete' TO rs_resp-messages.
      RETURN.
    ENDIF.

    " Shared commit machinery (routing, auth, transport resolution, recorded
    " batch-job write or direct MODIFY). Same path used by handle_create.
    commit_plan( EXPORTING is_req  = ls_req
                           ir_plan = lr_plan
                 CHANGING  cs_resp = rs_resp ).
  ENDMETHOD.


  METHOD commit_plan.
    " Writes the already-built plan in IR_PLAN (a table typed as IS_REQ-TABLE)
    " through the recorded view runtime (C/G/E in a recording client) or a direct
    " MODIFY (class A or RECORD_TRANSPORT=false). Sets
    " CS_RESP status/rows_written/transport and appends messages. Assumes the
    " caller already handled dry-run and the empty-plan case.
        DATA: lv_grp TYPE tddat-cclass,
          lv_enq TYPE rstable-tabname,
          lv_flag TYPE dd02l-contflag.
        FIELD-SYMBOLS <plan> TYPE STANDARD TABLE.

    ASSIGN ir_plan->* TO <plan>.
        DATA(change_verb) = COND string( WHEN is_req-action = 'DEL' THEN 'Deleted' ELSE 'Written' ).
        IF is_req-create_transport = abap_true AND
           ( is_req-transport IS NOT INITIAL OR is_req-record_transport = abap_false ).
          cs_resp-status = 'error'.
          APPEND 'Choose an existing Customizing request or request a new one with recording enabled'
            TO cs_resp-messages.
          RETURN.
        ENDIF.

    " -- Delivery-class routing + client capability ---------------------------
    lv_flag = delivery_class( is_req-table ).
    DATA lv_do_record TYPE abap_bool.
    DATA lv_cl_norecord TYPE abap_bool.
    DATA lv_autocreate TYPE abap_bool.
    CASE lv_flag.
      WHEN 'C' OR 'G' OR 'E'.
        lv_do_record = COND abap_bool(
          WHEN is_req-record_transport = abap_false THEN abap_false ELSE abap_true ).
        eval_client_change(
          EXPORTING iv_table   = is_req-table
          IMPORTING ev_blocked = DATA(lv_cl_blocked)
                    ev_records = DATA(lv_cl_records)
                    ev_reason  = DATA(lv_cl_reason) ).
        IF lv_cl_blocked = abap_true.
          cs_resp-status = 'error'.
          APPEND lv_cl_reason TO cs_resp-messages.
          RETURN.
        ENDIF.
        IF lv_do_record = abap_true AND lv_cl_records = abap_false.
          IF is_req-create_transport = abap_true.
            cs_resp-status = 'error'.
            APPEND |{ lv_cl_reason } - a new Customizing request cannot be used in this client|
              TO cs_resp-messages.
            RETURN.
          ENDIF.
          IF is_req-transport IS NOT INITIAL.
            cs_resp-status = 'error'.
            APPEND |{ lv_cl_reason } - omit TRANSPORT| TO cs_resp-messages.
            RETURN.
          ENDIF.
          lv_cl_norecord = abap_true.
          APPEND lv_cl_reason TO cs_resp-messages.
        ENDIF.
        lv_autocreate = COND abap_bool(
          WHEN lv_do_record = abap_true AND lv_cl_norecord = abap_false
                                        AND is_req-transport IS INITIAL
                                        AND is_req-create_transport = abap_true
          THEN abap_true ELSE abap_false ).
        IF lv_do_record = abap_true AND lv_cl_norecord = abap_false
                                    AND is_req-transport IS INITIAL
                                    AND is_req-create_transport = abap_false.
          cs_resp-status = 'error'.
          APPEND 'No TRANSPORT supplied. Record into an existing open request (preferred), or set CREATE_TRANSPORT=X to mint a new Customizing request.'
            TO cs_resp-messages.
          RETURN.
        ENDIF.
        IF lv_do_record = abap_false AND is_req-transport IS NOT INITIAL.
          cs_resp-status = 'error'.
          APPEND 'TRANSPORT must be omitted when RECORD_TRANSPORT=false (direct-write mode)'
            TO cs_resp-messages.
          RETURN.
        ENDIF.
      WHEN 'A'.
        IF is_req-transport_object = 'TABU' AND is_req-view_name IS INITIAL
           AND is_req-record_transport = abap_true.
          cs_resp-status = 'error'.
          APPEND 'Recorded direct-table mode requires a Customizing table, not application data'
            TO cs_resp-messages.
          RETURN.
        ENDIF.
        IF is_req-create_transport = abap_true.
          cs_resp-status = 'error'.
          APPEND 'Application tables do not support creating a Customizing request'
            TO cs_resp-messages.
          RETURN.
        ENDIF.
        IF is_req-transport IS NOT INITIAL.
          cs_resp-status = 'error'.
          APPEND |{ is_req-table } is delivery class A: TRANSPORT not applicable - omit it|
            TO cs_resp-messages.
          RETURN.
        ENDIF.
        lv_do_record = abap_false.
      WHEN 'S' OR 'W' OR 'L'.
        cs_resp-status = 'error'.
        APPEND |Delivery class '{ lv_flag }': system/temp/local tables are not supported|
          TO cs_resp-messages.
        RETURN.
      WHEN OTHERS.
        cs_resp-status = 'error'.
        APPEND |Delivery class '{ lv_flag }': C/G/E/A supported; S/W/L refused|
          TO cs_resp-messages.
        RETURN.
    ENDCASE.

    lv_grp = auth_group( is_req-table ).
    AUTHORITY-CHECK OBJECT 'S_TABU_DIS'
      ID 'DICBERCLS' FIELD lv_grp
      ID 'ACTVT'     FIELD '02'.
    IF sy-subrc <> 0.
      cs_resp-status = 'error'.
      APPEND |Not authorized: S_TABU_DIS / { lv_grp } / 02|
        TO cs_resp-messages.
      RETURN.
    ENDIF.

    IF lv_do_record = abap_true.
      " -- Batch-job path: maintenance runtime, headless recording, and commit --
      DATA(ls_wreq) = is_req.
      DATA: lv_utask    TYPE trkorr,
            lv_ureq     TYPE trkorr,
            lv_tcreated TYPE abap_bool,
            lv_tmsg     TYPE string.
      IF lv_autocreate = abap_true.
        DATA(lv_tr_text) = COND as4text(
          WHEN is_req-transport_text IS NOT INITIAL
            THEN CONV as4text( is_req-transport_text )
          WHEN is_req-source_key IS NOT INITIAL
            THEN |ABAP FS cust { is_req-table } { is_req-source_key }->{ is_req-target_key }|
          ELSE |ABAP FS cust create { is_req-table }| ).
        create_cust_transport(
          EXPORTING iv_text    = lv_tr_text
          IMPORTING ev_request = DATA(lv_req)
                    ev_task    = DATA(lv_task) ).
        IF lv_req IS INITIAL.
          cs_resp-status = 'error'.
          APPEND 'Could not create a Customizing request (TR_INSERT_REQUEST_WITH_TASKS failed)'
            TO cs_resp-messages.
          RETURN.
        ENDIF.
        ls_wreq-transport = lv_task.
        cs_resp-transport = lv_req.
        APPEND |Created Customizing request { lv_req } (task { lv_task })| TO cs_resp-messages.

      ELSEIF is_req-transport IS NOT INITIAL.
        ensure_user_task(
          EXPORTING iv_transport = CONV trkorr( is_req-transport )
          IMPORTING ev_task      = lv_utask
                    ev_request   = lv_ureq
                    ev_created   = lv_tcreated
                    ev_msg       = lv_tmsg ).
        IF lv_tmsg IS NOT INITIAL.
          cs_resp-status = 'error'.
          APPEND lv_tmsg TO cs_resp-messages.
          RETURN.
        ENDIF.
        ls_wreq-transport = lv_utask.
        cs_resp-transport = lv_ureq.
        IF lv_tcreated = abap_true.
          APPEND |Created customizing task { lv_utask } for { sy-uname } under request { lv_ureq }|
            TO cs_resp-messages.
        ENDIF.
      ENDIF.

      DATA ls_br TYPE ty_batch_result.
      CALL METHOD me->submit_batch_write
        EXPORTING
          is_req    = ls_wreq
          ir_plan   = ir_plan
        CHANGING
          ct_messages = cs_resp-messages
        RECEIVING
          rs_res    = ls_br.

      IF ls_br-pending = abap_true.
        cs_resp-status = 'pending'.
        cs_resp-run_id = ls_br-run_id.
        APPEND |Job submitted - run_id { ls_br-run_id } (poll customizing_status)|
          TO cs_resp-messages.
      ELSEIF ls_br-ok = abap_true.
        cs_resp-status       = 'ok'.
        cs_resp-rows_written = ls_br-rows_written.
        IF lv_cl_norecord = abap_true.
          APPEND |{ change_verb } { ls_br-rows_written } row(s) via the view runtime (client { sy-mandt } records no transport)|
            TO cs_resp-messages.
        ELSE.
          APPEND |{ change_verb } { ls_br-rows_written } row(s) -> { cs_resp-transport } ({ ls_br-e071k_count } E071K entries)|
            TO cs_resp-messages.
        ENDIF.
      ELSE.
        cs_resp-status = 'error'.
      ENDIF.
    ELSE.
      " -- Direct-write path: class A or explicit RECORD_TRANSPORT=false --------
      lv_enq = to_upper( is_req-table ).
      CALL FUNCTION 'ENQUEUE_E_TABLE'
        EXPORTING
          mode_rstable = 'E'
          tabname      = lv_enq
        EXCEPTIONS
          foreign_lock   = 1
          system_failure = 2
          OTHERS         = 3.
      IF sy-subrc <> 0.
        cs_resp-status = 'error'.
        APPEND |ENQUEUE failed for { is_req-table } (subrc { sy-subrc })|
          TO cs_resp-messages.
        RETURN.
      ENDIF.

      TRY.
          MODIFY (is_req-table) FROM TABLE <plan>.
          cs_resp-rows_written = sy-dbcnt.
          COMMIT WORK AND WAIT.
          cs_resp-status = 'ok'.
          APPEND |Written { cs_resp-rows_written } row(s) (direct, no transport)|
            TO cs_resp-messages.
        CATCH cx_root INTO DATA(lx_wr).
          ROLLBACK WORK.
          cs_resp-status = 'error'.
          APPEND |Commit failed: { lx_wr->get_text( ) }| TO cs_resp-messages.
      ENDTRY.

      CALL FUNCTION 'DEQUEUE_E_TABLE'
        EXPORTING mode_rstable = 'E' tabname = lv_enq.
    ENDIF.
  ENDMETHOD.


  METHOD handle_create.
    " Build a plan of rows from explicit field/value maps (full key, no source)
    " and commit it through the shared commit_plan path. Supports composite keys
    " and distinct per-row values - what the single-key copy (handle_write) can't.
    DATA: lr_plan TYPE REF TO data,
          lr_new  TYPE REF TO data,
          lv_flag TYPE dd02l-contflag.
    FIELD-SYMBOLS: <plan> TYPE STANDARD TABLE,
                   <new>  TYPE any,
                   <fld>  TYPE any.

    " rows_json = JSON array of rows; each row a JSON array of {FIELD,VALUE}.
    TYPES: ty_prow  TYPE STANDARD TABLE OF ty_field_value WITH DEFAULT KEY.
    DATA lt_rows TYPE STANDARD TABLE OF ty_prow WITH DEFAULT KEY.
    DATA required_keys TYPE STANDARD TABLE OF dd03l-fieldname WITH DEFAULT KEY.
    DATA supplied_fields TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.

    " Fields the maintenance view has and the base table does not - a text
    " table's description, typically. They cannot live in the base-table plan,
    " so they travel beside it, keyed by plan row, and the writer puts them into
    " the view entry.
    TYPES: BEGIN OF ty_extra,
             row   TYPE i,
             field TYPE string,
             value TYPE string,
           END OF ty_extra.
    DATA: lt_extras  TYPE STANDARD TABLE OF ty_extra WITH DEFAULT KEY,
          lt_rowx    TYPE STANDARD TABLE OF ty_extra WITH DEFAULT KEY,
          lr_view    TYPE REF TO data,
          ls_req     TYPE ty_request.
    FIELD-SYMBOLS <view> TYPE any.
    ls_req = is_req.
    IF is_req-view_name IS NOT INITIAL.
      TRY.
          CREATE DATA lr_view TYPE (is_req-view_name).
          ASSIGN lr_view->* TO <view>.
        CATCH cx_root.
          CLEAR lr_view.
      ENDTRY.
    ENDIF.

    rs_resp-operation = 'create'.
    rs_resp-table     = is_req-table.
    rs_resp-transport = is_req-transport.
    rs_resp-dry_run   = COND #( WHEN is_req-commit = abap_true
                                THEN abap_false ELSE abap_true ).

    IF is_valid_name( is_req-table ) = abap_false.
      rs_resp-status = 'error'.
      APPEND 'Invalid table name' TO rs_resp-messages.
      RETURN.
    ENDIF.
    IF is_req-rows_json IS INITIAL.
      rs_resp-status = 'error'.
      APPEND 'ROWS_JSON is required (a JSON array of rows, each an array of {FIELD,VALUE})'
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    TRY.
        /ui2/cl_json=>deserialize(
          EXPORTING json        = is_req-rows_json
                    pretty_name = /ui2/cl_json=>pretty_mode-none
          CHANGING  data        = lt_rows ).
      CATCH cx_root INTO DATA(lx_rj).
        rs_resp-status = 'error'.
        APPEND |Cannot parse ROWS_JSON: { lx_rj->get_text( ) }| TO rs_resp-messages.
        RETURN.
    ENDTRY.
    IF lines( lt_rows ) = 0.
      rs_resp-status = 'error'.
      APPEND 'ROWS_JSON contained no rows' TO rs_resp-messages.
      RETURN.
    ENDIF.

    TRY.
        CREATE DATA lr_plan TYPE STANDARD TABLE OF (is_req-table).
        ASSIGN lr_plan->* TO <plan>.
      CATCH cx_root INTO DATA(lx_ce).
        rs_resp-status = 'error'.
        APPEND |Cannot type table { is_req-table }: { lx_ce->get_text( ) }|
          TO rs_resp-messages.
        RETURN.
    ENDTRY.

    SELECT fieldname FROM dd03l INTO TABLE required_keys
      WHERE tabname = is_req-table AND as4local = 'A' AND keyflag = 'X'
        AND datatype <> 'CLNT' AND fieldname NOT LIKE '.%'.

    " -- Build each row from its field/value pairs -----------------------------
    LOOP AT lt_rows INTO DATA(lt_fields).
      CREATE DATA lr_new LIKE LINE OF <plan>.
      ASSIGN lr_new->* TO <new>.
      CLEAR <new>.
      CLEAR lt_rowx.
      CLEAR supplied_fields.
      LOOP AT lt_fields INTO DATA(ls_fv).
        IF is_valid_name( ls_fv-field ) = abap_false.
          rs_resp-status = 'error'.
          APPEND |Invalid field name '{ ls_fv-field }'| TO rs_resp-messages.
          RETURN.
        ENDIF.
        ls_fv-field = to_upper( ls_fv-field ).
        INSERT ls_fv-field INTO TABLE supplied_fields.
        ASSIGN COMPONENT to_upper( ls_fv-field ) OF STRUCTURE <new> TO <fld>.
        IF sy-subrc <> 0.
          IF lr_view IS BOUND.
            ASSIGN COMPONENT to_upper( ls_fv-field ) OF STRUCTURE <view> TO <fld>.
            IF sy-subrc = 0.
              APPEND VALUE #( field = to_upper( ls_fv-field ) value = ls_fv-value ) TO lt_rowx.
              CONTINUE.
            ENDIF.
          ENDIF.
          rs_resp-status = 'error'.
          APPEND |Field { ls_fv-field } not found in { is_req-table }| &&
                 COND string( WHEN lr_view IS BOUND THEN | or its maintenance view { is_req-view_name }| ) TO rs_resp-messages.
          RETURN.
        ENDIF.
        TRY.
            <fld> = ls_fv-value.
          CATCH cx_root.
            rs_resp-status = 'error'.
            APPEND |Value '{ ls_fv-value }' for { ls_fv-field } does not convert to the field type|
              TO rs_resp-messages.
            RETURN.
        ENDTRY.
      ENDLOOP.

      LOOP AT required_keys INTO DATA(required_key).
        READ TABLE supplied_fields TRANSPORTING NO FIELDS WITH TABLE KEY table_line = required_key.
        IF sy-subrc <> 0.
          rs_resp-status = 'error'.
          APPEND |Every explicit row must supply key field { required_key }, including an explicit blank when intended|
            TO rs_resp-messages.
          RETURN.
        ENDIF.
      ENDLOOP.

      " ONLY_MISSING: skip rows whose key already exists (idempotent create)
      IF is_req-only_missing = abap_true.
        IF row_exists( iv_table = is_req-table ir_row = lr_new ) = abap_true.
          CONTINUE.
        ENDIF.
      ENDIF.

      APPEND <new> TO <plan>.
      LOOP AT lt_rowx INTO DATA(ls_rx).
        ls_rx-row = lines( <plan> ).
        APPEND ls_rx TO lt_extras.
      ENDLOOP.
    ENDLOOP.

    rs_resp-rows_planned = lines( <plan> ).
    IF lt_extras IS NOT INITIAL.
      /ui2/cl_json=>serialize(
        EXPORTING data        = lt_extras
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        RECEIVING r_json      = ls_req-extras_json ).
    ENDIF.
    lv_flag = delivery_class( is_req-table ).
    IF lt_extras IS NOT INITIAL AND
       ( is_req-record_transport = abap_false OR lv_flag = 'A' ).
      rs_resp-status = 'error'.
      APPEND 'View-only fields require maintenance processing and cannot be written in direct-table mode'
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    " -- Dry run ---------------------------------------------------------------
    IF is_req-commit = abap_false.
      rs_resp-status = 'ok'.
      rs_resp-extras_json = ls_req-extras_json.
      IF is_req-view_name IS INITIAL OR is_req-record_transport = abap_false OR lv_flag = 'A'.
        APPEND 'Direct base-table write planned; maintenance-view checks will not run'
          TO rs_resp-messages.
      ENDIF.
      APPEND |DRY RUN - { rs_resp-rows_planned } row(s) planned| TO rs_resp-messages.
      /ui2/cl_json=>serialize(
        EXPORTING data        = <plan>
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        RECEIVING r_json      = rs_resp-data_json ).
      RETURN.
    ENDIF.

    IF rs_resp-rows_planned = 0.
      rs_resp-status = 'ok'.
      APPEND 'Nothing to create - all rows already present' TO rs_resp-messages.
      RETURN.
    ENDIF.

    commit_plan( EXPORTING is_req  = ls_req
                           ir_plan = lr_plan
                 CHANGING  cs_resp = rs_resp ).
  ENDMETHOD.


  METHOD row_exists.
    DATA: lt_fields TYPE STANDARD TABLE OF dd03l,
          lv_tab    TYPE tabname,
          lv_where  TYPE string,
          lv_cnt    TYPE i.
    FIELD-SYMBOLS: <row> TYPE any,
                   <fld> TYPE any.

    ASSIGN ir_row->* TO <row>.
    lv_tab = to_upper( iv_table ).

    SELECT fieldname datatype FROM dd03l
      INTO CORRESPONDING FIELDS OF TABLE lt_fields
      WHERE tabname  = lv_tab
        AND as4local = 'A'
        AND keyflag  = 'X'
        AND fieldname NOT LIKE '.%'
      ORDER BY position.

    LOOP AT lt_fields INTO DATA(ls_f).
      IF ls_f-datatype = 'CLNT'.
        CONTINUE.   " client handled implicitly by the SELECT
      ENDIF.
      ASSIGN COMPONENT ls_f-fieldname OF STRUCTURE <row> TO <fld>.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      DATA(lv_cond) = |{ ls_f-fieldname } = '{ esc_quote( CONV string( <fld> ) ) }'|.
      IF lv_where IS INITIAL.
        lv_where = lv_cond.
      ELSE.
        lv_where = |{ lv_where } AND { lv_cond }|.
      ENDIF.
    ENDLOOP.

    IF lv_where IS INITIAL.
      rv_ok = abap_false.
      RETURN.
    ENDIF.

    SELECT COUNT(*) FROM (lv_tab) INTO lv_cnt WHERE (lv_where).
    rv_ok = COND #( WHEN lv_cnt > 0 THEN abap_true ELSE abap_false ).
  ENDMETHOD.




  METHOD handle_delete.
    " SM30-standard delete: remove the entry/entries whose KEY_FIELD = TARGET_KEY
    " through the maintenance-view runtime (VIEW_MAINTENANCE_SINGLE_ENTRY action
        " 'DEL'). The batch writer records transport keys and checks for surviving rows.
    DATA: lr_plan  TYPE REF TO data,
          lv_where TYPE string,
          lv_flag  TYPE dd02l-contflag,
          lv_grp   TYPE tddat-cclass.
        FIELD-SYMBOLS <plan> TYPE STANDARD TABLE.

    rs_resp-operation = 'delete'.
    rs_resp-table     = is_req-table.
    rs_resp-transport = is_req-transport.
    rs_resp-dry_run   = COND #( WHEN is_req-commit = abap_true
                                THEN abap_false ELSE abap_true ).

    " -- Guard rails ---------------------------------------------------------
    IF is_valid_name( is_req-table ) = abap_false
    OR is_valid_name( is_req-key_field ) = abap_false.
      rs_resp-status = 'error'.
      APPEND 'Invalid table or key field name' TO rs_resp-messages.
      RETURN.
    ENDIF.

    IF is_req-target_key IS INITIAL.
      rs_resp-status = 'error'.
      APPEND 'TARGET_KEY (the entry to delete) is required' TO rs_resp-messages.
      RETURN.
    ENDIF.

    " Delete runs through the SM30 view runtime, so a maintenance view is required.
    IF is_req-view_name IS INITIAL.
      rs_resp-status = 'error'.
      APPEND |No maintenance view resolved for { is_req-table } - SM30-standard delete not available|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    " -- Delivery class: recorded customizing only ---------------------------
    lv_flag = delivery_class( is_req-table ).
    CASE lv_flag.
      WHEN 'C' OR 'G' OR 'E'.
        DATA(lv_do_record) = COND abap_bool(
          WHEN is_req-record_transport = abap_false THEN abap_false ELSE abap_true ).
        IF lv_do_record = abap_false.
          rs_resp-status = 'error'.
          APPEND 'Delete is supported only as a transport-recorded customizing change (RECORD_TRANSPORT must stay true)'
            TO rs_resp-messages.
          RETURN.
        ENDIF.

        " Client capability (T000/SCC4): non-recording client -> the deletion goes
        " through the SM30 view runtime but isn't recorded onto a transport; a
        " "no changes" client forbids it.  (See handle_write for the rationale.)
        eval_client_change(
          EXPORTING iv_table   = is_req-table
          IMPORTING ev_blocked = DATA(lv_cl_blocked)
                    ev_records = DATA(lv_cl_records)
                    ev_reason  = DATA(lv_cl_reason) ).
        IF lv_cl_blocked = abap_true.
          rs_resp-status = 'error'.
          APPEND lv_cl_reason TO rs_resp-messages.
          RETURN.
        ENDIF.
        IF lv_cl_records = abap_false.
          IF is_req-transport IS NOT INITIAL.
            rs_resp-status = 'error'.
            APPEND |{ lv_cl_reason } - omit TRANSPORT| TO rs_resp-messages.
            RETURN.
          ENDIF.
          APPEND lv_cl_reason TO rs_resp-messages.
        ENDIF.
      WHEN OTHERS.
        rs_resp-status = 'error'.
        APPEND |Delivery class '{ lv_flag }': delete supported only for recorded customizing (C/G/E)|
          TO rs_resp-messages.
        RETURN.
    ENDCASE.

    lv_grp = auth_group( is_req-table ).
    AUTHORITY-CHECK OBJECT 'S_TABU_DIS'
      ID 'DICBERCLS' FIELD lv_grp
      ID 'ACTVT'     FIELD '02'.
    IF sy-subrc <> 0.
      rs_resp-status = 'error'.
      APPEND |Not authorized: S_TABU_DIS / { lv_grp } / 02| TO rs_resp-messages.
      RETURN.
    ENDIF.

    " -- Read the entries to delete (plan = existing rows for that key) -------
    TRY.
        CREATE DATA lr_plan TYPE STANDARD TABLE OF (is_req-table).
        ASSIGN lr_plan->* TO <plan>.
      CATCH cx_root INTO DATA(lx_ce).
        rs_resp-status = 'error'.
        APPEND |Cannot type table { is_req-table }: { lx_ce->get_text( ) }| TO rs_resp-messages.
        RETURN.
    ENDTRY.

    lv_where = |{ is_req-key_field } = '{ esc_quote( is_req-target_key ) }'|.
    SELECT * FROM (is_req-table) INTO TABLE <plan> WHERE (lv_where).
    rs_resp-rows_planned = lines( <plan> ).

    " -- Dry run -------------------------------------------------------------
    IF is_req-commit = abap_false.
      rs_resp-status = 'ok'.
      APPEND |DRY RUN - { rs_resp-rows_planned } row(s) would be deleted via { is_req-view_name }|
        TO rs_resp-messages.
      /ui2/cl_json=>serialize(
        EXPORTING data        = <plan>
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        RECEIVING r_json      = rs_resp-data_json ).
      RETURN.
    ENDIF.

    IF rs_resp-rows_planned = 0.
      rs_resp-status = 'ok'.
      APPEND 'Nothing to delete - no entry with that key' TO rs_resp-messages.
      RETURN.
    ENDIF.

    " -- Recorded delete via the background writer (action 'DEL') -------------
    DATA(ls_wreq)  = is_req.
    ls_wreq-action = 'DEL'.
    commit_plan( EXPORTING is_req  = ls_wreq
                           ir_plan = lr_plan
                 CHANGING  cs_resp = rs_resp ).
  ENDMETHOD.




  METHOD is_valid_name.
    DATA lv TYPE string.
    DATA lc TYPE i.
    rv_ok = abap_true.
    lv = to_upper( iv_name ).
    IF lv IS INITIAL OR strlen( lv ) > 30.
      rv_ok = abap_false.
      RETURN.
    ENDIF.
    " Find any character that is NOT A-Z, 0-9, _, /
    FIND FIRST OCCURRENCE OF REGEX '[^A-Z0-9_/]' IN lv MATCH OFFSET DATA(lo).
    IF sy-subrc = 0.
      rv_ok = abap_false.
    ENDIF.
  ENDMETHOD.


  METHOD delivery_class.
    DATA lv_tabname TYPE tabname.
    lv_tabname = to_upper( iv_table ).
    SELECT SINGLE contflag FROM dd02l INTO rv_flag
      WHERE tabname  = lv_tabname
        AND as4local = 'A'.
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


  METHOD fm_exists.
    SELECT SINGLE @abap_true FROM tfdir INTO @rv_ok
      WHERE funcname = @iv_fm.
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


  METHOD is_client_dependent.
    DATA lv_tabname TYPE tabname.
    lv_tabname = to_upper( iv_table ).
    SELECT SINGLE @abap_true FROM dd03l INTO @rv_flag
      WHERE tabname  = @lv_tabname
        AND fieldname = 'MANDT'
        AND keyflag   = 'X'
        AND as4local  = 'A'.
  ENDMETHOD.


  METHOD eval_client_change.
    DATA(ls_caps) = client_caps( ).
    IF is_client_dependent( iv_table ) = abap_true.
      " Client-dependent customizing -> governed by CCCORACTIV.
      CASE ls_caps-coractiv.
        WHEN '1'.
          ev_records = abap_true.
        WHEN '2'.
          ev_blocked = abap_true.
          ev_reason  = |Client { sy-mandt }: no changes allowed (T000-CCCORACTIV='2')|.
        WHEN OTHERS.   " '' or '3' - changes allowed but not recorded
          ev_records = abap_false.
          ev_reason  = |Client { sy-mandt } is set to '{ ls_caps-text }' | &&
                       |(CCCORACTIV='{ ls_caps-coractiv }') - the change is written but not recorded onto a transport|.
      ENDCASE.
    ELSE.
      " Cross-client (client-independent) customizing -> governed by CCNOCLIIND.
      " Such changes ARE recorded when allowed; blocked by '1'/'3'.
      IF ls_caps-nocliind = '1' OR ls_caps-nocliind = '3'.
        ev_blocked = abap_true.
        ev_reason  = |Client { sy-mandt }: cross-client customizing changes are blocked (T000-CCNOCLIIND='{ ls_caps-nocliind }')|.
      ELSE.
        ev_records = abap_true.
      ENDIF.
    ENDIF.
  ENDMETHOD.


  METHOD auth_group.
    DATA lv_tabname TYPE tabname.
    lv_tabname = to_upper( iv_table ).
    SELECT SINGLE cclass FROM tddat INTO rv_group
      WHERE tabname = lv_tabname.
    IF rv_group IS INITIAL.
      rv_group = '&NC&'.
    ENDIF.
  ENDMETHOD.


  METHOD esc_quote.
    rv_val = iv_val.
    REPLACE ALL OCCURRENCES OF '''' IN rv_val WITH ''''''.
  ENDMETHOD.


  METHOD build_tabkey.
    " Build the flat E071K TABKEY exactly as the transport layer expects:
    " key fields in DDIC position order, each occupying its full DDIC length,
    " concatenated with NO separators and trailing blanks preserved.  The
    " client field comes first for client-dependent tables and is forced to the
    " current client.  Values are taken in their internal/character form (a
    " plain move into a CHAR buffer), which is correct for CLNT/CHAR/NUMC/DATS
    " key fields (incl. TCURR-GDATU, an inverted NUMC8 date).
    DATA: lt_fields  TYPE STANDARD TABLE OF dd03l,
          ls_field   TYPE dd03l,
          lv_tabname TYPE tabname,
          lv_key     TYPE string,
          lv_buf     TYPE c LENGTH 256,
          lv_len     TYPE i.
    FIELD-SYMBOLS: <row> TYPE any,
                   <fld> TYPE any.

    ASSIGN ir_row->* TO <row>.
    lv_tabname = to_upper( iv_table ).

    SELECT fieldname position leng datatype FROM dd03l
      INTO CORRESPONDING FIELDS OF TABLE lt_fields
      WHERE tabname  = lv_tabname
        AND as4local = 'A'
        AND keyflag  = 'X'
        AND fieldname NOT LIKE '.%'      " skip .INCLUDE / structure pseudo-rows
      ORDER BY position.

    LOOP AT lt_fields INTO ls_field.
      CLEAR lv_buf.
      IF ls_field-datatype = 'CLNT'.
        lv_buf = sy-mandt.               " client field -> current client
      ELSE.
        ASSIGN COMPONENT ls_field-fieldname OF STRUCTURE <row> TO <fld>.
        IF sy-subrc <> 0.
          CONTINUE.
        ENDIF.
        lv_buf = <fld>.                  " internal char form, left-justified
      ENDIF.

      lv_len = ls_field-leng.
      IF lv_len > 256.
        lv_len = 256.
      ENDIF.

      " Concatenate at the field's full DDIC length, preserving trailing blanks
      CONCATENATE lv_key lv_buf(lv_len) INTO lv_key RESPECTING BLANKS.
    ENDLOOP.

    rv_key = lv_key.
  ENDMETHOD.


  METHOD handle_status.
    " Poll a prior async write by run_id.  Honest, idempotent lifecycle:
    "   FR (result) present   -> terminal: return it and KEEP it (a lost HTTP
    "                            response must not destroy the outcome); drop the
    "                            bulky FP params only.
    "   no FR, FJ handle -> TBTCO: R=running, Y/P/S=queued, A=aborted,
    "                            F-without-result=aborted (dumped mid-run).
    "   no FR, no FJ          -> genuinely unknown/expired (NOT 'still running').
    " cleanup_stale_runs ages FJ/FR/FP out so results stay re-readable a while
    " without accumulating. handle_status leaves FJ/FR retention to cleanup.
    DATA: ls_jres TYPE ty_jres,
          ls_jh   TYPE ty_jhandle.
    rs_resp-operation = 'status'.
    rs_resp-run_id    = is_req-run_id.

    IF is_req-run_id IS INITIAL.
      rs_resp-status = 'error'.
      APPEND 'run_id is required for operation status' TO rs_resp-messages.
      RETURN.
    ENDIF.

    cleanup_stale_runs( ).

    " 1) Terminal result present - return it idempotently (do NOT delete FR).
    IMPORT data = ls_jres FROM DATABASE indx(FR) ID is_req-run_id.
    IF sy-subrc = 0.
      rs_resp-status       = ls_jres-status.
      rs_resp-rows_written = ls_jres-rows_written.
      rs_resp-transport    = ls_jres-transport.
      LOOP AT ls_jres-messages INTO DATA(lv_m).
        APPEND lv_m TO rs_resp-messages.
      ENDLOOP.
      DELETE FROM DATABASE indx(FP) ID is_req-run_id.   " params no longer needed
      RETURN.
    ENDIF.

    " 2) No result yet - consult the job handle + TBTCO.
    IMPORT data = ls_jh FROM DATABASE indx(FJ) ID is_req-run_id.
    IF sy-subrc <> 0.
      rs_resp-status = 'unknown'.
      APPEND |run_id { is_req-run_id } is unknown or expired - no job handle and no result. | &&
             |If it finished long ago its result may have aged out; otherwise the run_id is wrong.|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    rs_resp-transport = ls_jh-transport.
    IF ls_jh-transport IS NOT INITIAL.
      SELECT SINGLE strkorr FROM e070 INTO @DATA(parent_request)
        WHERE trkorr = @ls_jh-transport.
      IF sy-subrc = 0 AND parent_request IS NOT INITIAL.
        rs_resp-transport = parent_request.
      ENDIF.
    ENDIF.

    DATA lv_jstat TYPE btcstatus.
    SELECT SINGLE status FROM tbtco INTO @lv_jstat
      WHERE jobname = @ls_jh-jobname AND jobcount = @ls_jh-jobcount.
    IF sy-subrc <> 0.
      rs_resp-status = 'pending'.
      APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } is scheduled (not yet in TBTCO)|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    CASE lv_jstat.
      WHEN 'R'.                       " active / running
        rs_resp-status = 'running'.
        APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } is RUNNING (active, TBTCO 'R'). | &&
               |{ job_progress_note( ) }| TO rs_resp-messages.
      WHEN 'Y' OR 'P' OR 'S'.         " ready / scheduled / released -> waiting for a WP
        rs_resp-status = 'pending'.
        APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } is queued (TBTCO '{ lv_jstat }'), | &&
               |waiting for a free background work process| TO rs_resp-messages.
      WHEN 'A'.                       " aborted / cancelled
        rs_resp-status = 'aborted'.
        APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } was ABORTED (cancelled or failed, | &&
               |TBTCO 'A') - no result was written.| TO rs_resp-messages.
        job_log_errors( EXPORTING iv_jobname = ls_jh-jobname iv_jobcount = ls_jh-jobcount
                        CHANGING  ct_messages = rs_resp-messages ).
      WHEN 'F'.                       " finished but wrote no FR result
        rs_resp-status = 'aborted'.
        APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } FINISHED (TBTCO 'F') but produced no | &&
               |result - it likely dumped mid-run. Check ST22.| TO rs_resp-messages.
        job_log_errors( EXPORTING iv_jobname = ls_jh-jobname iv_jobcount = ls_jh-jobcount
                        CHANGING  ct_messages = rs_resp-messages ).
      WHEN OTHERS.
        rs_resp-status = 'pending'.
        APPEND |Job { ls_jh-jobname }/{ ls_jh-jobcount } TBTCO status '{ lv_jstat }'|
          TO rs_resp-messages.
    ENDCASE.
  ENDMETHOD.


  METHOD job_log_errors.
    DATA: lt_log   TYPE STANDARD TABLE OF tbtc5,
          lv_found TYPE abap_bool.
    CALL FUNCTION 'BP_JOBLOG_READ'
      EXPORTING  jobcount  = iv_jobcount
                 jobname   = iv_jobname
      TABLES     joblogtbl = lt_log
      EXCEPTIONS OTHERS    = 1.
    IF sy-subrc <> 0.
      APPEND `(The job log could not be read - see SM37.)` TO ct_messages.
      RETURN.
    ENDIF.
    LOOP AT lt_log INTO DATA(ls_log) WHERE msgtype CA 'EAX'.
      " 00564 "Job canceled after system exception ..." only repeats the outcome.
      CHECK NOT ( ls_log-msgid = '00' AND ls_log-msgno = '564' ).
      APPEND |Job log: { ls_log-msgid }{ ls_log-msgno } { ls_log-text }| TO ct_messages.
      lv_found = abap_true.
    ENDLOOP.
    IF lv_found = abap_false.
      APPEND `The job log names no error - see SM37 / ST22.` TO ct_messages.
    ENDIF.
  ENDMETHOD.


  METHOD job_progress_note.
    " Best-effort: the current program/action/table of the job's background WP,
    " so a long 'running' shows it is progressing (a different program each poll)
    " rather than wedged.  WP_REPORT reflects the *currently executing* unit
    " (often a called SAP program, not ZABAPFS_CUST_WRITE), so match by user+type.
    DATA lt_wp TYPE STANDARD TABLE OF wpinfo.
    CALL FUNCTION 'TH_WPINFO'
      TABLES     wplist = lt_wp
      EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    DATA lv_rep TYPE string.
    LOOP AT lt_wp INTO DATA(ls_wp)
        WHERE wp_typ = 'BGD' AND wp_bname = sy-uname AND wp_istatus = 4.  " 4 = running
      lv_rep = ls_wp-wp_report.
      REPLACE ALL OCCURRENCES OF '=' IN lv_rep WITH ''.   " CL_...===CP -> CL_...CP
      rv_note = |Progressing - currently { lv_rep } | &&
                COND string( WHEN ls_wp-wp_action IS NOT INITIAL
                             THEN |({ ls_wp-wp_action }{ COND string( WHEN ls_wp-wp_table IS NOT INITIAL
                                                                      THEN | { ls_wp-wp_table }| ) }) | )
                && |after { ls_wp-wp_eltime }s|.
      RETURN.
    ENDLOOP.
  ENDMETHOD.


  METHOD cleanup_stale_runs.
    " Sweep INDX FJ (job handles) - the age anchor - and drop the run's FJ/FR/FP
    " once its handle is older than the retention window (6 h same day, or any
    " earlier day). Handful of runs per session, so this is cheap.
    DATA: lt_srt TYPE STANDARD TABLE OF indx-srtfd,
          ls_jh  TYPE ty_jhandle.
    SELECT srtfd FROM indx INTO TABLE @lt_srt WHERE relid = 'FJ'.
    LOOP AT lt_srt INTO DATA(lv_srt).
      IMPORT data = ls_jh FROM DATABASE indx(FJ) ID lv_srt.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      IF ls_jh-cdate < sy-datum
         OR ( ls_jh-cdate = sy-datum AND ( sy-uzeit - ls_jh-ctime ) > 21600 ).
        DELETE FROM DATABASE indx(FJ) ID lv_srt.
        DELETE FROM DATABASE indx(FR) ID lv_srt.
        DELETE FROM DATABASE indx(FP) ID lv_srt.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD write_job_handle.
    DATA ls_jh TYPE ty_jhandle.
    ls_jh-jobname   = iv_jobname.
    ls_jh-jobcount  = iv_jobcount.
    ls_jh-run_kind  = iv_kind.
    ls_jh-table     = iv_table.
    ls_jh-transport = iv_transport.
    ls_jh-cdate     = sy-datum.
    ls_jh-ctime     = sy-uzeit.
    EXPORT data = ls_jh TO DATABASE indx(FJ) ID iv_run_id.
  ENDMETHOD.


  METHOD handle_img_search.
    " Full CUS_IMGACT scan with a server-side LIKE over BOTH the title TEXT and
    " the activity id, joined to CUS_ACTOBJ for the maintenance object. Open SQL
    " LIKE is unrestricted here (the ADT Data-Preview endpoint's LIKE ban and its
    " 200-row alphabetical window do not apply), so component-acronym searches
    " (e.g. 'TSW' -> SIMG_OIJ_TSW_*, whose functional titles never say 'TSW') work.
        DATA: lv_lang     TYPE spras,
          lv_kw       TYPE string,
          lv_text     TYPE string,
          lv_activity TYPE string,
          lv_max      TYPE i.
    rs_resp-operation = 'img_search'.
    rs_resp-version   = c_version.

    lv_kw = is_req-keyword.
    TRANSLATE lv_kw TO UPPER CASE.
    IF lv_kw IS INITIAL.
      rs_resp-status = 'error'.
      APPEND 'img_search needs a keyword' TO rs_resp-messages.
      RETURN.
    ENDIF.
    lv_lang = COND #( WHEN is_req-language IS NOT INITIAL THEN is_req-language(1) ELSE 'E' ).
    lv_max  = COND #( WHEN is_req-max_rows > 0 THEN is_req-max_rows ELSE 200 ).

    TYPES: BEGIN OF ty_hit,
             activity   TYPE cus_imgact-activity,
             text       TYPE cus_imgact-text,
             objecttype TYPE cus_actobj-objecttype,
             objectname TYPE cus_actobj-objectname,
             tcode      TYPE cus_actobj-tcode,
           END OF ty_hit.
          DATA: lt_hit TYPE STANDARD TABLE OF ty_hit,
                ls_hit TYPE ty_hit.

    TRY.
        SELECT a~activity, a~text, o~objecttype, o~objectname, o~tcode
          FROM cus_imgact AS a
          LEFT OUTER JOIN cus_actobj AS o ON o~act_id = a~activity
          WHERE a~spras = @lv_lang
          ORDER BY a~activity
                INTO CORRESPONDING FIELDS OF @ls_hit.
                lv_text = ls_hit-text.
                TRANSLATE lv_text TO UPPER CASE.
                lv_activity = ls_hit-activity.
                TRANSLATE lv_activity TO UPPER CASE.
                IF lv_text CS lv_kw OR lv_activity CS lv_kw.
                  APPEND ls_hit TO lt_hit.
                  IF lines( lt_hit ) >= lv_max.
                    EXIT.
                  ENDIF.
                ENDIF.
              ENDSELECT.
      CATCH cx_sy_open_sql_db INTO DATA(lx_sql).
        rs_resp-status = 'error'.
        APPEND |img_search SQL failed: { lx_sql->get_text( ) }| TO rs_resp-messages.
        RETURN.
    ENDTRY.

    rs_resp-status       = 'ok'.
    rs_resp-rows_planned = lines( lt_hit ).
    APPEND |Found { lines( lt_hit ) } IMG activit{ COND string( WHEN lines( lt_hit ) = 1 THEN 'y' ELSE 'ies' ) }| &&
           | matching '{ lv_kw }' (title or activity id, full CUS_IMGACT scan)|
      TO rs_resp-messages.
    IF lines( lt_hit ) >= lv_max.
      APPEND |Result capped at { lv_max } rows - raise max_rows or narrow the keyword for the rest|
        TO rs_resp-messages.
    ENDIF.
    rs_resp-data_json = /ui2/cl_json=>serialize(
      data        = lt_hit
      pretty_name = /ui2/cl_json=>pretty_mode-none ).
  ENDMETHOD.


  METHOD handle_img_index_read.
    " Read the STREE/SHI IMG search text index (INDX_HSRCH cluster, built by
    " RS_SHI10_TEXTINDEX_UPDATE) for a structure_id, filter node titles by
    " keyword, and reconstruct each hit's IMG breadcrumb from the structure
    " hierarchy - all in one ABAP IMPORT.  One read of the root structure
    " covers the entire SAP Reference IMG.  Area-agnostic: no per-area code.
    TYPES: BEGIN OF ty_hit,
             text         TYPE string,
             node_id      TYPE string,
             extension    TYPE string,
             structure_id TYPE string,
             path         TYPE string,
           END OF ty_hit.
    DATA: lt_txt  TYPE STANDARD TABLE OF hier_srctx,
          lt_chl  TYPE STANDARD TABLE OF hier_ctree,
          lt_gen  TYPE STANDARD TABLE OF ttreesrch,
          lt_hits TYPE STANDARD TABLE OF ty_hit,
          lt_tmap TYPE SORTED TABLE OF hier_srctx WITH NON-UNIQUE KEY id node_id,
          lt_pmap TYPE SORTED TABLE OF hier_ctree WITH NON-UNIQUE KEY child_id,
          lv_sid  TYPE ttree-id,
          lv_lang TYPE sy-langu,
          lv_imp  TYPE sy-langu,
          lv_disp TYPE sy-langu,
          lv_max  TYPE i,
          lv_kw   TYPE string,
          lv_cnt  TYPE i.

    rs_resp-operation = 'img_index_read'.

    lv_sid  = COND #( WHEN is_req-structure_id IS NOT INITIAL
                      THEN is_req-structure_id
                      ELSE '368DDFAB3AB96CCFE10000009B38F976' ).
    lv_lang = COND #( WHEN is_req-language IS NOT INITIAL
                      THEN is_req-language(1) ELSE sy-langu ).
    lv_max  = COND #( WHEN is_req-max_rows > 0 THEN is_req-max_rows ELSE 50 ).
    lv_kw   = to_upper( is_req-keyword ).
    rs_resp-table = lv_sid.

    " Which language generations exist for this tree? (TTREESRCH directory)
    SELECT * FROM ttreesrch INTO TABLE lt_gen WHERE tree_id = lv_sid.
    IF lines( lt_gen ) = 0.
      rs_resp-status = 'no_index'.
      APPEND |No STREE text index for structure { lv_sid } - caller should fall back to raw IMG tables|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    " Pick the generation to IMPORT: requested language if generated, else
    " prefer E, then D, then whatever exists.  The blob holds ALL languages
    " regardless, so the area only has to be a valid existing generation.
    lv_imp = lv_lang.
    READ TABLE lt_gen TRANSPORTING NO FIELDS WITH KEY spras = lv_imp.
    IF sy-subrc <> 0.
      READ TABLE lt_gen INTO DATA(ls_gen) WITH KEY spras = 'E'.
      IF sy-subrc <> 0.
        READ TABLE lt_gen INTO ls_gen WITH KEY spras = 'D'.
      ENDIF.
      IF sy-subrc <> 0.
        READ TABLE lt_gen INTO ls_gen INDEX 1.
      ENDIF.
      lv_imp = ls_gen-spras.
    ENDIF.

    " IMPORT the chosen generation. The cluster area must be a 2-char literal,
    " so branch per language (generated WHEN list, mirroring SAPLSHI10).
    DATA lv_got TYPE abap_bool.
    TRY.
        CASE lv_imp.
{{HSRCH_AREA_CASES}}
          WHEN OTHERS.
        ENDCASE.
      CATCH cx_root INTO DATA(lx).
        rs_resp-status = 'error'.
        APPEND |HSRCH IMPORT failed (lang { lv_imp }): { lx->get_text( ) }|
          TO rs_resp-messages.
        RETURN.
    ENDTRY.
    IF lv_got = abap_false.
      rs_resp-status = 'no_index'.
      APPEND |No HSRCH area mapping for language '{ lv_imp }' - fall back to raw IMG tables|
        TO rs_resp-messages.
      RETURN.
    ENDIF.
    IF lines( lt_txt ) = 0.
      rs_resp-status = 'error'.
      APPEND |HSRCH cluster empty for { lv_sid } lang { lv_imp } (rc={ sy-subrc })|
        TO rs_resp-messages.
      RETURN.
    ENDIF.

    " Display language: requested if present in the blob, else the import lang
    lv_disp = lv_lang.
    READ TABLE lt_txt TRANSPORTING NO FIELDS WITH KEY spras = lv_disp.
    IF sy-subrc <> 0.
      lv_disp = lv_imp.
      APPEND |Requested language '{ lv_lang }' not indexed; showing '{ lv_disp }'|
        TO rs_resp-messages.
    ENDIF.

    " Lookup tables for breadcrumb reconstruction
    LOOP AT lt_txt INTO DATA(ls_m) WHERE spras = lv_disp.
      INSERT ls_m INTO TABLE lt_tmap.
    ENDLOOP.
    lt_pmap = lt_chl.

    " Collect keyword hits + breadcrumb path
    LOOP AT lt_txt INTO DATA(ls_h) WHERE spras = lv_disp.
      DATA(lv_up) = to_upper( ls_h-text ).
      IF lv_kw IS NOT INITIAL AND lv_up NS lv_kw.
        CONTINUE.
      ENDIF.

      " Walk structures upward: hit lives in structure ls_h-id; find the
      " child_structures row whose CHILD_ID = current structure to get the
      " parent structure (ID) + the anchor node (CHILD_NODE) it hangs under.
      DATA: lv_cs   TYPE hier_treeg,
            lv_path TYPE string.
      lv_cs   = ls_h-id.
      lv_path = ls_h-text.
      DO 30 TIMES.
        READ TABLE lt_pmap INTO DATA(ls_p) WITH KEY child_id = lv_cs.
        IF sy-subrc <> 0.
          EXIT.
        ENDIF.
        READ TABLE lt_tmap INTO DATA(ls_pt)
          WITH KEY id = ls_p-id node_id = ls_p-child_node.
        IF sy-subrc = 0 AND ls_pt-text IS NOT INITIAL.
          lv_path = ls_pt-text && | > | && lv_path.
        ENDIF.
        IF ls_p-id = lv_cs.
          EXIT.
        ENDIF.
        lv_cs = ls_p-id.
      ENDDO.

      APPEND VALUE ty_hit( text         = ls_h-text
                           node_id      = ls_h-node_id
                           extension    = ls_h-extension
                           structure_id = ls_h-id
                           path         = lv_path ) TO lt_hits.
      lv_cnt = lv_cnt + 1.
      IF lv_cnt >= lv_max.
        EXIT.
      ENDIF.
    ENDLOOP.

    rs_resp-rows_planned = lv_cnt.
    rs_resp-status       = 'ok'.
    APPEND |source=STREE index gen_date={ lt_gen[ 1 ]-gen_date } gen_lang={ lv_imp } | &&
           |disp_lang={ lv_disp } nodes={ lines( lt_txt ) } hits={ lv_cnt }|
      TO rs_resp-messages.
    rs_resp-data_json = /ui2/cl_json=>serialize(
      data        = lt_hits
      pretty_name = /ui2/cl_json=>pretty_mode-none ).
  ENDMETHOD.


  METHOD submit_batch_write.
    " Runs the write LUW in a background job with maintenance-runtime and
    " headless transport processing. INDX(FP) holds parameters and INDX(FR)
    " holds results, keyed by the 22-character run_id.
    " Polls for eight seconds, then returns pending + run_id if unfinished.
    " MUST match the report's ty_params field-for-field and in the SAME ORDER:
    " EXPORT/IMPORT ... TO/FROM DATABASE assigns the structure POSITIONALLY, not
    " by component name. ZABAPFS_CUST_WRITE shares this layout.
    TYPES: BEGIN OF ty_params,
             table_name       TYPE string,
             view_name        TYPE string,   " maintenance object ('' = direct table write)
             transport_object TYPE string,   " 'VDAT' | 'TABU' | 'CDAT'
             cluster_name     TYPE string,   " view cluster (transport_object='CDAT')
             transport        TYPE string,
             action           TYPE string,   " '' / 'INS' = upsert ; 'DEL' = delete
             plan_json        TYPE string,
             extras_json      TYPE string,   " view fields outside the base table, per plan row (appended: layout is positional)
           END OF ty_params.

    DATA: ls_params   TYPE ty_params,
          ls_jres     TYPE ty_jres,
          lv_run_id   TYPE c LENGTH 22,
          lv_jobname  TYPE btcjob,
          lv_jobcount TYPE btcjobcnt.
    FIELD-SYMBOLS <plan> TYPE STANDARD TABLE.

    " Generate unique run_id
    TRY.
        lv_run_id = cl_system_uuid=>create_uuid_c22_static( ).
      CATCH cx_uuid_error.
        CONCATENATE sy-mandt sy-datum sy-uzeit INTO lv_run_id.
    ENDTRY.

    " Serialize the plan for the batch report, which derives transport keys.
    ASSIGN ir_plan->* TO <plan>.
    /ui2/cl_json=>serialize(
      EXPORTING data        = <plan>
                pretty_name = /ui2/cl_json=>pretty_mode-none
      RECEIVING r_json      = ls_params-plan_json ).
    ls_params-extras_json = is_req-extras_json.
    ls_params-table_name       = is_req-table.
    ls_params-view_name        = is_req-view_name.
    ls_params-transport_object = is_req-transport_object.
    ls_params-cluster_name     = is_req-cluster_name.
    ls_params-transport        = is_req-transport.
    ls_params-action           = is_req-action.

    " Write params to INDX before the job starts
    EXPORT data = ls_params TO DATABASE indx(FP) ID lv_run_id.

    " Open job, register step, close (start immediately)
    lv_jobname = 'ZABAPFS_CUST_WRITE'.
    CALL FUNCTION 'JOB_OPEN'
      EXPORTING  jobname         = lv_jobname
      IMPORTING  jobcount        = lv_jobcount
      EXCEPTIONS cant_create_job = 1
                 OTHERS          = 2.
    IF sy-subrc <> 0.
      APPEND |JOB_OPEN failed (subrc { sy-subrc }) - cannot schedule batch writer|
        TO ct_messages.
      DELETE FROM DATABASE indx(FP) ID lv_run_id.
      RETURN.
    ENDIF.

    SUBMIT zabapfs_cust_write WITH p_runid = lv_run_id
      VIA JOB lv_jobname NUMBER lv_jobcount AND RETURN.

    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname               = lv_jobname
                jobcount              = lv_jobcount
                strtimmed             = 'X'
      EXCEPTIONS cant_start_immediate = 1
                 invalid_starttime    = 2
                 OTHERS               = 3.
    IF sy-subrc <> 0.
      APPEND |JOB_CLOSE failed (subrc { sy-subrc }) - job may not start|
        TO ct_messages.
      DELETE FROM DATABASE indx(FP) ID lv_run_id.
      RETURN.
    ENDIF.

    " Record the job handle so handle_status can cross-check TBTCO (running /
    " queued / aborted) rather than reporting a blanket 'pending'.
    write_job_handle( iv_run_id    = lv_run_id
                      iv_jobname   = lv_jobname
                      iv_jobcount  = lv_jobcount
                      iv_kind      = 'WRITE'
                      iv_table     = is_req-table
                      iv_transport = is_req-transport ).

    " Short initial poll (catches the common fast-job case without a second
    " round-trip).  If the job isn't done in time, return pending + run_id and
    " let the caller poll via operation 'status' - this keeps the write call
    " bounded rather than waiting synchronously for the entire job.
    DATA lv_done TYPE abap_bool VALUE abap_false.
    DO 8 TIMES.
      WAIT UP TO 1 SECONDS.
      IMPORT data = ls_jres FROM DATABASE indx(FR) ID lv_run_id.
      IF sy-subrc = 0.
        lv_done = abap_true.
        EXIT.
      ENDIF.
    ENDDO.

    IF lv_done = abap_false.
      rs_res-pending = abap_true.
      rs_res-run_id  = lv_run_id.
      APPEND |Batch job still running after 8 s - run_id { lv_run_id }|
        TO ct_messages.
      RETURN.
    ENDIF.

    DELETE FROM DATABASE indx(FR) ID lv_run_id.

    LOOP AT ls_jres-messages INTO DATA(lv_m).
      APPEND lv_m TO ct_messages.
    ENDLOOP.

    IF ls_jres-status = 'ok'.
      rs_res-ok           = abap_true.
      rs_res-rows_written = ls_jres-rows_written.
      rs_res-e071k_count  = ls_jres-e071k_count.
    ENDIF.
  ENDMETHOD.






  METHOD create_cust_transport.
    DATA: ls_hdr   TYPE trwbo_request_header,
          lt_tasks TYPE trwbo_request_headers,
          lt_users TYPE scts_users,
          ls_user  TYPE scts_user.
    " A task is only created for users passed in it_users; without it the
    " request has no task and objects can't be recorded the SM30 way.
    ls_user-user = sy-uname.
    APPEND ls_user TO lt_users.
    CALL FUNCTION 'TR_INSERT_REQUEST_WITH_TASKS'
      EXPORTING
        iv_type           = 'W'           " W = customizing request
        iv_text           = iv_text
        iv_owner          = sy-uname
        it_users          = lt_users
      IMPORTING
        es_request_header = ls_hdr
        et_task_headers   = lt_tasks
      EXCEPTIONS
        insert_failed     = 1
        enqueue_failed    = 2
        OTHERS            = 3.
    IF sy-subrc <> 0.
      RETURN.   " ev_request/ev_task stay empty -> caller errors out
    ENDIF.
    ev_request = ls_hdr-trkorr.
    " Objects are recorded on the user's customizing task, not the request head
    READ TABLE lt_tasks INTO DATA(ls_task) INDEX 1.
    ev_task = COND #( WHEN sy-subrc = 0 THEN ls_task-trkorr ELSE ls_hdr-trkorr ).
  ENDMETHOD.


  METHOD ensure_user_task.
    CLEAR: ev_task, ev_request, ev_created, ev_msg.

    SELECT SINGLE strkorr, trfunction, trstatus FROM e070
      INTO @DATA(ls_hdr)
      WHERE trkorr = @iv_transport.
    IF sy-subrc <> 0.
      ev_msg = |Transport { iv_transport } does not exist|.
      RETURN.
    ENDIF.

    DATA(request_type) = ls_hdr-trfunction.
    DATA(request_status) = ls_hdr-trstatus.
    IF ls_hdr-strkorr IS NOT INITIAL.
      SELECT SINGLE trfunction, trstatus FROM e070
        INTO (@request_type, @request_status)
        WHERE trkorr = @ls_hdr-strkorr.
      IF sy-subrc <> 0.
        ev_msg = |Parent Customizing request for { iv_transport } does not exist|.
        RETURN.
      ENDIF.
    ENDIF.
    IF request_type <> 'W' OR ( request_status <> 'D' AND request_status <> 'L' ).
      ev_msg = |{ iv_transport } must belong to an open Customizing request|.
      RETURN.
    ENDIF.
    IF ls_hdr-strkorr IS NOT INITIAL AND
       ( ls_hdr-trfunction <> 'Q' OR ( ls_hdr-trstatus <> 'D' AND ls_hdr-trstatus <> 'L' ) ).
      ev_msg = |{ iv_transport } is not an open Customizing task|.
      RETURN.
    ENDIF.

    " Already a task -> record onto it; report its parent request.
    IF ls_hdr-strkorr IS NOT INITIAL.
      ev_task    = iv_transport.
      ev_request = ls_hdr-strkorr.
      RETURN.
    ENDIF.

    " A request -> find the current user's modifiable task under it.
    ev_request = iv_transport.
    SELECT trkorr FROM e070
      INTO TABLE @DATA(lt_tasks)
      UP TO 1 ROWS
      WHERE strkorr  = @iv_transport
        AND as4user  = @sy-uname
        AND trstatus = 'D'.
    IF lt_tasks IS NOT INITIAL.
      ev_task = lt_tasks[ 1 ].
      RETURN.   " user already owns a task here
    ENDIF.

    " No task for this user -> create one (customizing task 'Q' under a 'W'
    " request, dev/correction 'S' under a workbench request).
    IF fm_exists( 'TRINT_INSERT_NEW_COMM' ) = abap_false.
      ev_msg = |Cannot create a task under { iv_transport }: TRINT_INSERT_NEW_COMM | &&
               |is not available on this release - supply a transport you already own a task in|.
      RETURN.
    ENDIF.
    DATA(lv_tf) = COND e070-trfunction( WHEN ls_hdr-trfunction = 'W' THEN 'Q' ELSE 'S' ).
    DATA lv_text TYPE e07t-as4text.
    lv_text = |ABAP FS task ({ sy-uname })|.
    CALL FUNCTION 'TRINT_INSERT_NEW_COMM'
      EXPORTING
        wi_strkorr    = iv_transport
        wi_trfunction = lv_tf
        wi_kurztext   = lv_text
        iv_username   = sy-uname
      IMPORTING
        we_trkorr     = ev_task
      EXCEPTIONS
        OTHERS        = 1.
    IF sy-subrc <> 0 OR ev_task IS INITIAL.
      CLEAR ev_task.
      ev_msg = |Could not create a task under { iv_transport } (subrc { sy-subrc })|.
      RETURN.
    ENDIF.
    COMMIT WORK AND WAIT.
    ev_created = abap_true.
  ENDMETHOD.




ENDCLASS.