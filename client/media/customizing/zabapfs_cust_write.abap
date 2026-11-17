REPORT zabapfs_cust_write NO STANDARD PAGE HEADING.

" LOWER CASE is essential: the run_id is a mixed-case UUID (cl_system_uuid
" create_uuid_c22).  Without it the selection-screen parameter upper-cases the
" value, so this report can't find its own INDX(FP) params (engine wrote them in
" mixed case) and the engine can't find this report's INDX(FR) result.
PARAMETERS: p_runid TYPE c LENGTH 22 LOWER CASE.

TYPES: BEGIN OF ty_params,
         table_name       TYPE string,
         view_name        TYPE string,   " maintenance object ('' = direct table write)
         transport_object TYPE string,   " 'VDAT' (view) | 'TABU' (single table) | 'CDAT' (view cluster)
         cluster_name     TYPE string,   " view cluster name (transport_object='CDAT')
         transport        TYPE string,
         action           TYPE string,   " '' / 'INS' / 'DEL'
         plan_json        TYPE string,
         extras_json      TYPE string,   " view fields outside the base table: [{ROW,FIELD,VALUE}] (appended: layout is positional)
       END OF ty_params.

TYPES ty_refs TYPE STANDARD TABLE OF REF TO data WITH DEFAULT KEY.
TYPES: BEGIN OF ty_extra,
         row   TYPE i,
         field TYPE string,
         value TYPE string,
       END OF ty_extra,
       ty_extras TYPE STANDARD TABLE OF ty_extra WITH DEFAULT KEY.

TYPES: BEGIN OF ty_result,
         status       TYPE string,
         rows_written TYPE i,
         e071k_count  TYPE i,
         transport    TYPE string,
         messages     TYPE stringtab,
       END OF ty_result.

START-OF-SELECTION.
  DATA: ls_params TYPE ty_params,
        ls_result TYPE ty_result,
        lv_runid  TYPE c LENGTH 22.

  lv_runid = p_runid.

  IMPORT data = ls_params FROM DATABASE indx(FP) ID lv_runid.
  IF sy-subrc <> 0.
    ls_result-status = 'error'.
    APPEND 'Params not found in INDX - run_id may be stale or job started too early'
      TO ls_result-messages.
    EXPORT data = ls_result TO DATABASE indx(FR) ID lv_runid.
    RETURN.
  ENDIF.

  IF ls_params-transport IS NOT INITIAL.
    ls_result-transport = ls_params-transport.
    SELECT SINGLE strkorr FROM e070 INTO @DATA(parent_request)
      WHERE trkorr = @ls_params-transport.
    IF sy-subrc = 0 AND parent_request IS NOT INITIAL.
      ls_result-transport = parent_request.
    ENDIF.
  ENDIF.

  IF ls_params-view_name IS NOT INITIAL.
    PERFORM write_via_view USING ls_params CHANGING ls_result.
  ELSE.
    PERFORM write_direct   USING ls_params CHANGING ls_result.
  ENDIF.

  EXPORT data = ls_result TO DATABASE indx(FR) ID lv_runid.
  " Clean up params now that the job is done
  DELETE FROM DATABASE indx(FP) ID lv_runid.

