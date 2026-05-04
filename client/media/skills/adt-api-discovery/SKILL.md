---
name: adt-api-discovery
description: >-
  Investigate SAP ADT REST API endpoints. Use when the user asks about ADT API endpoints,
  request/response XML formats, content types, or how a specific ADT feature works under the hood.
  Teaches how to trace from discovery documents → RES_APP classes → handler classes →
  Simple Transformations → XML schemas. Requires the adt_discovery_export tool output files
  and standard ABAP tools (get_abap_object_lines, search_abap_objects, search_abap_object_lines).
argument-hint: '[what ADT endpoint or feature to investigate]'
user-invocable: true
disable-model-invocation: false
---

# ADT API Discovery — Skill

You are investigating SAP ADT REST API endpoints. Your goal is to determine the full HTTP contract for any endpoint: URL, HTTP methods, request/response XML format, content types, and headers.

## Prerequisites

Before using this skill, run the `adt_discovery_export` tool with the target `connectionId`. This creates a folder with markdown files containing the raw discovery data. Read these files first.

## The ADT Architecture

Every ADT REST endpoint exists because of this chain:

```
SICF node: /sap/bc/adt
  └── Handler: CL_ADT_WB_RES_APP
        └── BAdI: BADI_ADT_REST_RFC_APPLICATION
              └── RES_APP class (inherits CL_ADT_DISC_RES_APP_BASE or CL_ADT_RES_APP_BASE)
                    └── register_resources() method
                          ├── registry->register_discoverable_resource(url, handler_class, ...)
                          ├── registry->register_resource(template, handler_class)
                          └── collection->register_disc_res_w_template(relation, template, handler_class)
                                └── Handler class (inherits CL_ADT_REST_RESOURCE)
                                      ├── GET/POST/PUT/DELETE method overrides
                                      ├── Content handler factory → get_handler_for_xml_using_st()
                                      └── response->set_body_data() / request->get_body_data()
```

## Step-by-Step Investigation Process

### Step 1: Find the endpoint in discovery

Search `workspaces.md` for the URL or keyword. This gives you the collection `href` and any template links (URL templates with parameters, relations, content types).

If the endpoint isn't in discovery, it may be a **hidden resource** — registered via `register_resource()` instead of `register_discoverable_resource()`. You'll find it in Step 2.

### Step 2: Find the RES_APP class

The RES_APP class is what registers the endpoint. To find which one:

**Option A — Match by URL pattern**: The discovery URL `/sap/bc/adt/oo/classes` is registered by a RES_APP whose `register_resources()` method contains that URL. Search for it:
```
Use search_abap_object_lines on RES_APP classes from res-app-classes.md, searching for the URL segment (e.g., '/oo/classes' or '/datapreview/')
```

**Option B — Check RES_APP class names**: The `res-app-classes.md` file lists all RES_APP classes with descriptions. Class names often hint at the feature area (e.g., `CL_ADT_DATAPREVIEW_RES_APP` → data preview, `CL_OO_ADT_RES_APP` → OO classes).

**Option C — Use `get_application_title()`**: Each RES_APP has a method `get_application_title()` that returns a title matching the discovery workspace title. Read the method source to match.

### Step 3: Read `register_resources()` to find the handler class

Use `get_abap_object_lines` to read the RES_APP class source. Look for three registration patterns:

```abap
" Pattern 1 — Discoverable resource (in /sap/bc/adt/discovery):
registry->register_discoverable_resource(
  url             = '/oo/classes'
  handler_class   = if_oo_adt_res_class_co=>co_class_name
  description     = 'Classes'
  category_scheme = ...
  category_term   = ...
  accepted_types  = ... ).

" Pattern 2 — Hidden resource (NOT in discovery):
registry->register_resource(
  template      = '/oo/classes/{classname}'
  handler_class = if_oo_adt_res_class_co=>co_class_name ).

" Pattern 3 — Template link on a collection:
classrun_col->register_disc_res_w_template(
  relation      = 'http://www.sap.com/adt/relations/oo/classrun'
  template      = '/oo/classrun/{classname}{?profilerId}'
  type          = if_rest_media_type=>gc_text_plain
  handler_class = if_oo_adt_res_classrun_co=>co_class_name ).
```

### Step 4: Resolve the handler class name

The `handler_class` parameter is almost always a **constant reference** like `if_oo_adt_res_class_co=>co_class_name`. You need to resolve it:

1. Identify the interface/class before `=>` (e.g., `IF_OO_ADT_RES_CLASS_CO`)
2. Read that interface's source with `get_abap_object_lines`
3. Find `CONSTANTS co_class_name TYPE ... VALUE 'CL_OO_ADT_RES_CLASS'`

**Naming convention**: Handler classes typically have a companion `*_CO` interface that holds all constants:
- `IF_OO_ADT_RES_CLASS_CO` → constants for `CL_OO_ADT_RES_CLASS`
- `IF_ADT_DATAPREVIEW_RES_CO` → constants for `CL_ADT_DATAPREVIEW_RES`

These contain: `co_class_name`, `co_accept_header_*`, `co_content_type_*`, `co_st_*`, `co_root_*`, `co_uri_*`

### Step 5: Determine HTTP methods

Read the handler class source. The base class `CL_ADT_REST_RESOURCE` defines GET/POST/PUT/DELETE methods that all raise `cx_adt_res_meth_not_supported` by default. A handler **overrides only the methods it supports**:

