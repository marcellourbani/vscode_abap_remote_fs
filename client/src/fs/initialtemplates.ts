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

const agentsMD = `# AGENTS.md

This folder is a virtual filesystem used by the ABAP Remote FS extension to allow editing code stored on a server.
CLI tools like grep, find and others can't operate on these files, so this will break any standard search tool.

**CRITICAL** always use tool abap_search to search ABAP code, never use standard tools that operate on the filesystem.`

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