*&---------------------------------------------------------------------*
*&  Proper customizing write through the maintenance view runtime.
*&  Records R3TR VDAT <view> (base + text table) on the transport.
*&
*&  The view runtime writes WITHOUT transport (no_transport='X'); the keys
*&  are then recorded by record_headless. Never hand corr_number to the view
*&  runtime: it records through TR_OBJECTS_INSERT, which hardcodes
*&  iv_with_dialog='X', and in dialog mode CTS also runs switch-BC-set
*&  recording (TRINT_OBJECTS_CHECK_AND_INSERT, "call_scpr_transport") on any
*&  client with an active switch. That path can perform expensive BC-set
*&  processing. Mode 'D' (insert, no dialog) avoids the dialog recording path.
*&---------------------------------------------------------------------*
FORM write_via_view
  USING    is_params TYPE ty_params
  CHANGING cs_result TYPE ty_result.

  DATA: lr_plan   TYPE REF TO data,
        lr_entry  TYPE REF TO data,
        lv_view   TYPE dd02v-tabname,
        lv_trkorr TYPE trkorr,
        lv_corr   TYPE trkorr,
        lv_action TYPE c LENGTH 4,
        lv_trobj  TYPE e071-object,
        lv_count  TYPE i,
        lv_msg    TYPE string.
  FIELD-SYMBOLS: <plan>  TYPE STANDARD TABLE,
                 <row>   TYPE any,
                 <entry> TYPE any.

  lv_view   = to_upper( is_params-view_name ).
  lv_trkorr = is_params-transport.
  " Transport object the SM30 runtime records: VDAT (view) or TABU (single table)
  lv_trobj  = to_upper( is_params-transport_object ).
  IF lv_trobj IS INITIAL.
    lv_trobj = 'VDAT'.
  ENDIF.
  " 'DEL' = delete existing entries (mimics the SM30 'delete row' path); anything
  " else = insert-or-update. Both go through VIEW_MAINTENANCE_SINGLE_ENTRY;
  " transport keys are recorded separately after the runtime calls.
  DATA(lv_is_del) = COND abap_bool(
    WHEN to_upper( is_params-action ) = 'DEL' THEN abap_true ELSE abap_false ).

  " Every write goes through the view runtime without transport; the keys of
  " what was written are recorded afterwards, headlessly, as the SM30/SM34
  " save would record them (VDAT/TABU header + TABU keys, or CDAT header +
  " member TABU keys). See the FORM header.
  DATA(lv_is_cdat) = COND abap_bool( WHEN lv_trobj = 'CDAT' THEN abap_true ELSE abap_false ).
  DATA: lv_no_transp TYPE tvdir-flag VALUE 'X',
        lv_corr_in   TYPE trkorr,
        lt_written   TYPE ty_refs,
        lt_extras    TYPE ty_extras,
        lv_row       TYPE i.
  FIELD-SYMBOLS <xfld> TYPE any.

  IF is_params-extras_json IS NOT INITIAL.
    TRY.
        /ui2/cl_json=>deserialize(
          EXPORTING json        = is_params-extras_json
                    pretty_name = /ui2/cl_json=>pretty_mode-none
          CHANGING  data        = lt_extras ).
      CATCH cx_root INTO DATA(lx_xj).
        cs_result-status = 'error'.
        APPEND |View-field deserialization failed: { lx_xj->get_text( ) }| TO cs_result-messages.
        RETURN.
    ENDTRY.
  ENDIF.

  " Deserialize the plan (rows typed as the BASE table)
  TRY.
      CREATE DATA lr_plan TYPE STANDARD TABLE OF (is_params-table_name).
      ASSIGN lr_plan->* TO <plan>.
      /ui2/cl_json=>deserialize(
        EXPORTING json        = is_params-plan_json
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        CHANGING  data        = <plan> ).
    CATCH cx_root INTO DATA(lx_de).
      cs_result-status = 'error'.
      APPEND |Plan deserialization failed: { lx_de->get_text( ) }| TO cs_result-messages.
      RETURN.
  ENDTRY.

  " One view-structured work area to feed VIEW_MAINTENANCE_SINGLE_ENTRY
  TRY.
      CREATE DATA lr_entry TYPE (lv_view).
      ASSIGN lr_entry->* TO <entry>.
    CATCH cx_root INTO DATA(lx_ce).
      cs_result-status = 'error'.
      APPEND |Cannot type view { lv_view }: { lx_ce->get_text( ) }| TO cs_result-messages.
      RETURN.
  ENDTRY.

  LOOP AT <plan> ASSIGNING <row>.
    lv_row = lv_row + 1.
    CLEAR <entry>.
    " Base-table fields (incl. the remapped key) carry over by name; view fields
    " outside the base table (a text table's description) come from the extras,
    " and the view runtime writes them for sy-langu.
    MOVE-CORRESPONDING <row> TO <entry>.
    LOOP AT lt_extras INTO DATA(ls_x) WHERE row = lv_row.
      ASSIGN COMPONENT ls_x-field OF STRUCTURE <entry> TO <xfld>.
      IF sy-subrc <> 0.
        cs_result-status = 'error'.
        APPEND |Field { ls_x-field } is not in view { lv_view }| TO cs_result-messages.
        RETURN.
      ENDIF.
      <xfld> = ls_x-value.
    ENDLOOP.

    " -- Delete path ---------------------------------------------------------
    " The work area's key identifies the entry; action 'DEL' removes it across the
    " whole view (base + text) and records the deletion onto the transport, exactly
    " as deleting the row in SM30 does.  entry_not_found -> already gone (idempotent).
    IF lv_is_del = abap_true.
      lv_action = 'DEL'.
      CLEAR lv_corr.
      " Preserve the key before DEL: the runtime can clear the entry it receives.
      DATA(lv_kept) = lines( lt_written ).
      PERFORM keep_entry USING <entry> CHANGING lt_written.
      CALL FUNCTION 'VIEW_MAINTENANCE_SINGLE_ENTRY'
        EXPORTING
          action                     = lv_action
          corr_number                = lv_corr_in
          view_name                  = lv_view
          no_warning_for_clientindep = 'X'
          no_transport               = lv_no_transp
          suppressdialog             = 'X'
        IMPORTING
          corr_number                = lv_corr
        CHANGING
          entry                      = <entry>
        EXCEPTIONS
          entry_already_exists       = 1
          entry_not_found            = 2
          foreign_lock               = 3
          invalid_action             = 4
          no_clientindependent_auth  = 5
          no_upd_auth                = 6
          no_show_auth               = 7
          error_message              = 8
          OTHERS                     = 9.
      IF sy-subrc = 2.
        lv_kept = lv_kept + 1.
        DELETE lt_written FROM lv_kept.   " nothing deleted, nothing to record
        APPEND |Entry already absent - skipped| TO cs_result-messages.
        CONTINUE.
      ENDIF.
      IF sy-subrc <> 0.
        " The message first: ROLLBACK WORK resets sy-subrc.
        PERFORM runtime_failure USING 'DEL' CHANGING cs_result.
        ROLLBACK WORK.
        cs_result-status = 'error'.
        RETURN.
      ENDIF.
      cs_result-rows_written = cs_result-rows_written + 1.
      CONTINUE.
    ENDIF.

    " New target keys -> INSERT; if the row already exists, fall back to UPDATE.
    lv_action = 'INS'.
    CLEAR lv_corr.
    CALL FUNCTION 'VIEW_MAINTENANCE_SINGLE_ENTRY'
      EXPORTING
        action                     = lv_action
        corr_number                = lv_corr_in
        view_name                  = lv_view
        no_warning_for_clientindep = 'X'
        no_transport               = lv_no_transp
        suppressdialog             = 'X'
      IMPORTING
        corr_number                = lv_corr
      CHANGING
        entry                      = <entry>
      EXCEPTIONS
        entry_already_exists       = 1
        entry_not_found            = 2
        foreign_lock               = 3
        invalid_action             = 4
        no_clientindependent_auth  = 5
        no_upd_auth                = 6
        no_show_auth               = 7
        error_message              = 8
        OTHERS                     = 9.

    IF sy-subrc = 1.
      " Already there -> update it instead
      lv_action = 'UPD'.
      CALL FUNCTION 'VIEW_MAINTENANCE_SINGLE_ENTRY'
        EXPORTING
          action                     = lv_action
          corr_number                = lv_corr_in
          view_name                  = lv_view
          no_warning_for_clientindep = 'X'
          no_transport               = lv_no_transp
          suppressdialog             = 'X'
        IMPORTING
          corr_number                = lv_corr
        CHANGING
          entry                      = <entry>
        EXCEPTIONS
          error_message              = 8
          OTHERS                     = 9.
    ENDIF.

    IF sy-subrc <> 0.
      " The message first: ROLLBACK WORK resets sy-subrc.
      PERFORM runtime_failure USING lv_action CHANGING cs_result.
      ROLLBACK WORK.
      cs_result-status = 'error'.
      RETURN.
    ENDIF.

    cs_result-rows_written = cs_result-rows_written + 1.
    PERFORM keep_entry USING <entry> CHANGING lt_written.
  ENDLOOP.

  " Record what was written onto the request BEFORE the commit, so the keys are
  " persisted together with the data (CTS records through its update task).
  IF lv_trkorr IS NOT INITIAL AND cs_result-rows_written > 0.
    PERFORM record_headless USING is_params lv_trkorr lv_view lt_written CHANGING cs_result.
    IF cs_result-status = 'error'.
      ROLLBACK WORK.
      RETURN.
    ENDIF.
  ENDIF.

  COMMIT WORK AND WAIT.

  " A successful DEL return does not prove that the base row was removed.
  " Remove any surviving base rows after the runtime commit; their transport
  " keys were recorded above. Dependent text rows are not deleted by this
  " fallback, so report when manual verification is required.
  IF lv_is_del = abap_true.
    DATA lv_survived TYPE i.
    LOOP AT <plan> ASSIGNING <row>.
      DELETE (is_params-table_name) FROM <row>.
      IF sy-subrc = 0.
        lv_survived = lv_survived + sy-dbcnt.
      ENDIF.
    ENDLOOP.
    IF lv_survived > 0.
      COMMIT WORK AND WAIT.
      APPEND |The view runtime accepted the delete but { lv_survived } row(s) were still in { to_upper( is_params-table_name ) } after its commit; they were deleted from the base table directly. Check any text table of { lv_view } for rows left behind.|
        TO cs_result-messages.
    ENDIF.
  ENDIF.

  cs_result-status = 'ok'.
  DATA(lv_verb) = COND string( WHEN lv_is_del = abap_true THEN 'Deleted' ELSE 'Wrote' ).

  " Without a transport, report the unrecorded runtime write without checking E071K.
  IF lv_trkorr IS INITIAL.
    lv_msg = |{ lv_verb } { cs_result-rows_written } row(s) via { lv_view } (client { sy-mandt } records no transport)|.
    APPEND lv_msg TO cs_result-messages.
    RETURN.
  ENDIF.

  " Post-commit sanity check: count base-table keys after headless recording.
  " A VDAT/view write lands as: E071 header R3TR VDAT <view> + E071K key rows
  " R3TR TABU <member table> <tabkey> (one per touched table+language). We count
  " the E071K TABU keys for the BASE table - the substantive "row recorded"
  " evidence. CTS records onto the user's TASK under the request, not the request
  " header, so we look across the request AND all its tasks (E070-STRKORR).
  DATA: lt_korr TYPE RANGE OF trkorr,
        lv_btab TYPE e071k-objname.
  lv_btab = to_upper( is_params-table_name ).
  APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_trkorr ) TO lt_korr.
  SELECT trkorr FROM e070 WHERE strkorr = @lv_trkorr INTO TABLE @DATA(lt_tasks).
  LOOP AT lt_tasks INTO DATA(ls_task).
    APPEND VALUE #( sign = 'I' option = 'EQ' low = ls_task-trkorr ) TO lt_korr.
  ENDLOOP.
  SELECT COUNT(*) INTO @lv_count FROM e071k
    WHERE trkorr IN @lt_korr
      AND pgmid   = 'R3TR'
      AND object  = 'TABU'
      AND objname = @lv_btab.
  cs_result-e071k_count = lv_count.

  DATA(lv_hdr) = COND string( WHEN lv_is_cdat = abap_true
                              THEN |R3TR CDAT { to_upper( is_params-cluster_name ) }|
                              ELSE |R3TR { lv_trobj } { lv_view }| ).
  IF lv_count > 0.
    lv_msg = |{ lv_verb } { cs_result-rows_written } row(s) via { lv_view } -> { lv_trkorr } ({ lv_hdr }; { lv_count } R3TR TABU { lv_btab } key(s) recorded)|.
  ELSE.
    lv_msg = |{ lv_verb } { cs_result-rows_written } row(s) via { lv_view }, but no R3TR TABU { lv_btab } keys were recorded on { lv_trkorr } or its tasks - check the request is a modifiable Customizing request|.
  ENDIF.
  APPEND lv_msg TO cs_result-messages.