```abap
METHODS get  REDEFINITION.    " → GET is supported
METHODS post REDEFINITION.    " → POST is supported
" PUT and DELETE are NOT redefined → not supported
```

Search for `REDEFINITION` in the class definition section.

### Step 6: Find Simple Transformations (XML schema)

The handler class uses `CL_ADT_REST_CNT_HDL_FACTORY` to create content handlers from Simple Transformations. Search the handler source for:

```abap
cl_adt_rest_cnt_hdl_factory=>get_instance( )->get_handler_for_xml_using_st(
  st_name      = co_st_name           " → resolve to e.g. 'ST_DATA_PREVIEW'
  root_name    = co_root_name         " → resolve to e.g. 'DATA_PREVIEW_TABLE_DATA'
  content_type = if_xxx=>co_content_type_v1  " → resolve to MIME type
)
```

All three parameters typically need constant resolution (same process as Step 4 — read the `*_CO` interface).

### Step 7: Distinguish request vs response

Trace which content handler variable is used where:

```abap
" RESPONSE (output):
response->set_body_data(
  content_handler = lo_response_handler    " ← this handler's ST is the response format
  data            = ls_result ).

" REQUEST (input):
request->get_body_data(
  EXPORTING content_handler = lo_request_handler  " ← this handler's ST is the request format
  IMPORTING data = ls_request ).
```

- **GET requests**: Usually no request body. Only the response ST matters.
- **POST/PUT requests**: May have both request and response STs (sometimes different).

### Step 8: Read the Simple Transformation source

Use `get_abap_object_lines` with `objectType = 'XSLT'` to read the ST source:

```

### Step 9: Interpret the ST XML

Simple Transformations use `tt:` directives. Here's how to read them:

| ST Element | Meaning |
|-----------|---------|
| `<prefix:element>` | Actual XML element that appears in request/response |
| `<tt:value ref="$ref.FIELD"/>` | Data value placeholder — becomes the field value |
| `<tt:attribute name="attr" value-ref="$ref.FIELD"/>` | XML attribute with a data value |
| `<tt:loop ref="TABLE">` | Repeating element (array/table) |
| `<tt:cond s-check="not-initial(FIELD)">` | Optional/conditional element |
| `<tt:apply name="SubTemplate">` | Calls a named template within the same ST |
| `<tt:include name="OTHER_ST" template="xxx"/>` | Includes a template from another ST — read that ST too |
| `<tt:template name="xxx">` | Named template block |
| `<tt:template>` (unnamed) | Default/entry template |
| `<tt:root name="ROOT" type="..."/>` | Root data binding to ABAP structure |
| `xmlns:prefix="uri"` | Namespace declaration — include in output |

**Template call chain**: The unnamed (default) `<tt:template>` is the entry point. It calls named templates via `<tt:apply name="xxx">`. Follow the chain to build the full XML structure.

**Included STs**: `<tt:include name="ST_OTHER" template="xxx"/>` means you need to also read `ST_OTHER` with `get_abap_object_lines`.

## Content Type Convention

SAP ADT content types follow this pattern:
```
application/vnd.sap.adt.<domain>.<subtype>.v<N>+xml
```

Examples:
- `application/vnd.sap.adt.datapreview.table.v1+xml`
- `application/vnd.sap.adt.oo.classes.v4+xml`

**The version number matters** — wrong version → 406 Not Acceptable.

## Key Base Classes

| Class | Role |
|-------|------|
| `CL_ADT_RES_APP_BASE` | Root base for all RES_APP classes |
| `CL_ADT_DISC_RES_APP_BASE` | Extends above, adds discovery support. Most RES_APPs inherit from this |
| `CL_ADT_REST_RESOURCE` | Base for all handler classes |
| `CL_ADT_REST_CNT_HDL_FACTORY` | Factory that creates content handlers from Simple Transformations |

## Example: Full Investigation of Data Preview

1. Search `workspaces.md` for "data preview" → find workspace "Data Preview" with collections like `/sap/bc/adt/datapreview/ddic`, `/sap/bc/adt/datapreview/cds`
2. From `res-app-classes.md`, `CL_ADT_DATAPREVIEW_RES_APP` matches
3. Read its `register_resources()` → finds `handler_class = if_adt_datapreview_res_co=>co_class_name`
4. Read `IF_ADT_DATAPREVIEW_RES_CO` → `co_class_name = 'CL_ADT_DATAPREVIEW_RES'`
5. Read `CL_ADT_DATAPREVIEW_RES` → `METHODS get REDEFINITION. METHODS post REDEFINITION.` → supports GET, POST
6. Find `get_handler_for_xml_using_st(st_name = co_st_name ...)` → resolve `co_st_name` from the `*_CO` interface → `'ST_DATA_PREVIEW'`
7. Read `ST_DATA_PREVIEW` with `objectType='XSLT'` → the XML structure with `dataPreview:tableData`, `dataPreview:totalRows`, etc.

## Tips

- **Search broadly first**: Use `search_abap_object_lines` with wildcards on multiple RES_APP classes when unsure which one registers your endpoint
- **Read the `*_CO` interface early**: It usually contains ALL constants for the handler — class name, content types, ST names, root names, URI segments
- **Check for composite content handlers**: Some handlers use `CL_ADT_REST_COMP_CNT_HANDLER` to support multiple content types/versions. Look for `add_handler()` calls
- **Hidden endpoints are common**: Many endpoints are registered with `register_resource()` and don't appear in discovery. Check the RES_APP source directly
