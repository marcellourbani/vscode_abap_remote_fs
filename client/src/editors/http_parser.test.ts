import { parseHTTP } from "./httpparser"

const SAMPLE_OBJECT = `<?xml version="1.0" encoding="utf-8"?><http:abap http:handler_id="YMU_HELLO_WORLD"
 http:handler_version="I" http:handler_serviceorder="01" http:handler_servicehandler="YCL_YMU_HELLO_WORLD"
 adtcore:responsible="CB0000000083" adtcore:masterLanguage="EN" adtcore:masterSystem="TRL"
 adtcore:name="YMU_HELLO_WORLD" adtcore:type="HTTP" adtcore:changedBy="CB0000000083" adtcore:createdBy="CB0000000083"
 adtcore:description="Hello" adtcore:language="EN" http:header_id="YMU_HELLO_WORLD" http:header_version="I"
 http:header_createdby="CB0000000083" http:header_createdon="2020-09-02" http:header_createdat="22:39:37"
 http:header_changedby="CB0000000083" http:header_changedon="2020-09-02" http:header_changedat="22:39:37"
 http:header_canonicalurl="/sap/bc/http/sap/ymu_hello_world/" http:header_icf_name="YMU_HELLO_WORLD"
 http:header_icfparguid="DI6X3AACS0LZQ3AYA7NG65CGL" http:text_id="YMU_HELLO_WORLD" http:text_version="I"
 http:text_lang="E" http:text_shorttext="Hello" xmlns:http="http://www.sap.com/uc_object_type_group/http/abapxml"
 xmlns:adtcore="http://www.sap.com/adt/core"/>`

interface HttpService {
    handlerClass: string,
    author: string,
    name: string,
    text: string,
    url: string,
}


test("Parse http definition", () => {

    const service = parseHTTP(SAMPLE_OBJECT)
    expect(service.author).toBe("CB0000000083")
    expect(service.handlerClass).toBe("YCL_YMU_HELLO_WORLD")
    expect(service.url).toBe("/sap/bc/http/sap/ymu_hello_world/")
    expect(service.name).toBe("YMU_HELLO_WORLD")
    expect(service.text).toBe("Hello")
})