ENDFORM.

*&---------------------------------------------------------------------*
*&  Report why the view runtime refused a row, with the message text.
*&  Catch runtime MESSAGE E as error_message so validation failures reach
*&  the caller instead of cancelling the job without a structured result.
*&---------------------------------------------------------------------*
FORM runtime_failure
  USING    iv_action TYPE any
  CHANGING cs_result TYPE ty_result.
  DATA lv_txt TYPE string.
  DATA(lv_rc) = sy-subrc.
  IF sy-msgid IS NOT INITIAL.
    MESSAGE ID sy-msgid TYPE 'I' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_txt.
  ENDIF.
  APPEND |VIEW_MAINTENANCE_SINGLE_ENTRY { iv_action } failed (subrc { lv_rc }{ COND string( WHEN sy-msgid IS NOT INITIAL THEN | { sy-msgid }{ sy-msgno }| ) }): { lv_txt }|
    TO cs_result-messages.
ENDFORM.

*&---------------------------------------------------------------------*
*&  Keep a copy of a written view entry for key recording after the loop.
*&---------------------------------------------------------------------*
FORM keep_entry
  USING    is_entry   TYPE any
  CHANGING ct_written TYPE ty_refs.
  DATA lr_copy TYPE REF TO data.
  FIELD-SYMBOLS <copy> TYPE any.
  CREATE DATA lr_copy LIKE is_entry.
  ASSIGN lr_copy->* TO <copy>.
  <copy> = is_entry.
  APPEND lr_copy TO ct_written.
