# ABAP Debugger "invalidDebuggee" — Investigation Handover

## The Problem

The VS Code ABAP debugger **intermittently fails** when attaching to a breakpoint. The error is:

```
CX_ABDBG_ACTEXT_CANNOT_ATTACH / invalidDebuggee
```

Success rate is approximately **75–87%** depending on the run. Failures appear random — same code, same breakpoints, same program, same timing.

## The SAP-Side Code That Fails

The exception comes from `CL_ABDBG_ACT_FOR_ATTACH__USER=CM009`. The relevant method:

```abap
method IF_ABDBG_ACT_FOR_ATTACH~ATTACH.
  data abdbg_activation_wa type abdbg_activation.
  data dbgkey              type x length 1024.
  data dbgkeylen           type i.

  select single * into abdbg_activation_wa from abdbg_activation where debuggee_id = debuggee.
  if sy-subrc <> 0.
    raise exception type cx_abdbg_actext_cannot_attach.  " LINE 9
  endif.
  dbgkey    = abdbg_activation_wa-dbgkey.
  dbgkeylen = xstrlen( abdbg_activation_wa-dbgkey ).

  delete from abdbg_activation where debuggee_id = abdbg_activation_wa-debuggee_id.
  call function 'DB_COMMIT'.

  call 'TPDA_ATTACH'
    id 'KIND'           field 'ATTACH'
    id 'DEBUG_KEY'      field dbgkey
    id 'DEBUG_KEY_LN'   field dbgkeylen.
  if sy-subrc <> 0.
    raise exception type cx_abdbg_actext_cannot_attach.  " LINE 24
  endif.

  " ... check attach loop ...
endmethod.
```

The conflict-notification code that writes to ABDBG_ACTIVATION:

```abap
method if_abdbg_act_for_attach~notify_remote_listener.
  " ...
  insert abdbg_activation from _act_wa.
  call function 'DB_COMMIT'.
  " notify listener
  try.
    l_actref->stop_listener( ).
  catch cx_abdbg_actext_lis_notstarted.
    delete from abdbg_activation where debuggee_id = _act_wa-debuggee_id.
    call function 'DB_COMMIT'.
    raise exception type cx_abdbg_actext_lis_stopping.
  endtry.
endmethod.
```

## Error Line Observations

- **Line 9 failures**: The `ABDBG_ACTIVATION` row does NOT exist when attach tries to SELECT it. Seen when attach is delayed (retries with sleep made it worse — row gets cleaned up during the delay).
- **Line 24 failures**: The row IS found and deleted, but the kernel `TPDA_ATTACH` call fails. This means the ABAP process is no longer in a "waiting for debugger" state. This is the **most common failure** in recent tests.

## The VS Code Extension Flow

### Listen → Attach Sequence

1. `debuggerListen()` — long-poll POST to `/sap/bc/adt/debugger/listeners` (100h timeout). Returns a `Debuggee` object with `DEBUGGEE_ID` when a breakpoint is hit.
2. `DebugService.create()` — creates a **new ADTClient** via `newClientFromKey()`. This is a completely independent HTTP client with its own cookies/session/CSRF token.
3. `client.adtCoreDiscovery()` — authenticates the new client (fetches CSRF token, establishes session). Takes ~960ms.
4. `client.debuggerAttach()` — POST to `/sap/bc/adt/debugger?method=attach&debuggeeId=XXX`. Takes ~480ms.

**Total time from breakpoint to attach: ~1450ms**

### Key Architecture Detail

- The **listener** uses `this.client.statelessClone` (a cached clone of the main workspace client).
- The **attach** uses a brand new client from `newClientFromKey()` — completely separate HTTP instance, separate cookies, separate SAP session.
- The `statelessClone` in `abap-adt-api` creates a new `ADTClient` which creates a new `AdtHTTP` which has its own `cookie = new Map()`. There is NO cookie/session sharing between any two client instances.

### Key Files

- `client/src/adt/debugger/debugListener.ts` — main loop, listen, cleanup
- `client/src/adt/debugger/debugService.ts` — create client, attach, stack
- `client/src/adt/debugger/breakpointManager.ts` — breakpoint registration
- `client/src/adt/debugger/functions.ts` — `newClientFromKey()` creates fresh clients
- `client/src/adt/conections.ts` — `getOrCreateClient()` / `getClient()` — client pool
- `client/node_modules/abap-adt-api/build/api/debugger.js` — HTTP API calls
- `client/node_modules/abap-adt-api/build/AdtHTTP.js` — HTTP client with cookie jar
- `client/node_modules/abap-adt-api/build/AdtClient.js` — `statelessClone`, `stateful` setter

## Changes Already Made (in current working tree)

### Fix 1: `debuggerListen()` made async (KEEP)
The original `debuggerListen()` was a non-async function that returned a Promise directly. The `finally` block set `this.listening = false` synchronously when the Promise was CREATED, not when it resolved. This meant `this.listening` was always `false`. Changed to `async` with `return await` so the flag stays `true` during the HTTP call.

### Fix 2: `await this.onBreakpointReached(debuggee)` (KEEP)
The original `mainLoop` called `this.onBreakpointReached(debuggee)` without `await`. This meant the loop immediately continued and called `debuggerListen()` again while the previous debuggee was still being attached. The second listen could interfere with the first attach. Now awaited.

