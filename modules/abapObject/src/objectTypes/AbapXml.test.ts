import { mock } from "jest-mock-extended"
import { AbapObjectStructure } from "abap-adt-api"
import { create } from "../creator"
import { AbapObjectService } from "../AOService"
import { isAbapXml } from "./AbapXml"

describe.each([
  ["DOMA/DD", "domains", "doma"],
  ["DOMA/DO", "domains", "doma"],
  ["TTYP/DA", "tabletypes", "ttyp"],
  ["TTYP/TT", "tabletypes", "ttyp"]
])("DDIC XML %s", (type, collection, extension) => {
  const path = `/sap/bc/adt/ddic/${collection}/yexample`
  const xml = '<?xml version="1.0" encoding="UTF-8"?><example/>'
  const setup = () => {
    const service = mock<AbapObjectService>()
    const object = create(type, "YEXAMPLE", path, false, "YEXAMPLE", undefined, "", service)
    return { service, object }
  }

  test("reads XML from the object endpoint without a text source link", async () => {
    const { service, object } = setup()
    service.getObjectSource.mockResolvedValue(xml)

    expect(isAbapXml(object)).toBe(true)
    expect(object.fsName).toBe(`YEXAMPLE.${extension}.xml`)
    expect(object.canBeWritten).toBe(true)
    expect(await object.read()).toBe(xml)
    expect(service.getObjectSource).toHaveBeenCalledWith(path, undefined)
  })

  test("preserves the inactive version when reading", async () => {
    const { service, object } = setup()
    service.objectStructure.mockResolvedValue({
      objectUrl: path,
      metaData: mock<AbapObjectStructure["metaData"]>({ "adtcore:version": "inactive" }),
      links: []
    })
    await object.loadStructure()
    await object.read()
    expect(service.getObjectSource).toHaveBeenCalledWith(path, "inactive")
  })

  test("writes unchanged XML using the lock and transport, then invalidates metadata", async () => {
    const { service, object } = setup()
    await object.write(xml, "lock-handle", "transport-request")
    expect(service.setObjectSource).toHaveBeenCalledWith(
      path,
      xml,
      "lock-handle",
      "transport-request"
    )
    expect(service.invalidateStructCache).toHaveBeenCalledWith(path)
    expect(object.lockObject).toBe(object)
  })

  test("propagates a rejected save without invalidating metadata", async () => {
    const { service, object } = setup()
    const error = new Error("Save rejected")
    service.setObjectSource.mockRejectedValue(error)
    await expect(object.write(xml, "lock-handle", "transport-request")).rejects.toBe(error)
    expect(service.invalidateStructCache).not.toHaveBeenCalled()
  })
})
