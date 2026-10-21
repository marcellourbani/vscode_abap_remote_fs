import { CreatableTypes } from "abap-adt-api"
import { installObjectCreationContentTypeInterceptor } from "./objectCreationContentTypeInterceptor"

vi.mock("../lib", () => ({ log: vi.fn() }))

function requestInterceptor() {
  const use = vi.fn()
  const client = {
    httpClient: {
      httpclient: {
        axios: {
          interceptors: {
            request: { use }
          }
        }
      }
    }
  }

  installObjectCreationContentTypeInterceptor(client as any)
  return use.mock.calls[0]?.[0]
}

describe("installObjectCreationContentTypeInterceptor", () => {
  it("installs a typed content type for a standard creation path", () => {
    const interceptor = requestInterceptor()
    const config = {
      method: "post",
      url: "/sap/bc/adt/programs/programs",
      headers: { "Content-Type": "application/*" }
    }

    expect(interceptor(config)).toBe(config)
    expect(config.headers["Content-Type"]).toBe("application/vnd.sap.adt.programs.programs+xml")
  })

  it("removes a substituted parent segment for grouped creation paths", () => {
    const interceptor = requestInterceptor()
    const config = {
      method: "POST",
      url: "/sap/bc/adt/functions/groups/z_test_group/fmodules?corrNr=DEVK900123",
      headers: { "Content-Type": "application/*" }
    }

    interceptor(config)

    expect(config.headers["Content-Type"]).toBe(
      "application/vnd.sap.adt.functions.groups.fmodules+xml"
    )
  })

  it("leaves unrelated wildcard POSTs unchanged", () => {
    const interceptor = requestInterceptor()
    const config = {
      method: "POST",
      url: "/sap/bc/adt/refactorings",
      headers: { "Content-Type": "application/*" }
    }

    interceptor(config)

    expect(config.headers["Content-Type"]).toBe("application/*")
  })

  it("does not rewrite creation requests with a specific content type", () => {
    const creationPath = [...CreatableTypes.values()][0].creationPath
    const url = `/sap/bc/adt/${creationPath.replace("/%s", "/parent")}`
    const config = {
      method: "POST",
      url,
      headers: { "Content-Type": "application/custom+xml" }
    }
    const interceptor = requestInterceptor()

    interceptor(config)

    expect(config.headers["Content-Type"]).toBe("application/custom+xml")
  })
})
