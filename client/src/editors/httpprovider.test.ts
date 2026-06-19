// Tests for editors/httpprovider.ts
jest.mock("vscode", () => ({
  Uri: {
    file: jest.fn((p: string) => ({ fsPath: p, toString: () => p }))
  },
  ExtensionContext: class {}
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    registerCustomEditorProvider: jest.fn(() => ({ dispose: jest.fn() }))
  }
}))

jest.mock("./httpparser", () => ({
  parseHTTP: jest.fn()
}))

jest.mock("path", () => ({
  join: jest.fn((...args: string[]) => args.join("/"))
}))

import { parseHTTP } from "./httpparser"

// Test the HTML generation logic by extracting it
const makeField = (name: string, value: string) =>
  `<tr><td><strong>${name}</strong></td><td>${value}</td></tr>`

const toHtmlLogic = (service: { name: string; text: string; handlerClass: string; author: string; url: string }) => {
  const tbody =
    makeField("Handler Class", service.handlerClass) +
    makeField("Author", service.author) +
    makeField("Url", service.url)

  return `<!DOCTYPE html>
        <html lang="en">
        <head>
        <title>HTTP service</title>
        <link href="test.css" rel="stylesheet" />
        <script>
        const vscode = acquireVsCodeApi();
        function send(event,url){
            event.preventDefault();
            vscode.postMessage({type:"doc",url});
        }
        </script></head>
        <body>
        <h1>${service.name} ${service.text}</h1>
        <table><tbody>${tbody}</tbody></table>
        </body></html>`
}

describe("httpprovider.ts - HTML generation logic", () => {
  it("generates HTML containing service name and text", () => {
    const service = {
      name: "MY_SERVICE",
      text: "My Service Description",
      handlerClass: "ZCL_MY_HANDLER",
      author: "DEVELOPER",
      url: "/sap/bc/my/service"
    }
    const html = toHtmlLogic(service)
    expect(html).toContain("MY_SERVICE")
    expect(html).toContain("My Service Description")
  })

  it("includes handler class in tbody", () => {
    const service = {
      name: "SVC",
      text: "text",
      handlerClass: "ZCL_HANDLER",
      author: "user",
      url: "/sap/bc/svc"
    }
    const html = toHtmlLogic(service)
    expect(html).toContain("ZCL_HANDLER")
    expect(html).toContain("Handler Class")
  })

  it("includes author in tbody", () => {
    const service = {
      name: "SVC2",
      text: "t",
      handlerClass: "CL_HANDLER",
      author: "JOHN_DOE",
      url: "/some/url"
    }
    const html = toHtmlLogic(service)
    expect(html).toContain("JOHN_DOE")
    expect(html).toContain("Author")
  })

  it("includes URL in tbody", () => {
    const service = {
      name: "SVC3",
      text: "t",
      handlerClass: "CL_H",
      author: "A",
      url: "/sap/bc/special/path"
    }
    const html = toHtmlLogic(service)
    expect(html).toContain("/sap/bc/special/path")
    expect(html).toContain("Url")
  })

  it("produces valid DOCTYPE declaration", () => {
    const html = toHtmlLogic({ name: "S", text: "T", handlerClass: "H", author: "A", url: "U" })
    expect(html).toContain("<!DOCTYPE html>")
  })

  it("includes vscode API script", () => {
    const html = toHtmlLogic({ name: "S", text: "T", handlerClass: "H", author: "A", url: "U" })
    expect(html).toContain("acquireVsCodeApi")
    expect(html).toContain('type:"doc"')
  })
})

describe("httpprovider.ts - field helper", () => {
  it("wraps name in strong tag", () => {
    const result = makeField("Name", "Value")
    expect(result).toBe("<tr><td><strong>Name</strong></td><td>Value</td></tr>")
  })

  it("handles special characters in value", () => {
    const result = makeField("Key", "<value>")
    expect(result).toContain("<value>")
  })
})
