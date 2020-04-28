import { ADTClient } from "abap-adt-api"
import { AOService } from "."
import { create, fromNode } from "./creator"
import { PACKAGEBASEPATH } from "./AbapObject"

/** this will connect to a real server, and mostly rely on abapgit as sample data
 *   tests might brek with future versions of abapgit
 *   tested on 7.52, paths could change with releases
 */
export const getPackage = () => {
  const {
    ADT_SYSTEMID = "",
    ADT_URL = "",
    ADT_USER = "",
    ADT_PASS = ""
  } = process.env
  if (ADT_URL && ADT_USER && ADT_PASS) {
    const client = new ADTClient(ADT_URL, ADT_USER, ADT_PASS)
    const service = new AOService(client)
    const pkg = create(
      "DEVC/K",
      "$ABAPGIT",
      PACKAGEBASEPATH,
      true,
      "",
      undefined,
      service
    )
    return { pkg, service }
  } else
    throw new Error("Please set reuired environment variables in setenv.js")
}
const getObject = async (type: string, name: string) => {
  const { pkg, service } = getPackage()
  const children = await pkg.childComponents()

  const objdef = children.nodes.find(
    n => n.OBJECT_TYPE === type && n.OBJECT_NAME === name
  )

  expect(objdef).toBeDefined()
  const obj = fromNode(objdef!, pkg, service)
  return { obj, pkg, service }
}
test("Program in $ABAPGIT", async () => {
  const { obj, service } = await getObject("PROG/P", "ZABAPGIT")

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

test("interface in $ABAPGIT", async () => {
  const { obj } = await getObject("INTF/OI", "ZIF_ABAPGIT_EXIT")
  expect(obj).toBeDefined()
  expect(obj.expandable).toBe(false)
  expect(obj.structure).toBeUndefined()
  await obj.loadStructure()
  expect(obj.structure).toBeDefined()
  expect(obj.contentsPath()).toMatch(/\/source\/main/)
  const source = await obj.read()
  expect(source.match(/endinterface/i)).toBeTruthy()
})

test("includes in $ABAPGIT", async () => {
  const { obj } = await getObject("PROG/I", "ZABAPGIT_FORMS")
  expect(obj).toBeDefined()
  expect(obj.expandable).toBe(false)
  expect(obj.structure).toBeUndefined()
  await obj.loadStructure()
  expect(obj.structure).toBeDefined()
  expect(obj.contentsPath()).toMatch(/\/source\/main/)
  const source = await obj.read()
  expect(source.match(/form\s*run/i)).toBeTruthy()
})

test("class include in $ABAPGIT", async () => {
  const { obj, service } = await getObject(
    "CLAS/OC",
    "ZCL_ABAPGIT_DEPENDENCIES"
  )
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
    source.match(/CLASS\s+zcl_abapgit_dependencies\s+DEFINITION/i)
  ).toBeTruthy()

  const testClasses = fromNode(
    childNodes.find(n => n.TECH_NAME === "testclasses")!,
    obj,
    service
  )

  expect(testClasses.contentsPath()).toMatch(/\/includes\/testclasses/)
  const testSource = await testClasses.read()
  expect(testSource.match(/for\s+testing/i)).toBeTruthy()
})
