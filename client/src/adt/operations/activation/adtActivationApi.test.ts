import {
  activationRequestBody,
  parseActivationResponse,
  parseInactiveObjects
} from "./adtActivationApi"

const iocXml = `<?xml version="1.0" encoding="utf-8"?>
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">
  <ioc:entry>
    <ioc:object ioc:user="DEVELOPER" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/programs/includes/ztest_i01" adtcore:type="PROG/I" adtcore:name="ZTEST_I01" adtcore:parentUri="/sap/bc/adt/programs/programs/ztest"/>
    </ioc:object>
    <ioc:transport ioc:user="DEVELOPER" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/cts/transportrequests/DEVK900002" adtcore:type="/RQ" adtcore:name="DEVK900002" adtcore:parentUri="/sap/bc/adt/cts/transportrequests/DEVK900001" adtcore:description="Fix"/>
    </ioc:transport>
  </ioc:entry>
</ioc:inactiveObjects>`

describe("parseInactiveObjects", () => {
  it("parses the ioc format with transports", () => {
    expect(parseInactiveObjects(iocXml)).toEqual([
      {
        object: {
          "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_i01",
          "adtcore:type": "PROG/I",
          "adtcore:name": "ZTEST_I01",
          "adtcore:parentUri": "/sap/bc/adt/programs/programs/ztest",
          user: "DEVELOPER",
          deleted: false
        },
        transport: {
          "adtcore:uri": "/sap/bc/adt/cts/transportrequests/DEVK900002",
          "adtcore:type": "/RQ",
          "adtcore:name": "DEVK900002",
          "adtcore:parentUri": "/sap/bc/adt/cts/transportrequests/DEVK900001",
          "adtcore:description": "Fix",
          user: "DEVELOPER",
          deleted: false
        }
      }
    ])
  })

  it("parses the object reference format", () => {
    const records = parseInactiveObjects(
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/ztest" adtcore:type="PROG/P" adtcore:name="ZTEST"/>
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/includes/ztest_i01"/>
      </adtcore:objectReferences>`
    )

    expect(records).toEqual([
      {
        object: {
          "adtcore:uri": "/sap/bc/adt/programs/programs/ztest",
          "adtcore:type": "PROG/P",
          "adtcore:name": "ZTEST",
          "adtcore:parentUri": "",
          user: "",
          deleted: false
        }
      }
    ])
  })

  it("returns no records for an empty body", () => {
    expect(parseInactiveObjects("")).toEqual([])
  })
})

describe("parseActivationResponse", () => {
  it("treats an empty response as success", () => {
    expect(parseActivationResponse("")).toEqual({ success: true, messages: [], inactive: [] })
  })

  it("fails on error messages and keeps their text", () => {
    const result = parseActivationResponse(
      `<chkl:messages xmlns:chkl="http://www.sap.com/adt/checkresults">
        <msg type="E" objDescr="Include ZTEST_I01" line="12" href="/sap/bc/adt/programs/includes/ztest_i01/source/main#start=12,1" forceSupported="true">
          <shortText><txt>Field FOO is unknown</txt></shortText>
        </msg>
      </chkl:messages>`
    )

    expect(result.success).toBe(false)
    expect(result.messages).toEqual([
      {
        objDescr: "Include ZTEST_I01",
        type: "E",
        line: 12,
        href: "/sap/bc/adt/programs/includes/ztest_i01/source/main#start=12,1",
        forceSupported: true,
        shortText: "Field FOO is unknown"
      }
    ])
  })

  it("joins message texts split into several txt parts", () => {
    const result = parseActivationResponse(
      `<chkl:messages xmlns:chkl="http://www.sap.com/adt/checkresults">
        <msg type="E"><shortText><txt>Field "GV_X" is unknown.</txt><txt>Check the spelling.</txt></shortText></msg>
      </chkl:messages>`
    )

    expect(result.messages[0].shortText).toBe('Field "GV_X" is unknown. Check the spelling.')
  })

  it("succeeds with warnings only", () => {
    const result = parseActivationResponse(
      `<chkl:messages xmlns:chkl="http://www.sap.com/adt/checkresults">
        <msg type="W"><shortText><txt>Unused variable</txt></shortText></msg>
      </chkl:messages>`
    )

    expect(result.success).toBe(true)
    expect(result.messages).toHaveLength(1)
  })

  it("fails and lists the objects SAP wants activated together", () => {
    const result = parseActivationResponse(iocXml)

    expect(result.success).toBe(false)
    expect(result.messages).toEqual([])
    expect(result.inactive[0].object?.["adtcore:name"]).toBe("ZTEST_I01")
  })
})

describe("activationRequestBody", () => {
  it("escapes attributes and omits an empty parent URI", () => {
    const body = activationRequestBody([
      {
        uri: "/sap/bc/adt/programs/includes/zinc?context=%2fsap%2fbc&x=1",
        type: "PROG/I",
        name: "ZINC",
        parentUri: ""
      },
      { uri: "/sap/bc/adt/oo/classes/zcl", type: "CLAS/OC", name: "ZCL", parentUri: "/p" }
    ])

    expect(body).toContain(
      `<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/includes/zinc?context=%2fsap%2fbc&amp;x=1" adtcore:type="PROG/I" adtcore:name="ZINC"/>`
    )
    expect(body).toContain(`adtcore:name="ZCL" adtcore:parentUri="/p"/>`)
  })
})
