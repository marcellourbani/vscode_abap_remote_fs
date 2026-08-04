/**
 * SapArtifacts — verify things SAP produces OUTSIDE the immediate UI response, for
 * the specific cases where there is genuinely no reliable way to check via SQL
 * afterward (an application-server file, rendered spool content).
 *
 * REMOVED 2026-07-21: waitForJobToFinish, readJobStatus, captureJobLog,
 * verifyIDocsCreated, verifyTableRow. All five verified DB-backed state (job status
 * lives in TBTCO/TBTCP, IDocs in EDIDC, arbitrary table rows are just... the table)
 * by navigating a standard transaction's UI and regex-parsing rendered text — slow,
 * unverified against a real system, and strictly worse than just running the SQL
 * directly. The "Post-test SQL verification" feature (see `analyze-and-plan` and
 * `run-scripts` skills — the AI runs SQL itself via the ABAP MCP tools, after
 * `playwright_test` reports a UI-level pass) replaces all five of these more
 * reliably. The corresponding skill sections describing background-artifact test
 * cases (jobs, IDocs, table rows) need updating to point at that instead of these
 * methods — not yet done, tracked as follow-up work, not silently forgotten.
 *
 * What's left below (AL11 file presence, spool content) has no SQL equivalent —
 * a file on the application server's filesystem and rendered spool output aren't
 * simple table rows — so UI navigation is still the only option for those two.
 */
import { SapSession } from "./sap-session"

export class SapArtifacts {
  constructor(private sap: SapSession) {}

  // ---------- AL11 application-server files ----------

  async verifyAL11FilePresent(fullPath: string): Promise<boolean> {
    await this.sap.openTx("AL11")
    // AL11 shows a tree of logical directories; navigating deterministically to a full
    // path is fragile. Compromise: use CG3Y (download file) which fails if the file is missing.
    await this.sap.openTx("CG3Y")
    await this.sap.setField("Source file on Application Server", fullPath)
    // Set a temp local target — CG3Y will complain if source missing before it opens the save dialog.
    await this.sap.setField("Target file on Presentation Server", `C:\\Temp\\_probe.tmp`)
    try {
      await this.sap.execute()
      // If a "file does not exist" alert appears, the assertion has failed.
      const body = await this.sap.raw().locator("body").innerText()
      if (/does not exist|not found/i.test(body)) {
        throw new Error(`AL11 file not found: ${fullPath}`)
      }
      await this.sap.note(`AL11 file present: ${fullPath}`)
      return true
    } catch (e) {
      throw new Error(`AL11 file check failed for ${fullPath}: ${(e as Error).message}`)
    }
  }

  // ---------- Spool (SP01) ----------

  async captureLatestSpoolForUser(user: string): Promise<string> {
    await this.sap.openTx("SP01")
    await this.sap.setField("Created by", user)
    await this.sap.execute()
    await this.sap.selectGridRowByText(user)
    await this.sap.clickButton(/^Display/i)
    const text = await this.sap.raw().locator("body").innerText()
    await this.sap.note("Captured latest spool")
    return text
  }
}
