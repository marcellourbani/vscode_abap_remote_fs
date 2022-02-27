import { CompletionItem } from "vscode-languageserver"
import { formatItem } from "../completionutils"

test("formatItem_star_prefix", () => {
    const line = '        select * from /foo/ba*au*'
    const pos = { line: 1, character: 33 }
    const raw = { "KIND": 2, "IDENTIFIER": "/FOO/BA_AUTHACTV", "ICON": 17, "SUBICON": 0, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 7, "ROLE": 62, "LOCATION": 3, "GRADE": 0, "VISIBILITY": 0, "IS_INHERITED": 0, "PROP1": 0, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 80 }
    const parsed = formatItem(line, pos)(raw)
    const expected = {
        "label": "/FOO/BA_AUTHACTV", "sortText": "3  /FOO/BA_AUTHACTV",
        "textEdit": { "range": { "start": { "line": 1, "character": 33 }, "end": { "line": 1, "character": 33 } }, "newText": "/FOO/BA_AUTHACTV" },
        "additionalTextEdits": [{ "range": { "start": { "line": 1, "character": 22 }, "end": { "line": 1, "character": 33 } }, "newText": "" }],
        "data": raw
    }
    expect(parsed).toEqual(expected)
})

test("simple method", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      CL_SALV_TABLE=>fa'
    const pos = { line: 1, character: 23 }
    const parsed = formatItem(line, pos)(raw)
    const expected = { "label": "FACTORY", "insertText": "FACTORY", "sortText": "4  FACTORY", "data": raw }
    expect(parsed).toEqual(expected)
})

test("method", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "FACTORY", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 2, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      CL_SALV_TABLE=>fa*r*.clear PHASE_COUNT_ROW.'
    const pos = { line: 1, character: 26 }
    const parsed = formatItem(line, pos)(raw)
    const expected = {
        "label": "FACTORY", "sortText": "4  FACTORY",
        "textEdit": { "range": { "start": { "line": 1, "character": 26 }, "end": { "line": 1, "character": 26 } }, "newText": "FACTORY" },
        "additionalTextEdits": [{ "range": { "start": { "line": 1, "character": 21 }, "end": { "line": 1, "character": 26 } }, "newText": "" }],
        "data": raw
    }
    expect(parsed).toEqual(expected)
})

test("namespaced method pattern", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "CONV_XSTRING_TO_STRING", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 5, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      /UI2/CL_ABAP2JSON=>CONV_*TO*'
    const pos = { line: 1, character: 34 }
    const parsed = formatItem(line, pos)(raw)
    const expected = {
        "label": "CONV_XSTRING_TO_STRING", "sortText": "4  CONV_XSTRING_TO_STRING",
        "textEdit": { "range": { "start": { "line": 1, "character": 34 }, "end": { "line": 1, "character": 34 } }, "newText": "CONV_XSTRING_TO_STRING" },
        "additionalTextEdits": [{ "range": { "start": { "line": 1, "character": 25 }, "end": { "line": 1, "character": 34 } }, "newText": "" }],
        "data": raw
    }
    expect(parsed).toEqual(expected)
    // /UI2/CL_ABAP2JSON=>CONV_*TO*CONV_XSTRING_TO_STRING
})

test("namespaced class", () => {
    const raw = { "KIND": 2, "IDENTIFIER": "/FOO/FOOBAR_SOMETHING", "ICON": 5, "SUBICON": 0, "BOLD": 0, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 12, "ROLE": 57, "LOCATION": 3, "GRADE": 1, "VISIBILITY": 0, "IS_INHERITED": 0, "PROP1": 0, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 0 }
    const line = '      /FOO/FOOBAR_.clear phase_count_row.'
    const pos = { line: 208, character: 18 }
    const parsed = formatItem(line, pos)(raw)
    const expected = { "label": "/FOO/FOOBAR_SOMETHING", "insertText": "FOOBAR_SOMETHING", "sortText": "3  /FOO/FOOBAR_SOMETHING", "data": raw }
    expect(parsed).toEqual(expected)

})
test("field symbol", () => {
    const raw = { "KIND": 1, "IDENTIFIER": "<FOOBAR>", "ICON": 6, "SUBICON": 0, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 4, "ROLE": 13, "LOCATION": 0, "GRADE": 0, "VISIBILITY": 0, "IS_INHERITED": 0, "PROP1": 0, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 0 }
    const line = '      <foo>.clear phase_count_row.'
    const pos = { line: 208, character: 10 }
    const parsed = formatItem(line, pos)(raw)
    const expected = { "label": "<FOOBAR>", "insertText": "FOOBAR", "sortText": "0  <FOOBAR>", "data": raw }
    expect(parsed).toEqual(expected)

})
test("namespaced method pattern2", () => {
    const raw = { "KIND": 3, "IDENTIFIER": "CONV_XSTRING_TO_STRING", "ICON": 11, "SUBICON": 2, "BOLD": 1, "COLOR": 0, "QUICKINFO_EVENT": 1, "INSERT_EVENT": 1, "IS_META": 0, "PREFIXLENGTH": 5, "ROLE": 81, "LOCATION": 4, "GRADE": 0, "VISIBILITY": 1, "IS_INHERITED": 0, "PROP1": 1, "PROP2": 0, "PROP3": 0, "SYNTCNTXT": 2 }
    const line = '      /UI2/CL_ABAP2JSON=>CONV_*TO*.clear phase_count_row.'
    const pos = { line: 208, character: 34 }
    const parsed = formatItem(line, pos)(raw)
    const expected: CompletionItem = {
        "label": "CONV_XSTRING_TO_STRING", "sortText": "4  CONV_XSTRING_TO_STRING",
        "textEdit": { "range": { "start": { "line": 208, "character": 34 }, "end": { "line": 208, "character": 34 } }, "newText": "CONV_XSTRING_TO_STRING" },
        "additionalTextEdits": [{ "range": { "start": { "line": 208, "character": 25 }, "end": { "line": 208, "character": 34 } }, "newText": "" }],
        "data": raw
    }
    expect(parsed).toEqual(expected)
    // /UI2/CL_ABAP2JSON=>CONV_*TO*CONV_XSTRING_TO_STRING
})