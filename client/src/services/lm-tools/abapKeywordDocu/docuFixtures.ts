const link = (topicId: string, text: string, extra = "") =>
  `<a href="adtcom:/sap/bc/adt/docu/abap/langu?object=${topicId}&sap-language=EN&version=X" class="blue"${extra}>${text}</a>`

const topNav = (topicId = "") =>
  `<div class="topnav"><div class="burger-and-logo"><img src="data:image/gif;base64,AAAA" alt="figure"/><h1 id="docu_bar_header">Keyword Documentation</h1></div>` +
  `<select class="version_select" onChange="window.location.href=this.value"><option value="">Select Version</option>` +
  `<option value="adtcom:/sap/bc/adt/docu/abap/langu?sap-language=EN&&object=${topicId}&version=X">Standard ABAP</option></select>` +
  `<div id="mail_feedback"><a href="mailto:feedback@example.com?subject=Feedback">Mail Feedback</a></div>` +
  `<div id="web_version"><a href="https://sap.example.com/docu?object=${topicId}">Web Version</a></div></div>`

const searchPage = (content: string, topicId = "") =>
  `<!DOCTYPE html><html><head><title>Docu</title><style>html { font-size: 18px; }</style><script>var demo = 1;</script></head>` +
  `<body>${topNav(topicId)}<div id="main"><div class="column-right"><p xmlns="">Standard ABAP</p>${content}</div></div></body></html>`

export const TOPIC_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html><head><title>Docu</title><style>body { color: red; }</style><script>var demo = "<p>";</script></head>
<body style="font-size: 75%"><div style="text-align:left">Standard ABAP</div>
<div style="text-align:right"><a href="mailto:feedback@example.com?subject=Feedback" class="blue"><img src="data:image/gif;base64,AAAA" border="0"> Mail Feedback</a></div><br>
<div class="all">
<span class="path">${link("demo_root", "Demo - Help")}&nbsp;&gt;&nbsp; ${link("demo_parent", "Demo Parent")}&nbsp;&gt;&nbsp; </span>
<A NAME="@@DEMO@@"></A>
<p><span class="h1"> DEMO, Demo Operator &nbsp;&nbsp;<a href="https://sap.example.com/docu?object=DEMO_TOPIC" title="Display in browser"><img src="data:image/gif;base64,AAAA"></a></span></p>
<p><span class="h2"> Syntax </span></p>
<p> <span class="qtext">... DEMO type( <i class=bn>[</i>${link("demo_let", "let_exp")}<i class=bn>]</i> <br>&nbsp;&nbsp;&nbsp;&nbsp;WHEN ${link("demo_logexp", "log_exp")} THEN result ) ...</span> <br><br> </p>
<p><span class="h4"> Effect </span></p>
<p> A ${link("demo_term_glosry", "demo expression", ' title="Glossary Entry"')} with <span class="qtext">DEMO</span> has a <b>result</b>. </p>
<ul class="disc"> <li>First point. <ul class="circlem2"> <li>Nested point.</li> </ul> </li> <li>Second point</li> </ul>
<table border> <tr> <td><span class="qtext"><span class="bold">sy-subrc</span></span></td> <td><span class="bold">Meaning</span></td> </tr> <tr> <td>0</td> <td>Value a|b found.</td> </tr> </table>
<p>See also ${link("demo_parent", "Demo Parent")} and ${link("demo_topic", "this page")}.</p>
</div></body></html>`

export const HITS_HTML = searchPage(
  `<h2 xmlns="">Demo Language</h2>` +
    `<span xmlns="" class="tab">${link("DEMO_READ", "DEMO READ itab, Statement")}</span><br/>` +
    `<h2 xmlns="">Obsolete Elements</h2>` +
    `<span xmlns="" class="tab">${link("DEMO_READ_OLD", "DEMO READ dbtab, Obsolete Statement")}</span><br/>`
)

export const LEGACY_HITS_HTML = `<html><body>
<span class="h1">ABAP Help</span><br><br>
<span class="h3">Search result from ABAP-Index</span><br><br>
<b>ABAP Language Elements</b><br>
<a href="/sap/public/bc/abap/docu?input=LOOP%20AT&amp;format=eclipse&amp;object=DEMO_LOOP_GROUP&amp;sap-language=EN&amp;sap-client=100">LOOP AT GROUP, ABAP Statement</a><br>
<a href="/sap/public/bc/abap/docu?input=LOOP%20AT&amp;format=eclipse&amp;object=DEMO_LOOP_ITAB&amp;sap-language=EN&amp;sap-client=100">LOOP AT itab, ABAP Statement</a><br>
<b>Obsolete ABAP Language Elements</b><br>
<a href="/sap/public/bc/abap/docu?input=LOOP%20AT&amp;format=eclipse&amp;object=DEMO_LOOP_OLD&amp;sap-language=EN&amp;sap-client=100">LOOP AT dbtab, Obsolete ABAP Statement</a><br>
</body></html>`

export const LEGACY_GERMAN_HITS_HTML = `<html><body>
<span class="h1">ABAP-Hilfe</span><br><br>
<span class="h3">Suchergebnis im ABAP-Index</span><br><br>
<b>ABAP-Programmiersprache</b><br>
<a href="/sap/public/bc/abap/docu?input=COND&amp;format=eclipse&amp;object=DEMO_COND&amp;sap-language=DE&amp;sap-client=100">COND, Konstruktoroperator</a><br>
<b>Beispiele</b><br>
<a href="/sap/public/bc/abap/docu?input=COND&amp;format=eclipse&amp;object=DEMO_SQL_COND&amp;sap-language=DE&amp;sap-client=100">sql_cond, Unterabfrage in WHERE</a><br>
</body></html>`

export const SINGLE_HIT_HTML = searchPage(
  `<span xmlns="" class="path">${link("demo_root", "Demo - Help")} &rarr;&nbsp;</span>` +
    `<h1 xmlns="">DEMO, Demo Operator</h1><p xmlns="">Search page body.</p>`,
  "DEMO_TOPIC"
)

export const NO_RESULTS_HTML = searchPage(
  `<p xmlns="">We couldn't find any results for <b>"nothing"</b></p>`
)

export const INVALID_TOPIC_HTML = "<html><body>Invalid request</body></html>"
