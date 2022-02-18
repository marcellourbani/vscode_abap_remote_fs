import { ADTClient } from "abap-adt-api"
import { AOService } from "."
import { create, fromNode } from "./creator"
import { PACKAGEBASEPATH, AbapObject } from "./AbapObject"
import { isAbapClass } from "./objectTypes"
import { Agent } from "https"
import { mock } from "jest-mock-extended"

/** this will connect to a real server, and mostly rely on abapgit as sample data
 *   tests might brek with future versions of abapgit
 *   tested on 7.52, paths could change with releases
 */
const getRootForTest = () => {
  const {
    ADT_SYSTEMID = "",
    ADT_URL = "",
    ADT_USER = "",
    ADT_PASS = ""
  } = process.env
  if (ADT_URL && ADT_USER && ADT_PASS) {
    const options = ADT_URL.match(/^https/i) ? { httpsAgent: new Agent({ rejectUnauthorized: false }) } : {}
    const client = new ADTClient(ADT_URL, ADT_USER, ADT_PASS, undefined, undefined, options)
    const service = new AOService(client)
    return { service, client }
  }
  return {}
}
export const runTest = (f: (s: AOService) => Promise<void>) => {
  const { service, client } = getRootForTest()
  return async () => {
    if (!service || !client) {
      // tslint:disable-next-line:no-console
      console.log("Connection not configured, no test was run")
      return
    }
    try {
      await f(service)
    } finally {
      jest.setTimeout(5000) // restore the default 5000
      if (client.statelessClone.loggedin) client.statelessClone.logout()
      if (client.loggedin) client.logout()
    }
  }
}

const getPackage = (name: string, service: AOService) => {
  return create(
    "DEVC/K",
    name,
    PACKAGEBASEPATH,
    true,
    "",
    undefined,
    "",
    service
  )
}

const runPkgTest = (f: (s: AOService, pkg: AbapObject) => Promise<void>) =>
  runTest(service => {
    const pkg = getPackage("$ABAPGIT", service)
    return f(service, pkg)
  })

const runObjTest = (
  type: string,
  name: string,
  f: (s: AOService, pkg: AbapObject, obj: AbapObject) => Promise<void>
) =>
  runPkgTest(async (service, pkg) => {
    const children = await pkg.childComponents()

    const objdef = children.nodes.find(
      n => n.OBJECT_TYPE === type && n.OBJECT_NAME === name
    )

    expect(objdef).toBeDefined()
    const obj = fromNode(objdef!, pkg, service)

    return f(service, pkg, obj)
  })

test(
  "Program in $ABAPGIT",
  runObjTest("PROG/P", "ZABAPGIT", async (service, pkg, obj) => {
    expect(obj.expandable).toBe(true)
    expect(obj.structure).toBeUndefined()
    await obj.loadStructure()
    expect(obj.structure).toBeDefined()
    const progParts = await obj.childComponents()
    const main = progParts.nodes.find(n => n.OBJECT_TYPE.match(/PROG\//))
    expect(main).toBeDefined()
    const include = fromNode(main!, obj, service)
    expect(include).toBeDefined()
    const struc = await include.loadStructure()
    expect(struc === include.structure).toBe(true)
    expect(include.contentsPath()).toBe(
      "/sap/bc/adt/programs/programs/zabapgit/source/main"
    )
    const source = await include.read()
    expect(source.match(/report\s*zabapgit\s*line-size\s*\d+/i)).toBeTruthy()
  })
)

test(
  "interface in $ABAPGIT",
  runObjTest("INTF/OI", "ZIF_ABAPGIT_EXIT", async (service, pkg, obj) => {
    expect(obj).toBeDefined()
    expect(obj.expandable).toBe(false)
    expect(obj.structure).toBeUndefined()
    await obj.loadStructure()
    expect(obj.structure).toBeDefined()
    expect(obj.contentsPath()).toMatch(/\/source\/main/)
    const source = await obj.read()
    expect(source.match(/endinterface/i)).toBeTruthy()
  })
)

test(
  "includes in $ABAPGIT",
  runObjTest("PROG/I", "ZABAPGIT_FORMS", async (service, pkg, obj) => {
    expect(obj).toBeDefined()
    expect(obj.expandable).toBe(false)
    expect(obj.structure).toBeUndefined()
    await obj.loadStructure()
    expect(obj.structure).toBeDefined()
    expect(obj.contentsPath()).toMatch(/\/source\/main/)
    const source = await obj.read()
    expect(source.match(/form\s*run/i)).toBeTruthy()
  })
)

test(
  "class include in $ABAPGIT",
  runObjTest(
    "CLAS/OC",
    "ZCL_ABAPGIT_AUTH",// replaced class with one in current $ABAPGIT package
    async (service, pkg, obj) => {
      expect(obj).toBeDefined()
      expect(obj.expandable).toBe(true)
      expect(obj.structure).toBeUndefined()
      await obj.loadStructure()
      expect(obj.structure).toBeDefined()

      const childNodes = await (await obj.childComponents()).nodes

      const main = fromNode(
        childNodes.find(n => n.TECH_NAME === "main")!,
        obj,
        service
      )

      expect(main.contentsPath()).toMatch(/\/source\/main/)
      const source = await main.read()
      expect(
        source.match(/CLASS\s+zcl_abapgit_auth\s+DEFINITION/i)
      ).toBeTruthy()

      const testClasses = fromNode(
        childNodes.find(n => n.TECH_NAME === "testclasses")!,
        obj,
        service
      )

      expect(testClasses.contentsPath()).toMatch(/\/includes\/testclasses/)
      const testSource = await testClasses.read()
      expect(testSource.match(/for\s+testing/i)).toBeTruthy()
    }
  )
)

test(
  "main include in CL_ABAP_TABLEDESCR",
  runTest(async s => {
    const clas = create(
      "CLAS/OC",
      "CL_ABAP_TABLEDESCR",
      "/sap/bc/adt/oo/classes/cl_abap_tabledescr",
      true,
      "==============================CP",
      undefined,
      "/sap/bc/adt/vit/wb/object_type/clasoc/object_name/cl_abap_tabledescr",
      s
    )
    if (!isAbapClass(clas)) fail("Error reading class CL_ABAP_TABLEDESCR")
    await clas.loadStructure()
    const main = clas.structure?.includes?.find(
      i => i["class:includeType"] === "main"
    )
    expect(main).toBeDefined()
    const src = main?.links.find(
      l =>
        l.rel === "http://www.sap.com/adt/relations/source" &&
        l.type === "text/plain"
    )
    expect(src).toBeDefined()
    const includes = await clas
      .childComponents()
      .then(st => st.nodes.map(n => fromNode(n, clas, s)))
    const include = includes.find(
      o => o.fsName === "CL_ABAP_TABLEDESCR.clas.localtypes.abap"
    )
    expect(include).toBeDefined()
  })
)