ENDFORM.

*&---------------------------------------------------------------------*
*&  Record written entries onto the request, headlessly, the way the
*&  SM30/SM34 save records them:
*&    VDAT  -> R3TR VDAT <view>    + R3TR TABU <table> <key> per view table
*&    TABU  -> R3TR TABU <table>   + the same keys
*&    CDAT  -> R3TR CDAT <cluster> + R3TR TABU <member table> <key>
*&  Keys are built from the DDIC key fields of each table in the view
*&  (DD26S/DD03L): client from sy-mandt, a language key from the entry or
*&  sy-langu, everything else from the entry (blank is a valid key value).
*&  A table whose key fields are not all in the entry (a lookup table joined
*&  for a text) is not a maintained table and is skipped, as SM30 does.
*&
*&  TRINT_OBJECTS_CHECK_AND_INSERT with iv_with_dialog='D' - insert into
*&  the given request, no dialog. ' ' and 'R' only check and insert nothing;
*&  'X' (what TR_OBJECTS_INSERT forces) inserts through the dialog and is the
*&  only mode that runs the switch-BC-set recording that ran for hours on
*&  switched-package views (see write_via_view).
*&---------------------------------------------------------------------*
FORM record_headless
  USING    is_params  TYPE ty_params
           iv_trkorr  TYPE trkorr
           iv_view    TYPE dd02v-tabname
           it_written TYPE ty_refs
  CHANGING cs_result  TYPE ty_result.

  TYPES: BEGIN OF ty_keyfield,
           tabname   TYPE dd03l-tabname,
           fieldname TYPE dd03l-fieldname,
           position  TYPE dd03l-position,
           datatype  TYPE dd03l-datatype,
           leng      TYPE dd03l-leng,
         END OF ty_keyfield.

  DATA: lt_ko200    TYPE tredt_objects,
        lt_e071k    TYPE tredt_keys,
        lt_tables   TYPE STANDARD TABLE OF dd26s-tabname,
        lt_keyf     TYPE STANDARD TABLE OF ty_keyfield,
        lv_trobj    TYPE e071-object,
        lv_master   TYPE e071k-mastername,
        lv_mtype    TYPE e071k-mastertype,
        lv_order    TYPE trkorr,
        lv_task     TYPE trkorr,
        lv_tabkey   TYPE e071k-tabkey,
        lv_off      TYPE i,
        lv_complete TYPE abap_bool,
        lv_val      TYPE c LENGTH 255,
        lr_entry    TYPE REF TO data.
  FIELD-SYMBOLS: <entry> TYPE any,
                 <field> TYPE any.

  lv_trobj = to_upper( is_params-transport_object ).
  IF lv_trobj IS INITIAL.
    lv_trobj = 'VDAT'.
  ENDIF.

  CASE lv_trobj.
    WHEN 'CDAT'.
      lv_master = to_upper( is_params-cluster_name ).
      lv_mtype  = 'CDAT'.
    WHEN 'TABU'.
      lv_master = to_upper( is_params-table_name ).
      lv_mtype  = 'TABU'.
    WHEN OTHERS.
      lv_master = iv_view.
      lv_mtype  = 'VDAT'.
  ENDCASE.

  APPEND VALUE #( pgmid = 'R3TR' object = lv_trobj obj_name = lv_master objfunc = 'K' ) TO lt_ko200.

  " The tables whose keys are recorded: the view's tables, or the one table.
  IF lv_trobj = 'TABU'.
    APPEND lv_master TO lt_tables.
  ELSE.
    SELECT tabname FROM dd26s WHERE viewname = @iv_view ORDER BY tabpos INTO TABLE @lt_tables.
    IF lt_tables IS INITIAL.
      APPEND to_upper( is_params-table_name ) TO lt_tables.
    ENDIF.
  ENDIF.

  SELECT tabname, fieldname, position, datatype, leng FROM dd03l
    FOR ALL ENTRIES IN @lt_tables
    WHERE tabname = @lt_tables-table_line AND keyflag = 'X' AND as4local = 'A'
    INTO TABLE @lt_keyf.
  SORT lt_keyf BY tabname position.

  LOOP AT lt_tables INTO DATA(lv_tab).
    LOOP AT it_written INTO lr_entry.
      ASSIGN lr_entry->* TO <entry>.
      CLEAR lv_tabkey.
      lv_off = 0.
      lv_complete = abap_true.
      LOOP AT lt_keyf INTO DATA(ls_kf) WHERE tabname = lv_tab.
        CLEAR lv_val.
        IF ls_kf-datatype = 'CLNT'.
          lv_val = sy-mandt.
        ELSE.
          " A key field the entry does not have means a table this view only
          " reads (a lookup joined for its text): not maintained, skipped. A
          " key field that is there but blank is a real key value (a blank
          " storage location), except a language, which the runtime fills.
          ASSIGN COMPONENT ls_kf-fieldname OF STRUCTURE <entry> TO <field>.
          IF sy-subrc = 0 AND ( <field> IS NOT INITIAL OR ls_kf-datatype <> 'LANG' ).
            lv_val = <field>.
          ELSEIF ls_kf-datatype = 'LANG'.
            lv_val = sy-langu.
          ELSE.
            lv_complete = abap_false.
            EXIT.
          ENDIF.
        ENDIF.
        IF lv_off + ls_kf-leng > 120.
          lv_complete = abap_false.
          EXIT.
        ENDIF.
        lv_tabkey+lv_off(ls_kf-leng) = lv_val.
        lv_off = lv_off + ls_kf-leng.
      ENDLOOP.
      IF lv_complete = abap_false.
        EXIT.   " not a maintained table of this view: next table
      ENDIF.
      APPEND VALUE #( pgmid = 'R3TR' object = 'TABU' objname = lv_tab tabkey = lv_tabkey
                      mastertype = lv_mtype mastername = lv_master ) TO lt_e071k.
    ENDLOOP.
  ENDLOOP.

  IF lt_e071k IS INITIAL.
    cs_result-status = 'error'.
    APPEND |No table key of { iv_view } could be built from the written entries; nothing recorded on { iv_trkorr }|
      TO cs_result-messages.
    RETURN.
  ENDIF.

  " A joined lookup table may not belong to the transport object. If CTS names
  " it in TK428, remove that table's keys and retry; report every exclusion.
  DATA: lv_ok   TYPE abap_bool,
        lv_drop TYPE tabname.
  DO 5 TIMES.
    CLEAR lt_ko200.
    APPEND VALUE #( pgmid = 'R3TR' object = lv_trobj obj_name = lv_master objfunc = 'K' ) TO lt_ko200.

    CALL FUNCTION 'TRINT_OBJECTS_CHECK_AND_INSERT'
      EXPORTING
        iv_order              = iv_trkorr
        iv_with_dialog        = 'D'
        iv_no_show_option     = 'X'
        iv_no_standard_editor = 'X'
        iv_no_ps              = 'X'
      IMPORTING
        ev_order              = lv_order
        ev_task               = lv_task
      CHANGING
        ct_ko200              = lt_ko200
        ct_e071k              = lt_e071k
      EXCEPTIONS
        OTHERS                = 1.
    IF sy-subrc = 0.
      lv_ok = abap_true.
      EXIT.
    ENDIF.

    IF sy-msgid = 'TK' AND sy-msgno = '428' AND sy-msgv1 IS NOT INITIAL.
      lv_drop = to_upper( sy-msgv1 ).
      DELETE lt_e071k WHERE objname = lv_drop.
      APPEND |{ lv_drop } is joined into { iv_view } but is not part of customizing object { lv_master } - its keys were left out|
        TO cs_result-messages.
      IF lt_e071k IS INITIAL.
        cs_result-status = 'error'.
        APPEND |Nothing left to record on { iv_trkorr } after dropping { lv_drop }| TO cs_result-messages.
        RETURN.
      ENDIF.
      CONTINUE.
    ENDIF.

    cs_result-status = 'error'.
    APPEND |Recording { lv_trobj } { lv_master } onto { iv_trkorr } refused: { sy-msgid }{ sy-msgno } { sy-msgv1 } { sy-msgv2 } { sy-msgv3 } { sy-msgv4 }|
      TO cs_result-messages.
    RETURN.
  ENDDO.

  IF lv_ok = abap_false.
    cs_result-status = 'error'.
    APPEND |Recording { lv_trobj } { lv_master } onto { iv_trkorr } still refused after dropping the tables CTS named| TO cs_result-messages.
    RETURN.
  ENDIF.
  APPEND |Recorded R3TR { lv_trobj } { lv_master } + { lines( lt_e071k ) } R3TR TABU key(s) onto { lv_order } (task { lv_task })|
    TO cs_result-messages.
