import {
  adtObjectUri,
  hasOtherInactiveIncludes,
  inactiveProgramUnit,
  inactiveSiblings,
  sameAdtUri
} from "./relatedInactive"

const record = (name: string, type: string, uri: string, parentUri = "") => ({
  object: {
    "adtcore:name": name,
    "adtcore:type": type,
    "adtcore:uri": uri,
    "adtcore:parentUri": parentUri,
    user: "",
    deleted: false
  }
})

const programUri = "/sap/bc/adt/programs/programs/ztest"
const includeUri = "/sap/bc/adt/programs/includes/ztest_i01"
const otherIncludeUri = "/sap/bc/adt/programs/includes/ztest_f01"

describe("sameAdtUri", () => {
  it("ignores source suffix, include context, fragments and case", () => {
    expect(sameAdtUri(`${includeUri}/source/main?context=%2fsap`, includeUri)).toBe(true)
    expect(sameAdtUri(`${includeUri}#start=1,1`, includeUri.toUpperCase())).toBe(true)
    expect(
      sameAdtUri("/sap/bc/adt/oo/classes/%2Fabc%2Fcl_x", "/sap/bc/adt/oo/classes/%2fabc%2fcl_x")
    ).toBe(true)
  })

  it("keeps different objects apart", () => {
    expect(sameAdtUri(includeUri, otherIncludeUri)).toBe(false)
    expect(
      sameAdtUri("/sap/bc/adt/oo/classes/zcl/includes/testclasses", "/sap/bc/adt/oo/classes/zcl")
    ).toBe(false)
    expect(sameAdtUri(undefined, includeUri)).toBe(false)
  })

  it("keeps the original case for cache keys", () => {
    expect(adtObjectUri("/sap/bc/adt/oo/classes/%2Fabc%2Fcl_x/source/main")).toBe(
      "/sap/bc/adt/oo/classes/%2Fabc%2Fcl_x"
    )
  })
})

describe("inactiveProgramUnit", () => {
  it("collects main program, current include and other includes once each", () => {
    const main = record("ZTEST", "PROG/P", programUri)
    const include = record("ZTEST_I01", "PROG/I", includeUri)
    const other = record("ZTEST_F01", "PROG/I", otherIncludeUri)
    const unrelated = record("ZOTHER", "PROG/I", "/sap/bc/adt/programs/includes/zother")

    const unit = inactiveProgramUnit(
      [unrelated, other, include, main],
      programUri,
      [`${otherIncludeUri}/source/main`, includeUri],
      includeUri
    )

    expect(unit).toEqual([main, include, other])
  })

  it("is empty when no part of the program is inactive", () => {
    expect(inactiveProgramUnit([record("ZX", "PROG/P", "/x")], programUri, [includeUri])).toEqual(
      []
    )
  })
})

describe("inactiveSiblings", () => {
  const classUri = "/sap/bc/adt/oo/classes/zcl"
  const testclasses = record("ZCL", "CLAS/I", `${classUri}/includes/testclasses`, classUri)
  const implementations = record("ZCL", "CLAS/I", `${classUri}/includes/implementations`, classUri)
  const unrelated = record("ZCL2", "CLAS/OC", "/sap/bc/adt/oo/classes/zcl2", "/other")

  it("returns the inactive parts sharing the parent", () => {
    expect(
      inactiveSiblings(
        [testclasses, unrelated, implementations],
        `${classUri}/includes/testclasses`
      )
    ).toEqual([testclasses, implementations])
  })

  it("is empty without a parent or with a single inactive object", () => {
    expect(inactiveSiblings([testclasses], `${classUri}/includes/testclasses`)).toEqual([])
    expect(inactiveSiblings([record("ZCL", "CLAS/OC", classUri), unrelated], classUri)).toEqual([])
  })
})

describe("hasOtherInactiveIncludes", () => {
  it("ignores the current include", () => {
    const include = record("ZTEST_I01", "PROG/I", includeUri)
    expect(hasOtherInactiveIncludes([include], includeUri)).toBe(false)
    expect(hasOtherInactiveIncludes([include])).toBe(true)
  })
})
