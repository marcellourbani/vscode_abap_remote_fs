import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"
import { loadPayload, ENGINE_VERSION, hsrchAreaCases, sourceVersion } from "./payload"

const assets = fileURLToPath(new URL("../../../media/customizing/", import.meta.url))
describe("canonical SAP payload", () => {
  it("resolves both deployment methods from complete, namespaced sources", () => {
    const payload = loadPayload(assets)
    expect(payload).toHaveLength(3)
    for (const object of payload) {
      expect(sourceVersion(object.source)).toBe(ENGINE_VERSION)
      expect(object.source).not.toMatch(/\{\{[A-Z_]+\}\}/)
      expect(object.source).not.toMatch(/zcl_mcp|zmcp_cust_write|indx\(Z[PRJ]\)/i)
      expect(object.source).toContain(object.name.toLowerCase())
    }
    expect(payload[1].source).toContain(ENGINE_VERSION)
    expect(payload[1].source).toContain("SUBMIT zabapfs_cust_write")
    expect(payload[1].source).toContain("indx(FJ)")
    expect(payload[2].source).toContain("indx(FP)")
    expect(payload[2].source).toContain("indx(FR)")
  })
  it("preserves all 62 SAP index areas with their case-sensitive language mapping", () => {
    const cases = hsrchAreaCases()
    expect(cases.match(/WHEN /g)).toHaveLength(62)
    expect(cases).toContain("WHEN 'D'.")
    expect(cases).toContain("indx_hsrch(01)")
    expect(cases).toContain("indx_hsrch(62)")
  })
  it("removes org-copy and listing operations while retaining ordinary asynchronous writes", () => {
    const payload = loadPayload(assets)
    for (const object of payload)
      expect(object.source).not.toMatch(/org[ _-]?copy|listing|ECOP_|WINT_LISTING|count_wlk1/i)
    const engine = payload.find(object => object.name === "ZCL_ABAPFS_CUST_ENGINE")!.source
    expect(engine).toContain("METHOD submit_batch_write.")
    expect(engine).toContain("METHOD handle_status.")
    expect(engine).toContain("ls_params-extras_json = is_req-extras_json.")
    const parameters = payload.slice(1).map(object => {
      const body = object.source.match(/BEGIN OF ty_params,([\s\S]*?)END OF ty_params\./)![1]
      return [...body.matchAll(/^\s*(\w+)\s+TYPE\s+(\w+)/gm)].map(match => [match[1], match[2]])
    })
    expect(parameters[0]).toEqual(parameters[1])
    expect(parameters[0]).toHaveLength(8)
  })
  it("omits unexposed diagnostic handlers while retaining readiness checks and job progress", () => {
    const payload = loadPayload(assets)
    for (const object of payload)
      expect(object.source).not.toMatch(
        /\b(?:run_hana_sql|handle_hana_memory|handle_abap_memory|handle_wp_detail)\b/i
      )
    for (const object of payload.filter(object => object.type === "CLAS/OC")) {
      expect(object.source).toContain("METHOD handle_ping.")
      expect(object.source).toContain("METHOD client_caps.")
      expect(object.source).toContain("METHOD probe_environment.")
    }
    const engine = payload.find(object => object.name === "ZCL_ABAPFS_CUST_ENGINE")!.source
    expect(engine).toContain("METHOD job_progress_note.")
    expect(engine).toContain("CALL FUNCTION 'TH_WPINFO'")
  })
  it("dispatches only operations used by ABAP FS and omits unused donor protocols", () => {
    const payload = loadPayload(assets)
    const dispatcherOperations = (source: string) => {
      const request = source.match(
        /METHOD if_http_extension~handle_request\.([\s\S]*?)ENDMETHOD\./
      )![1]
      return [...request.matchAll(/WHEN '([^']+)'\./g)].map(match => match[1]).sort()
    }
    expect(dispatcherOperations(payload[0].source)).toEqual(["ping"])
    expect(dispatcherOperations(payload[1].source)).toEqual([
      "create",
      "delete",
      "img_index_read",
      "img_search",
      "ping",
      "status",
      "write"
    ])
    for (const object of payload)
      expect(object.source).not.toMatch(
        /tabkeys_json|\bit_keys\b|handle_selftest|handle_read\b|handle_transport_move|sy_message_text|from_trkorr|to_trkorr|objects_json/i
      )
  })
  it("includes view-only create extras in dry-run responses without changing the commit plan", () => {
    const source = loadPayload(assets).find(
      object => object.name === "ZCL_ABAPFS_CUST_ENGINE"
    )!.source
    expect(source).toMatch(
      /BEGIN OF ty_response,[\s\S]*?extras_json\s+TYPE string,[\s\S]*?END OF ty_response/
    )
    const create = source.match(/METHOD handle_create\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(create).toContain("RECEIVING r_json      = ls_req-extras_json")
    expect(create).toMatch(
      /IF is_req-commit = abap_false\.[\s\S]*?rs_resp-extras_json = ls_req-extras_json\.[\s\S]*?rs_resp-data_json[\s\S]*?RETURN\.[\s\S]*?ENDIF\./
    )
    expect(create).toContain("commit_plan( EXPORTING is_req  = ls_req")
    expect(create).toContain("View-only fields require maintenance processing")
    expect(create).toContain(
      "Direct base-table write planned; maintenance-view checks will not run"
    )
    expect(create).toContain("SELECT fieldname FROM dd03l INTO TABLE required_keys")
    expect(create).toContain("Every explicit row must supply key field")
    expect(create).toContain("including an explicit blank when intended")
  })
  it("routes delete through shared transport creation and preserves request numbers in status results", () => {
    const payload = loadPayload(assets)
    const engine = payload[1].source
    const remove = engine.match(/METHOD handle_delete\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(remove).toContain("ls_wreq-action = 'DEL'")
    expect(remove).toContain("commit_plan( EXPORTING is_req  = ls_wreq")
    expect(remove).not.toContain("submit_batch_write")
    const commit = engine.match(/METHOD commit_plan\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(commit).toContain("create_cust_transport(")
    expect(commit).toContain("a new Customizing request cannot be used in this client")
    expect(commit).toContain("Application tables do not support creating a Customizing request")
    expect(commit).toContain("THEN 'Deleted' ELSE 'Written'")
    expect(payload[2].source).toContain("ls_result-transport = parent_request")
    expect(payload[2].source).toContain("ls_result-transport = ls_params-transport")
    expect(engine).toContain("rs_resp-transport = ls_jh-transport")
    expect(engine).toContain("rs_resp-transport = parent_request")
    expect(engine).toContain("must belong to an open Customizing request")
    expect(engine).toContain("is not an open Customizing task")
  })
  it("plans typed apply extras for both preview and maintenance-runtime commit", () => {
    const source = loadPayload(assets).find(
      object => object.name === "ZCL_ABAPFS_CUST_ENGINE"
    )!.source
    const apply = source.match(/METHOD handle_write\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(apply).toContain("CLEAR lt_rowx.")
    expect(apply).toContain("OF STRUCTURE <view> TO <ov>")
    expect(apply).toMatch(/<ov> = ls_ov-value\.[\s\S]*?value = <ov>/)
    expect(apply).toMatch(/APPEND <new> TO <plan>\.[\s\S]*?ls_rx-row = lines\( <plan> \)/)
    expect(apply).toMatch(
      /IF is_req-commit = abap_false\.[\s\S]*?rs_resp-extras_json = ls_req-extras_json\./
    )
    expect(apply).toContain("commit_plan( EXPORTING is_req  = ls_req")
    expect(apply).toContain("View-only field overrides require the maintenance runtime")
    expect(apply).toContain("is_req-record_transport = abap_false OR lv_flag = 'A'")
    expect(apply).toContain("View-only fields use SAP logon language { sy-langu }")
  })
  it("retains existing view fields for in-place edits without enabling automatic text copying", () => {
    const source = loadPayload(assets).find(
      object => object.name === "ZCL_ABAPFS_CUST_ENGINE"
    )!.source
    const apply = source.match(/METHOD handle_write\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(apply).toMatch(/IF in_place = abap_true\.[\s\S]*?CALL FUNCTION 'VIEW_GET_DATA'/)
    expect(apply).toContain("with_authority_check = abap_true")
    expect(apply).toContain("check_linedep_auth   = abap_true")
    expect(apply).toContain("WITH TABLE KEY tabkey = lv_nk")
    expect(apply).toContain("value = <view_fld>")
    expect(apply).toContain("In-place updates cannot change key field")
    expect(apply).toContain("No existing { is_req-table } row found")
    expect(apply).toContain("edit refused")
    expect(apply).toMatch(/IF sy-subrc <> 0\.[\s\S]*?Cannot read current entries/)
  })
  it("initializes the generic view-reader metadata and external selection contract", () => {
    const source = loadPayload(assets).find(
      object => object.name === "ZCL_ABAPFS_CUST_ENGINE"
    )!.source
    const apply = source.match(/METHOD handle_write\.([\s\S]*?)ENDMETHOD\./)![1]
    expect(apply).toMatch(/CALL FUNCTION 'VIEW_GET_DDIC_INFO'[\s\S]*?CALL FUNCTION 'VIEW_GET_DATA'/)
    expect(apply).toContain("WITH KEY bastabname = is_req-table bastabfld = is_req-key_field")
    expect(apply).toContain("DATA(selection_index) = sy-tabix")
    expect(apply).toContain("CALL FUNCTION 'VIEW_CONVERSION_OUTPUT'")
    expect(apply).toContain("value = selection_value tabix = selection_index")
    expect(apply).not.toContain("converted = abap_true")
    expect(apply).toContain("initial = xsdbool( <key> IS INITIAL )")
    expect(apply).toContain("<last_selection>-and_or = 'AND'")
    expect(apply).toContain("x_header             = view_headers")
    expect(apply).toContain("x_namtab             = view_fields")
    expect(apply).toContain("OF STRUCTURE <view> TO <view_fld>")
    expect(apply).toContain("OF STRUCTURE <one> TO <base_fld>")
    expect(apply).toContain("IF alias_field-viewfield = alias_field-bastabfld")
    expect(apply).toContain("field = alias_field-viewfield value = <base_fld>")
    expect(apply).toContain("In-place updates cannot change the base-table key")
    expect(apply).toContain("ir_row = lr_one")
    expect(apply).toContain("returned no rows")
    expect(apply).toContain("returned rows but none matched base key")
    expect(apply).not.toMatch(/T416|ANTXT|STLAN/)
  })
  it("keeps bundled payload sources ASCII for SAP source encoding", () => {
    for (const object of loadPayload(assets)) expect(object.source).not.toMatch(/[^\x00-\x7F]/)
  })
  it("uses ABAP FS terminology without inherited risk tiers or MCP-only backend branding", () => {
    for (const object of loadPayload(assets)) {
      const implementation = object.source
        .split("\n")
        .filter(line => !line.includes("Adapted from abap-config-mcp"))
        .join("\n")
      expect(implementation).not.toMatch(/\bTier\s+\d|\bMCP\b/i)
      expect(object.source).toContain("Adapted from abap-config-mcp")
    }
  })
  it.each(["", "CLASS zcl_example DEFINITION.", "* ABAP FS Customizing\n"])(
    "does not invent an installed version from %s",
    source => expect(sourceVersion(source)).toBeUndefined()
  )
  it.each(["1.0.0", "2.1.0-beta.2", "0.0.1_abapfs"])("reads a first-line version %s", version => {
    expect(sourceVersion(`* ABAP FS Customizing ${version}\nREPORT z.`)).toBe(version)
    expect(sourceVersion(`" ABAP FS Customizing ${version}\nREPORT z.`)).toBeUndefined()
  })
  it.each(["\n", "\r\n"])("reads only the class version method with line ending %j", newline => {
    const source = [
      "CLASS z DEFINITION.",
      "ENDCLASS.",
      "CLASS z IMPLEMENTATION.",
      "  METHOD VERSION.",
      "* ABAP FS Customizing 1.0.0",
      "  ENDMETHOD.",
      "ENDCLASS."
    ].join(newline)
    expect(sourceVersion(source)).toBe("1.0.0")
    expect(sourceVersion(source.replace("METHOD VERSION.", "METHOD other."))).toBeUndefined()
    expect(sourceVersion(source.replace("* ABAP FS", '" ABAP FS'))).toBeUndefined()
    expect(sourceVersion("CLASS z DEFINITION.\n* ABAP FS Customizing 1.0.0\n")).toBeUndefined()
    expect(sourceVersion(source.replace(`  METHOD VERSION.${newline}`, ""))).toBeUndefined()
  })
  it("keeps class markers inside an unused private method and report markers first", () => {
    const payload = loadPayload(assets)
    for (const object of payload.filter(object => object.type === "CLAS/OC")) {
      expect(object.source).toMatch(/^CLASS \w+ DEFINITION\r?\n  PUBLIC/)
      expect(object.source).toContain("  PRIVATE SECTION.\n    METHODS version.")
      expect(object.source).toContain(
        `  METHOD version.\n* ABAP FS Customizing ${ENGINE_VERSION}\n`
      )
      expect(object.source).not.toMatch(/\bversion\s*\(/i)
    }
    expect(payload[2].source).toContain(`* ABAP FS Customizing ${ENGINE_VERSION}\n`)
  })
  it("uses one plain engine release for source markers and runtime constants", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    for (const object of loadPayload(assets)) {
      expect(sourceVersion(object.source)).toBe(ENGINE_VERSION)
      if (object.type === "CLAS/OC")
        expect(object.source).toContain(
          `CONSTANTS c_version TYPE string VALUE '${ENGINE_VERSION}'.`
        )
    }
  })
  it("returns fresh immutable-by-convention payload entries", () => {
    const first = loadPayload(assets)
    first[0].source = "changed"
    expect(loadPayload(assets)[0].source).not.toBe("changed")
  })
  it("has unique object names, paths, filenames and endpoint identities", () => {
    const payload = loadPayload(assets)
    for (const key of ["name", "path", "file"] as const)
      expect(new Set(payload.map(object => object[key])).size).toBe(payload.length)
    expect(payload.filter(object => object.service)).toHaveLength(2)
  })
  it("uses every HSRCH area exactly once", () => {
    const cases = hsrchAreaCases()
    const languages = [...cases.matchAll(/WHEN '(.)'/g)].map(match => match[1])
    const areas = [...cases.matchAll(/indx_hsrch\((\d+)\)/g)].map(match => Number(match[1]))
    expect(new Set(languages).size).toBe(62)
    expect(areas).toEqual(Array.from({ length: 62 }, (_, index) => index + 1))
  })
  it("preserves the MIT attribution in canonical assets", () => {
    for (const object of loadPayload(assets))
      expect(object.source).toContain("Copyright (c) 2026 Geert Steyaert")
  })
  it("reads CRLF source headers", () =>
    expect(sourceVersion("* ABAP FS Customizing 1.0.0\r\n")).toBe("1.0.0"))
  it("reports missing assets instead of exporting an empty installation", () => {
    expect(() => loadPayload("does-not-exist")).toThrow()
  })
})