### Fix 3: `logout()` always calls `stopListener()` (KEEP)
Previously, `logout()` checked `if (this.listening)` to decide whether to call `stopListener()`. But due to Fix 1's original bug, `listening` was always `false`, so `stopListener()` was often skipped. The old listener remained registered on SAP. Now `stopListener()` is called unconditionally.

### Fix 4: Replaced all `.catch(ignore)` with logging (KEEP)
All silently-swallowed exceptions in debugger code now log the error details. This revealed that `stepContinue` failures during cleanup produce `debuggeeEnded` (harmless — program finished) or `noSessionAttached` (after a failed attach).

### Fix 5: `stopThread` robust cleanup (KEEP)
`stepContinue` in `stopThread` now has a try/catch with detailed error logging and a `dropSession()` fallback if the error is NOT `debuggeeEnded`.

## Changes That Were Tried and REVERTED

### Attempt: Skip adtCoreDiscovery (REVERTED)
Moved `adtCoreDiscovery()` to after `debuggerAttach()` to reduce latency. Did NOT fix the issue — without discovery, the attach is the first HTTP call and needs an extra round-trip for CSRF token, taking the same total time.

### Attempt: adtCoreDiscovery before setting stateful (REVERTED)
Set `client.stateful = session_types.stateful` AFTER `adtCoreDiscovery()` so the login happens stateless. Theory was that a premature stateful session could cause SAP to release the debuggee. Did NOT fix the issue — failure rate stayed the same.

### Attempt: Pre-warm client while waiting for breakpoint (REVERTED)
Created and authenticated a client in the background while `debuggerListen()` was waiting. When breakpoint hit, the pre-warmed client was used immediately (0ms login time). Did NOT fix the issue — failures still occurred even with ~0ms between breakpoint and attach.

### Attempt: Retry with backoff on invalidDebuggee (REVERTED)
Added retry logic (3 attempts, 500ms/1000ms delays) when attach failed with `invalidDebuggee`. Made things WORSE — the delays gave SAP time to clean up the `ABDBG_ACTIVATION` row, changing failures from line 24 (row found, kernel reject) to line 9 (row gone).

### Attempt: Filter DBGEE_KIND in debuggerListen response (REVERTED)
Checked `DBGEE_KIND` field on the Debuggee returned by `debuggerListen()` and filtered out non-`DEBUGGEE` kinds as listener errors. Did NOT fix the issue — the debuggee objects all had normal DEBUGGEE kind.

## Observations and Clues

1. **Timing is identical between success and failure** — both take ~1450ms from breakpoint to attach HTTP call, ~480ms for the attach call itself. The issue is NOT client-side speed.

2. **Pre-warming the client (0ms login) still fails** — eliminating the ~960ms login delay did not fix the problem. The attach HTTP call itself (~480ms) sometimes fails and sometimes succeeds.

3. **Line 24 failure** means the `ABDBG_ACTIVATION` row exists and is found, but the kernel `TPDA_ATTACH` call rejects the attach. The ABAP process is no longer waiting.

4. **The failure is on SAP's side** — identical requests sometimes succeed and sometimes fail. The variability is in the SAP app server, not in the client code.

5. **Different HTTP sessions between listen and attach** — the listener and the attach client have completely separate SAP sessions (different cookies, different `SAP_SESSIONID`). It is NOT known whether SAP requires the same session for listen and attach. The `debuggerAttach` API only takes `debuggeeId`, `debuggingMode`, and `requestUser` as parameters — no `terminalId` or `ideId`.

6. **Breakpoints in INITIALIZATION section of main report** trigger only intermittently. Breakpoints in includes are more reliable. Both use `"external"` scope.

7. **Breakpoint scope**: Breakpoints are registered with scope `"external"` (before attach). Phase 2 with scope `"debugger"` only runs for conditional breakpoints or when active services exist.

## Unexplored Theories

- **Session affinity**: Maybe SAP requires the attach to come from the same HTTP session as the listen. The current code always uses different sessions. Could try using the listener's client directly for attach (but it's stateless and may not support stateful debug operations).

- **SAP work process race**: The ABAP process hits a breakpoint on work process A. The `debuggerListen` returns on work process B. The `debuggerAttach` arrives on work process C. Work process C tries to attach to the debuggee but the ABAP process on work process A has already timed out or continued.

- **SAP debugger timeout**: There may be a very short SAP-side timeout for how long the ABAP process will wait in breakpoint state before continuing. This timeout may be configurable (SAP profile parameters?).

- **ICM/load balancer**: If SAP uses multiple app servers or an ICM dispatcher, the attach request might land on a different app server than where the debuggee process is waiting. The `TPDA_ATTACH` kernel call is work-process-local.

- **Shared memory / enqueue**: The `ABDBG_ACTIVATION` table is a shared DB table, but `TPDA_ATTACH` works at the kernel level (shared memory). There may be a timing issue between the DB commit being visible and the kernel state being ready.

## Test Environment

- SAP system: GED100
- Connection: ged100
- User mode debugging (not terminal mode)
- Programs tested: reports with includes
- Platform: Windows
