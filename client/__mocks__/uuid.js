// CJS shim for uuid v14 (ESM-only) so Jest (CommonJS mode) can import it
let counter = 0
const v1 = () => {
    const hex = (++counter).toString(16).padStart(12, "0")
    return `00000000-0000-1000-8000-${hex}`
}
const v4 = () => {
    const hex = Math.random().toString(16).slice(2).padStart(32, "0")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
module.exports = { v1, v4 }
