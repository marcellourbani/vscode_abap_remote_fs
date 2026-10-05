import { parse, type ExpressionStatement, type FunctionExpression } from "acorn"

export function wrapAsAsyncFunction(code: string): string {
  const prefix = "(async function() {\n"
  const wrapped = `${prefix}${code}\n})`
  const program = parse(wrapped, { ecmaVersion: "latest" })
  const expression = program.body[0] as ExpressionStatement
  const functionBody = (expression.expression as FunctionExpression).body.body
  const last = functionBody.at(-1)

  if (!last || last.type !== "ExpressionStatement" || last.directive) return wrapped

  const value = wrapped.slice(last.expression.start, last.expression.end)
  return `${wrapped.slice(0, last.start)}return (${value})${wrapped.slice(last.end)}`
}