ENDFORM.

*&---------------------------------------------------------------------*
*&  Direct table write (class A application data / no maintenance view).
*&  No transport recording.
*&---------------------------------------------------------------------*
FORM write_direct
  USING    is_params TYPE ty_params
  CHANGING cs_result TYPE ty_result.

  DATA: lr_plan    TYPE REF TO data,
        lv_tabname TYPE e071-obj_name,
        lv_enq     TYPE rstable-tabname,
        lv_msg     TYPE string,
        lt_written TYPE ty_refs,
        lv_trkorr  TYPE trkorr,
        lv_noview  TYPE dd02v-tabname.
  FIELD-SYMBOLS: <plan> TYPE STANDARD TABLE,
                 <prow> TYPE any.

  lv_tabname = to_upper( is_params-table_name ).
  lv_enq     = lv_tabname.

  TRY.
      CREATE DATA lr_plan TYPE STANDARD TABLE OF (is_params-table_name).
      ASSIGN lr_plan->* TO <plan>.
      /ui2/cl_json=>deserialize(
        EXPORTING json        = is_params-plan_json
                  pretty_name = /ui2/cl_json=>pretty_mode-none
        CHANGING  data        = <plan> ).
    CATCH cx_root INTO DATA(lx_de).
      cs_result-status = 'error'.
      APPEND |Plan deserialization failed: { lx_de->get_text( ) }| TO cs_result-messages.
      RETURN.
  ENDTRY.

  CALL FUNCTION 'ENQUEUE_E_TABLE'
    EXPORTING
      mode_rstable = 'E'
      tabname      = lv_enq
    EXCEPTIONS
      foreign_lock   = 1
      system_failure = 2
      OTHERS         = 3.
  IF sy-subrc <> 0.
    cs_result-status = 'error'.
    APPEND |ENQUEUE failed (subrc { sy-subrc })| TO cs_result-messages.
    RETURN.
  ENDIF.

  TRY.
      MODIFY (is_params-table_name) FROM TABLE <plan>.
      cs_result-rows_written = sy-dbcnt.
      " A table with no maintenance view, written with a transport: record its
      " row keys as R3TR TABU, as the dedicated transaction would (CUNI: T006*).
      IF is_params-transport IS NOT INITIAL.
        LOOP AT <plan> ASSIGNING <prow>.
          PERFORM keep_entry USING <prow> CHANGING lt_written.
        ENDLOOP.
        lv_trkorr = is_params-transport.
        PERFORM record_headless USING is_params lv_trkorr lv_noview lt_written CHANGING cs_result.
        IF cs_result-status = 'error'.
          ROLLBACK WORK.
          cs_result-rows_written = 0.
          CALL FUNCTION 'DEQUEUE_E_TABLE'
            EXPORTING mode_rstable = 'E' tabname = lv_enq.
          RETURN.
        ENDIF.
      ENDIF.
      COMMIT WORK AND WAIT.
      cs_result-status = 'ok'.
      " Count the keys now on the request and its tasks, as the view path does.
      IF is_params-transport IS NOT INITIAL.
        DATA: lt_dkorr TYPE RANGE OF trkorr,
              lv_dkeys TYPE i.
        APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_trkorr ) TO lt_dkorr.
        SELECT trkorr FROM e070 WHERE strkorr = @lv_trkorr INTO TABLE @DATA(lt_dtasks).
        LOOP AT lt_dtasks INTO DATA(ls_dtask).
          APPEND VALUE #( sign = 'I' option = 'EQ' low = ls_dtask-trkorr ) TO lt_dkorr.
        ENDLOOP.
        SELECT COUNT(*) INTO @lv_dkeys FROM e071k
          WHERE trkorr IN @lt_dkorr AND pgmid = 'R3TR' AND object = 'TABU' AND objname = @lv_tabname.
        cs_result-e071k_count = lv_dkeys.
      ENDIF.
      lv_msg = COND #( WHEN is_params-transport IS INITIAL
                       THEN |Wrote { cs_result-rows_written } row(s) to { lv_tabname } (direct, no transport)|
                       ELSE |Wrote { cs_result-rows_written } row(s) to { lv_tabname } (direct) -> { is_params-transport }| ).
      APPEND lv_msg TO cs_result-messages.
    CATCH cx_root INTO DATA(lx_wr).
      ROLLBACK WORK.
      cs_result-status = 'error'.
      APPEND |Direct write exception: { lx_wr->get_text( ) }| TO cs_result-messages.
  ENDTRY.

  CALL FUNCTION 'DEQUEUE_E_TABLE'
    EXPORTING mode_rstable = 'E' tabname = lv_enq.
ENDFORM.
