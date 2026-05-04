import { AbapFsCommands } from "./registry"

describe("AbapFsCommands", () => {
  test("all command keys have string values", () => {
    for (const [key, value] of Object.entries(AbapFsCommands)) {
      expect(typeof value).toBe("string")
      expect(value.length).toBeGreaterThan(0)
    }
  })

  test("all command values start with abapfs.", () => {
    for (const value of Object.values(AbapFsCommands)) {
      expect(value).toMatch(/^abapfs[.:]/)
    }
  })

  test("core commands have correct values", () => {
    expect(AbapFsCommands.connect).toBe("abapfs.connect")
    expect(AbapFsCommands.disconnect).toBe("abapfs.disconnect")
    expect(AbapFsCommands.activate).toBe("abapfs.activate")
    expect(AbapFsCommands.search).toBe("abapfs.search")
    expect(AbapFsCommands.create).toBe("abapfs.create")
    expect(AbapFsCommands.execute).toBe("abapfs.execute")
    expect(AbapFsCommands.unittest).toBe("abapfs.unittest")
  })

  test("GUI commands have correct values", () => {
    expect(AbapFsCommands.runInGui).toBe("abapfs.runInGui")
    expect(AbapFsCommands.runInEmbeddedGui).toBe("abapfs.runInEmbeddedGui")
    expect(AbapFsCommands.runTransaction).toBe("abapfs.runTransaction")
  })

  test("ATC commands have correct values", () => {
    expect(AbapFsCommands.atcChecks).toBe("abapfs.atcChecks")
    expect(AbapFsCommands.atcIgnore).toBe("abapfs.atcIgnore")
    expect(AbapFsCommands.atcRefresh).toBe("abapfs.atcRefresh")
    expect(AbapFsCommands.atcRequestExemption).toBe("abapfs.atcRequestExemption")
    expect(AbapFsCommands.atcRequestExemptionAll).toBe("abapfs.atcRequestExemptionAll")
    expect(AbapFsCommands.atcAutoRefreshOn).toBe("abapfs.atcAutoRefreshOn")
    expect(AbapFsCommands.atcAutoRefreshOff).toBe("abapfs.atcAutoRefreshOff")
  })

  test("transport commands have correct values", () => {
    expect(AbapFsCommands.releaseTransport).toBe("abapfs.releaseTransport")
    expect(AbapFsCommands.deleteTransport).toBe("abapfs.deleteTransport")
    expect(AbapFsCommands.refreshtransports).toBe("abapfs.refreshtransports")
    expect(AbapFsCommands.transportObjectDiff).toBe("abapfs.transportObjectDiff")
    expect(AbapFsCommands.openTransportObject).toBe("abapfs.openTransportObject")
  })

  test("abapgit commands have correct values", () => {
    expect(AbapFsCommands.agitRefreshRepos).toBe("abapfs.refreshrepos")
    expect(AbapFsCommands.agitPull).toBe("abapfs.pullRepo")
    expect(AbapFsCommands.agitCreate).toBe("abapfs.createRepo")
    expect(AbapFsCommands.agitPush).toBe("abapfs.pushAbapGit")
  })

  test("feed commands have correct values", () => {
    expect(AbapFsCommands.configureFeeds).toBe("abapfs.configureFeeds")
    expect(AbapFsCommands.refreshFeedInbox).toBe("abapfs.refreshFeedInbox")
    expect(AbapFsCommands.viewFeedEntry).toBe("abapfs.viewFeedEntry")
    expect(AbapFsCommands.markAllFeedsRead).toBe("abapfs.markAllFeedsRead")
    expect(AbapFsCommands.markFeedFolderRead).toBe("abapfs.markFeedFolderRead")
    expect(AbapFsCommands.deleteFeedEntry).toBe("abapfs.deleteFeedEntry")
    expect(AbapFsCommands.clearFeedFolder).toBe("abapfs.clearFeedFolder")
    expect(AbapFsCommands.showFeedInbox).toBe("abapfs.showFeedInbox")
  })

  test("blame commands have correct values", () => {
    expect(AbapFsCommands.showBlame).toBe("abapfs.showBlame")
    expect(AbapFsCommands.hideBlame).toBe("abapfs.hideBlame")
  })

  test("text elements command has correct value", () => {
    expect(AbapFsCommands.manageTextElements).toBe("abapfs.manageTextElements")
  })

  test("revision commands have correct values", () => {
    expect(AbapFsCommands.opendiff).toBe("abapfs.opendiff")
    expect(AbapFsCommands.opendiffNormalized).toBe("abapfs.opendiffNormalized")
    expect(AbapFsCommands.openrevstate).toBe("abapfs.openrevstate")
    expect(AbapFsCommands.remotediff).toBe("abapfs.remotediff")
    expect(AbapFsCommands.comparediff).toBe("abapfs.comparediff")
  })

  test("all command ids are unique", () => {
    const values = Object.values(AbapFsCommands)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  test("cleaner commands have correct values", () => {
    expect(AbapFsCommands.cleanCode).toBe("abapfs.cleanCode")
    expect(AbapFsCommands.setupCleaner).toBe("abapfs.setupCleaner")
  })

  test("changeInclude uses colon separator", () => {
    expect(AbapFsCommands.changeInclude).toBe("abapfs:changeInclude")
  })
})
