import { cleanDocuTree, docuTopicId, parseDocuHtml, serializeDocu, textOf } from "./docuHtml"
import { readDocuPage, retainsContent } from "./docuMarkdown"
import {
  HITS_HTML,
  INVALID_TOPIC_HTML,
  LEGACY_GERMAN_HITS_HTML,
  LEGACY_HITS_HTML,
  NO_RESULTS_HTML,
  SINGLE_HIT_HTML,
  TOPIC_HTML
} from "./docuFixtures"

const topic = () => {
  const page = readDocuPage(TOPIC_HTML, "demo_topic")
  if (page.kind !== "topic") throw new Error(`unexpected page kind ${page.kind}`)
  return page
}

describe("parseDocuHtml", () => {
  test("recovers from unclosed list items, cells and paragraphs", () => {
    const root = parseDocuHtml(
      "<ul><li>one<li>two</ul><table><tr><td>a<td>b<tr><td>c</table><p>x<p>y"
    )
    const html = serializeDocu(root)
    expect(html).toBe(
      "<ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table><p>x</p><p>y</p>"
    )
  })

  test("handles uppercase tags, unquoted attributes and entities in attributes", () => {
    const root = parseDocuHtml(
      `<A HREF="adtcom:/x?a=1&amp;object=demo_id" CLASS=blue>Go &amp; see</A>`
    )
    const anchor = root.children[0]
    expect(anchor).toMatchObject({ tag: "a", attrs: { class: "blue" } })
    expect(docuTopicId((anchor as any).attrs.href)).toBe("DEMO_ID")
    expect(textOf(root).trim()).toBe("Go & see")
  })

  test("keeps script content raw and skips comments", () => {
    const root = parseDocuHtml(`<script>if (a < b) x = "</p>"</script><!-- hidden --><p>shown</p>`)
    expect(serializeDocu(root)).toBe(`<script>if (a &lt; b) x = "&lt;/p&gt;"</script><p>shown</p>`)
  })

  test("ignores stray closing tags", () => {
    expect(serializeDocu(parseDocuHtml("a</span>b</div>c"))).toBe("abc")
  })
})

describe("cleanDocuTree", () => {
  test("removes styles, scripts, images, navigation, feedback links and empty anchors", () => {
    const root = parseDocuHtml(TOPIC_HTML)
    cleanDocuTree(root)
    const html = serializeDocu(root)
    expect(html).not.toMatch(/<style|<script|<img|mailto:|Mail Feedback|data:image|@@DEMO@@/)
    expect(html).not.toContain("sap.example.com")
    expect(html).toContain("Standard ABAP")
  })
})

describe("docuTopicId", () => {
  test("reads the object parameter of adtcom links only", () => {
    expect(docuTopicId("adtcom:/sap/bc/adt/docu/abap/langu?object=demo_x&version=X")).toBe("DEMO_X")
    expect(
      docuTopicId("adtcom:/sap/bc/adt/docu/abap/langu?sap-language=EN&&object=&version=X")
    ).toBe(undefined)
    expect(docuTopicId("https://sap.example.com/docu?object=demo_x")).toBe(undefined)
    expect(docuTopicId(undefined)).toBe(undefined)
  })
})

