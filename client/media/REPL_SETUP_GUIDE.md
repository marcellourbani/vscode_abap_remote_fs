# ABAP REPL — SAP-Side Setup Guide

> ⚠️ **Experimental Feature** — The ABAP REPL is experimental and may change or be removed in future versions. Use with caution.

> 🔒 **Production Systems Blocked** — The REPL intentionally refuses to execute on production SAP clients. This is a hardcoded security restriction. It is designed for development and test systems only.

## What You're Installing

One ABAP class (`ZCL_ABAP_REPL`) and one SICF service node (`Z_ABAP_REPL`). Nothing else. No database tables, no function modules, no config tables.

**Time to set up: 10 minutes.**

---

## Step 1: Create the Class

### Option A: Via SE24 (SAP GUI)

1. Open transaction **SE24**
2. Class name: **ZCL_ABAP_REPL**
3. Click **Create**
4. Description: `ABAP REPL - Remote Code Execution Service`
5. Package: **$TMP** (local, no transport) or your Z-package
6. Go to the **Interfaces** tab → Add: **IF_HTTP_EXTENSION**
7. Go to the **Source** tab (Source code-based view)
8. Delete all generated code
9. Paste the ENTIRE contents of [`ZCL_ABAP_REPL.abap`](ZCL_ABAP_REPL.abap)
10. **Activate** (Ctrl+F3)

### Option B: Via ABAP FS in VS Code

1. In Copilot chat: "Create a class ZCL_ABAP_REPL in $TMP with interface IF_HTTP_EXTENSION"
2. Open the created class
3. Replace all code with contents of `ZCL_ABAP_REPL.abap`
4. Save and activate (Alt+Shift+F3)

---

## Step 2: Create the SICF Service

1. Open transaction **SICF**
2. In the tree, navigate to: **default_host → sap → bc**
3. Right-click on **bc** → **Create Service**
4. Fill in:
   - **Name of Service Element:** `z_abap_repl`
   - **Description:** `ABAP REPL Service`
5. Go to the **Handler List** tab
6. In **Handler 1:** enter `ZCL_ABAP_REPL`
7. Click **Save** (assign to $TMP or your transport)
8. Back in the SICF tree, right-click on `z_abap_repl` → **Activate Service**

---

## Step 3: Verify

Open the REPL panel in VS Code (Command Palette → "Execute ABAP Code"). Select your SAP system and run a simple statement like `WRITE: / 'Hello'.`

If you get an error saying the REPL service is not available:
1. Go to SICF → search for `z_abap_repl`
2. Right-click → **Activate Service**
3. Try again

---

## Authorizations

The user needs:

| Auth Object | Field | Value | Why |
|------------|-------|-------|-----|
| **S_DEVELOP** | ACTVT | 03 | Developer access (generate subroutine pool) |
| **S_ICF** | ICF_VALUE | z_abap_repl | Access to the HTTP service |

The executed ABAP code runs under the user's own authorizations. The REPL cannot do anything the user couldn't do in SE38.

---

## Safety Features

1. **Production block:** Refuses to execute on production clients (T000-CCCATEGORY = 'P')
2. **Authorization check:** Requires S_DEVELOP before execution
3. **Audit logging:** Every execution is logged to the application log (SLG1, object ZREPL)
4. **No persistent artifacts:** No database objects are created. Temporary reports are deleted immediately after execution.
5. **User context:** Runs under the calling user's SAP role — same authorization scope as SE38

---

## Application Log Object (Optional)

If you want the audit log to work properly, create an application log object:

1. Transaction **SLG0**
2. Create object: **ZREPL**
3. Description: `ABAP REPL Execution Log`
4. Create sub-object: **EXEC**
5. Description: `Code Execution`

Without this, executions won't be logged. The REPL still works — you just don't get the audit trail.

---

## Removing the Service

1. **SICF:** Deactivate and delete `z_abap_repl` service node
2. **SE24:** Delete class `ZCL_ABAP_REPL`

Zero residue on the system.
