interface Template {
  name: string
  content: string
  previousContents?: string[]
}

const abaplint = `{
  "global": { },
  "dependencies": [ ],
  "syntax": {
    "version": "v750",
    "errorNamespace": "^(Z|Y|LCL_|TY_|LIF_)",
  },
  "rules": {
    "begin_end_names": true,
    "line_length": {
      "length": 255
    },
    "keyword_case": false,
    "in_statement_indentation": true,
    "check_ddic": true,
    "indentation": true,
    "check_include": true,
    "check_syntax": true,
    "global_class": true,
    "implement_methods": true,
    "method_implemented_twice": true,
    "parser_error": true,
    "superclass_final": true,
    "unknown_types": true,
    "xml_consistency": true
  }
}`

const previousAgentsMD = `# ⚠️ CRITICAL: ABAP VIRTUAL FILESYSTEM

This folder is a virtual filesystem (\`adt://\` scheme). Files are NOT on the local disk.

### 🚫 FORBIDDEN TOOLS (WILL FAIL)

- Terminal commands: \`ls\`, \`find\`, \`grep\`, \`cat\`, \`rm\`, \`mv\`, \`cp\`, \`touch\`.
- Native search tools: \`file_search\`, \`grep_search\`, \`list_dir\`.

### ✅ ALLOWED TOOLS

- File operations: \`read_file\`, \`create_file\`, \`replace_string_in_file\`.
- ABAP-specific tools: \`search_abap_objects\`, \`abap_activate\`, \`abap_unit\`.

**CRITICAL** always use \`search_abap_objects\` to search ABAP code. Never use standard tools that operate on the filesystem.

The best way to find out if a class works correctly is running unit tests with tool \`abap_unit\`.

**CRITICAL** files need to be locked before they get saved. Always wait a second between modifying a file and saving it.

**CRITICAL** file changes are only relevant once activated. Always activate files after writing them.
Note that you might have to modify several includes before you can activate them.

`

const agentsMD = `# CRITICAL: ABAP Virtual Filesystem

This folder uses the \`adt://\` scheme and represents live SAP objects, not local disk files.

## Tool Routing

- Inside \`adt://\`, terminal commands and native filesystem search tools such as \`file_search\`, \`grep_search\`, and \`list_dir\` will fail. They remain valid for local workspace folders.
- Use ABAP tools for SAP content: \`abapfs_search_objects\`, \`abapfs_search_object_source\`, \`abapfs_get_object_source\`, and \`abapfs_get_object_info\`.
- Use \`abapfs_activate_object\`, \`abapfs_run_atc_analysis\`, and \`abapfs_run_unit_tests\` to validate activated SAP source. ATC does not validate local edits.

## Reuse Source Already in Context

- Do not fetch unchanged source repeatedly. Reuse source already present in the conversation because redundant SAP requests are slow and consume context.
- Standard SAP objects rarely change. Treat previously fetched lines as current unless there is evidence otherwise. Request only missing ranges, such as lines 200-300 when lines 1-100 are already available.
- Apply the same rule to custom objects while they are unchanged. Refresh only the relevant lines when the object was changed, activated, or may have changed outside the conversation.

## Editing and SAP State

- After editing ABAP source, check VS Code Problems and fix local syntax errors before activation. Use this order: edit -> Problems -> activate -> verify SAP source -> ATC/tests.
- A local edit is not proof that SAP received it. Save synchronization can be delayed or blocked by locks, disabled auto-save, connection failures, or other causes.
- If SAP does not reflect an edit, do not guess the cause or repeat the edit automatically. Report the mismatch and let the user resolve the save/synchronization state.
- Changes matter in SAP only after successful activation. Related includes may need to be saved and activated before the parent object can activate.
- After saving edits and receiving a successful activation result, verify that the changes reached SAP. Query only the changed range with \`abapfs_get_object_source\`, or use \`abapfs_search_object_source\` with a distinctive token from the edit. Avoid reloading unchanged lines. For multiple edits, finish editing and activation before performing one final targeted verification.
- Verification matters because activation applies whichever source SAP currently has. If local changes did not synchronize because of a delay, disabled auto-save, a network problem, or a lock failure, SAP may activate its previous version and still report success.
- Trust tool results precisely: report save, activation, ATC, and test failures without claiming success or inventing a cause.

## Investigation and Changes

- Requests to investigate, analyze, trace, or explain ask for findings, not implementation. Report evidence, root cause, impact, and options without changing SAP objects.
- Edit only when the user explicitly requests or approves changes, or established session context makes that intent unambiguous. SAP objects are live enterprise assets, not disposable prototypes.

## Confirm Authority for State-Changing Actions

- Before creating, editing, deleting, activating, transporting, or running potentially disruptive operations, ensure the user's request authorizes that action.
- Do not infer write authorization from read access or from the technical ability to invoke a tool.
- When authorization or intent is uncertain, present the proposed action and ask for approval. Preserving intent and authorization is more important than acting quickly.

## Respect System and Client Boundaries

- Confirm the target SAP system and client before state-changing work. Multiple connected systems make accidental changes easy.
- Distinguish development, quality, and production systems. Avoid changes or write-oriented tests in production unless explicitly authorized.
- Do not assume data, configuration, transports, or code are identical across systems.

## Choose the Right Test

- Determine whether "test" means ABAP Unit, ATC, SAP GUI workflow testing, integration testing, regression testing, or test documentation. Ask a concise question when the intended test is unclear because these validate different things.
- For SAP GUI testing with the ABAP FS UI testing framework, check whether testing is configured. If not, use \`abapfs_setup_sap_testing\` and follow its instructions. If this tool is available to you, it likely means the test framework is not enabled.
- Do not claim a fix works merely because activation succeeds. Use the test type appropriate to the requested behavior.

## Protect SAP Objects

- Never modify standard SAP code unless the user explicitly instructs you to do so. Report suspected standard defects with evidence and prefer SAP Notes, support incidents, BAdIs, enhancement points, or custom wrappers.
- Treat objects outside known customer namespaces as standard unless metadata proves otherwise. Do not invent ownership, packages, transports, authorization, or system details.

## Prefer Supported Extension Mechanisms

- Before proposing a modification, determine whether the requirement belongs in custom code, configuration, an enhancement, a BAdI, a user exit, a CDS extension, or another supported mechanism.
- Avoid recommending modifications to generated objects or framework-owned includes when an owning extension point exists.
- Explain why the selected extension mechanism is safer for upgrades and maintenance.

## Report Evidence, Not Confidence

- Clearly separate observed facts, reasonable interpretations, and unresolved assumptions.
- Identify the object, method or include, relevant source area, and tool result behind each important finding.
- Do not claim that a bug is fixed until the changed source is activated, verified in SAP, and validated at the appropriate test level.

`

export const templates: Template[] = [
  {
    name: "AGENTS.md",
    content: agentsMD,
    previousContents: [previousAgentsMD]
  },
  {
    name: "abaplint.jsonc",
    content: abaplint
  }
]
