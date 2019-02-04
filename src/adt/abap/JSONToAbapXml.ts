export function JSON2AbapXML(original: any, root: string = "DATA") {
  // only flat objects for now, might extend later...
  let inner = ""
  for (const key of Object.keys(original))
    if (original[key])
      inner = `${inner}\n<${key}>${original[key] || ""}</${key}>`
    else inner = `${inner}\n<${key}/>`

  return `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <${root}>
      ${inner}
    </${root}>
  </asx:values>
</asx:abap>`
}
export function JSON2AbapXMLNode(
  original: any,
  nodeName: string,
  value?: string
): string {
  const paramValues = Object.keys(original)
    .map(k => `${k}="${original[k]}"`)
    .join(" ")
  return value
    ? `<${nodeName} ${paramValues}>${value}</${nodeName}>`
    : `<${nodeName} ${paramValues}/>`
}
