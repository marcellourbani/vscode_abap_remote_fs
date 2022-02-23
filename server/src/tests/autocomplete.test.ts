import { formatItem } from "../completionutils"

test("formatItem_star_prefix", () => {
    const line = '        select * from /foo/ba*au*'
    const char = 33
    const raw = { "KIND": 2, "IDENTIFIER": "/FOO/BA_AUTHACTV", "ICON": 17, "SUBICON": 0, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 7, "ROLE": 62, "LOCATION": 3, "GRADE": 0, "VISIBILITY": 0, "IS_INHERITED": 0, "PROP1": 0, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 80 }
    const parsed = formatItem(line, char)(raw)
    const expected = { "data": { "BOLD": 1, "COLOR": 0, "GRADE": 0, "ICON": 17, "IDENTIFIER": "/FOO/BA_AUTHACTV", "INSERT_EVENT": 1, "IS_INHERITED": 0, "IS_META": 0, "KIND": 2, "LOCATION": 3, "PREFIXLENGTH": 7, "PROP1": 0, "PROP2": 0, "PROP3": 0, "QUICKINFO_EVENT": 1, "ROLE": 62, "SUBICON": 0, "SYNTCNTXT": 80, "VISIBILITY": 0 }, "insertText": "BA_AUTHACTV", "label": "/FOO/BA_AUTHACTV", "sortText": "3  /FOO/BA_AUTHACTV" }
    expect(parsed).toEqual(expected)
})

test("simple method", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      CL_SALV_TABLE=>fa'
    const char = 23
    const parsed = formatItem(line, char)(raw)
    const expected = { "label": "FACTORY", "insertText": "FACTORY", "sortText": "4  FACTORY", "data": { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 } }
    expect(parsed).toEqual(expected)
})

test("method", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      CL_SALV_TABLE=>fa*r*'
    const char = 26
    const parsed = formatItem(line, char)(raw)
    const expected = { "label": "FACTORY", "insertText": "FACTORY", "sortText": "4  FACTORY", "data": { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 } }
    expect(parsed).toEqual(expected)
})

test("namespaced method pattern", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "CONV_XSTRING_TO_STRING", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 5, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      /UI2/CL_ABAP2JSON=>CONV_*TO*'
    const char = 34
    const parsed = formatItem(line, char)(raw)
    const expected = { "label": "CONV_XSTRING_TO_STRING", "insertText": "CONV_XSTRING_TO_STRING", "sortText": "4  CONV_XSTRING_TO_STRING", "data": { "KIND": 3, "IDENTIFIER": "CONV_XSTRING_TO_STRING", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 5, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 } }
    expect(parsed).toEqual(expected)
    // /UI2/CL_ABAP2JSON=>CONV_*TO*CONV_XSTRING_TO_STRING
})