describe("readDocuPage topic", () => {
  test("renders headings by class", () => {
    const { markdown } = topic()
    expect(markdown).toContain("# DEMO, Demo Operator")
    expect(markdown).toContain("## Syntax")
    expect(markdown).toContain("#### Effect")
  })

  test("renders syntax blocks as code with literal brackets and indentation", () => {
    expect(topic().markdown).toContain(
      "```\n... DEMO type( [let_exp]\n    WHEN log_exp THEN result ) ...\n```"
    )
  })

  test("keeps block elements inside syntax blocks on separate lines", () => {
    const html =
      `<span class="path">Demo</span><pre class="syntax"><div class="keyblock"><h2>Demo Lines</h2>` +
      `<p>1. <code>DEMO itab.</code>&nbsp;<br/><code>&nbsp;&nbsp;END.</code></p></div>` +
      `<div class="keyblock"><h2>Demo Groups</h2><p>2. <code>DEMO GROUP.</code></p></div></pre>`
    const page = readDocuPage(html, "DEMO_TOPIC")
    expect(page).toMatchObject({ kind: "topic", complete: true })
    expect(page.kind === "topic" && page.markdown).toContain(
      "```\nDemo Lines\n\n1. DEMO itab.\n  END.\n\nDemo Groups\n\n2. DEMO GROUP.\n```"
    )
  })

  test("renders inline code, bold text and nested lists", () => {
    const { markdown } = topic()
    expect(markdown).toContain("A demo expression with `DEMO` has a **result**.")
    expect(markdown).toContain("- First point.\n  - Nested point.\n- Second point")
  })

  test("renders tables with the first row as header and escaped pipes", () => {
    expect(topic().markdown).toContain(
      "| `sy-subrc` | **Meaning** |\n| --- | --- |\n| 0 | Value a\\|b found. |"
    )
  })

  test("keeps the breadcrumb text and drops page chrome", () => {
    const { markdown } = topic()
    expect(markdown).toContain("Demo - Help > Demo Parent >")
    expect(markdown).not.toMatch(/Mail Feedback|color: red|var demo|data:image/)
  })

  test("collects related topics without glossary entries or the page itself", () => {
    expect(topic().links).toEqual([
      { topicId: "DEMO_ROOT", title: "Demo - Help", parent: true },
      { topicId: "DEMO_PARENT", title: "Demo Parent", parent: true },
      { topicId: "DEMO_LET", title: "let_exp", parent: false },
      { topicId: "DEMO_LOGEXP", title: "log_exp", parent: false }
    ])
  })

  test("does not filter a related topic by its English title attribute", () => {
    const html = TOPIC_HTML.replace(
      "</div></body></html>",
      `<p><a href="adtcom:/sap/bc/adt/docu/abap/langu?object=DEMO_REFERENCE&amp;version=X" title="Glossary Entry">A reference</a></p></div></body></html>`
    )
    const page = readDocuPage(html, "DEMO_TOPIC")
    expect(page.kind).toBe("topic")
    expect(page.kind === "topic" && page.links).toContainEqual({
      topicId: "DEMO_REFERENCE",
      title: "A reference",
      parent: false
    })
  })

  test("is complete: every word of the page is in the Markdown", () => {
    const page = topic()
    expect(page.complete).toBe(true)
    expect(page.topicId).toBe("DEMO_TOPIC")
  })
})

describe("readDocuPage search results", () => {
  test("returns hit lists without topic content", () => {
    const page = readDocuPage(HITS_HTML)
    expect(page).toMatchObject({
      kind: "hits",
      hits: [
        { topicId: "DEMO_READ", title: "DEMO READ itab, Statement", group: "Demo Language" },
        {
          topicId: "DEMO_READ_OLD",
          title: "DEMO READ dbtab, Obsolete Statement",
          group: "Obsolete Elements"
        }
      ]
    })
  })

  test("parses the legacy public search page and its topic links", () => {
    expect(readDocuPage(LEGACY_HITS_HTML)).toMatchObject({
      kind: "hits",
      hits: [
        {
          topicId: "DEMO_LOOP_GROUP",
          title: "LOOP AT GROUP, ABAP Statement",
          group: "ABAP Language Elements"
        },
        {
          topicId: "DEMO_LOOP_ITAB",
          title: "LOOP AT itab, ABAP Statement",
          group: "ABAP Language Elements"
        },
        {
          topicId: "DEMO_LOOP_OLD",
          title: "LOOP AT dbtab, Obsolete ABAP Statement",
          group: "Obsolete ABAP Language Elements"
        }
      ]
    })
  })

  test("recognizes localized legacy hit lists without matching their heading text", () => {
    expect(readDocuPage(LEGACY_GERMAN_HITS_HTML)).toMatchObject({
      kind: "hits",
      hits: [
        {
          topicId: "DEMO_COND",
          title: "COND, Konstruktoroperator",
          group: "ABAP-Programmiersprache"
        },
        {
          topicId: "DEMO_SQL_COND",
          title: "sql_cond, Unterabfrage in WHERE",
          group: "Beispiele"
        }
      ]
    })
  })

  test("reads the topic id of a single-hit search page", () => {
    expect(readDocuPage(SINGLE_HIT_HTML)).toMatchObject({ kind: "topic", topicId: "DEMO_TOPIC" })
  })

  test("reports no results and invalid topics as empty pages", () => {
    const none = readDocuPage(NO_RESULTS_HTML)
    expect(none.kind).toBe("empty")
    expect(none.kind === "empty" && none.message).toContain(
      `We couldn't find any results for "nothing"`
    )
    expect(readDocuPage(INVALID_TOPIC_HTML)).toMatchObject({
      kind: "empty",
      message: "Invalid request"
    })
  })
})

describe("retainsContent", () => {
  test("allows additional Markdown markup and whitespace", () => {
    expect(retainsContent("a | b <c>", "**a** \\|\n`b` <c>")).toBe(true)
  })

  test.each([
    ["DEMO DEMO", "`DEMO`"],
    ["[ result ]", "`result`"],
    ["class=>method", "`classmethod`"],
    ["first second", "second first"]
  ])("detects lost or reordered content: %s", (source, output) => {
    expect(retainsContent(source, output)).toBe(false)
  })
})
