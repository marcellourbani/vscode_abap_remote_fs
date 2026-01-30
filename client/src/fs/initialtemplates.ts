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

This folder is a virtual filesystem used by the ABAP FS extension to allow editing code stored on a server.
CLI tools like grep, ls, find and others can't operate on these files.
Most standard search tools won't work either.
You're still able to read and write files normally, and to navigate the filesystem, but should do it sparingly as it's rather slow.

**CRITICAL** always use tool abap_search to search ABAP code, never use standard tools that operate on the filesystem, like grep, fileSearch or listDirectory in this folder.

The best way to find out if a class works correctly is running unit tests with tool abap_unit.

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
