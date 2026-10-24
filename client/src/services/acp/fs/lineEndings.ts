// Models write "\n" in their edit strings, and agents match them literally against what they read,
// so agents always see LF and the file's own line endings are restored on write.

export function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

export function withLineEndingsOf(content: string, existing: string | undefined): string {
  if (existing === undefined || !existing.includes("\r\n")) return content
  return toLf(content).replace(/\n/g, "\r\n")
}
