interface Template {
  name: string
  content: string
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

const agentsMD = `# ⚠️ CRITICAL: ABAP VIRTUAL FILESYSTEM

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

export const templates: Template[] = [
  {
    name: "AGENTS.md",
    content: agentsMD
  },
  {
    name: "abaplint.jsonc",
    content: abaplint
  }
]
