(function (root) {
  const headerFilter = (filter, value) => {
    const text = String(value ?? "").toLocaleLowerCase()
    const query = String(filter ?? "")
    if (!query) return true
    if (query.endsWith(" ")) return text === query.trimEnd().toLocaleLowerCase()
    if (!/[?*]/.test(query)) return text.startsWith(query.toLocaleLowerCase())
    const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
    return new RegExp(`^${escaped}$`, "i").test(text)
  }
  const elapsed = run => (run?.elapsedMs || 0) + (run?.status === "running" && run.startedAt ? Math.max(0, Date.now() - Date.parse(run.startedAt)) : 0)
  const formatElapsed = milliseconds => {
    const seconds = Math.floor(milliseconds / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  const counts = rows => ({ total: rows.length, used: rows.filter(row => row.status === "used").length, unclear: rows.filter(row => row.status === "unclear").length })
  const accepts = (current, incoming) => !current || current.id !== incoming.id || incoming.revision >= current.revision
  const analysisLabel = (analysis, analyses) => analyses.filter(item => item.name.trim().toLowerCase() === analysis.name.trim().toLowerCase()).length > 1 ? `${analysis.name} (${analysis.id.slice(0, 8)})` : analysis.name
  root.RepositoryUsageView = { headerFilter, elapsed, formatElapsed, counts, accepts, analysisLabel }
})(globalThis)