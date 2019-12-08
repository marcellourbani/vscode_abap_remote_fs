import { Task, task } from "fp-ts/lib/Task"
import {
  window,
  InputBoxOptions,
  Uri,
  Progress,
  CancellationToken,
  ProgressLocation
} from "vscode"
import { some, none, Option, option, fromNullable } from "fp-ts/lib/Option"

export const uriName = (uri: Uri) => uri.path.split("/").pop() || ""

export const withp = <T>(
  title: string,
  cb: (
    progress?: Progress<{ message?: string; increment?: number }>,
    token?: CancellationToken
  ) => Promise<T>,
  location = ProgressLocation.Window
) => window.withProgress({ location, title }, cb)

export const inputBox = (
  options: InputBoxOptions
): Task<Option<string>> => async () => {
  return fromNullable(await window.showInputBox(options))
}

export function simpleInputBox(prompt: string, value = "", password = false) {
  return inputBox({ prompt, value, password })
}

export const collect = () => {
  const t1 = simpleInputBox("")
  const t2 = simpleInputBox("")
  return task.chain(t1, x => (x === none ? t1 : t2))
}
export const replace = <T1, T2 extends keyof T1, T3>(
  valueOption: Option<T1>,
  field: T2,
  inputTask: Task<Option<T3>>
) => {
  return task.chain(inputTask, iop => () =>
    Promise.resolve(
      option.map(valueOption, x =>
        option.map(iop, iv => {
          return { ...x, [field]: iv }
        })
      )
    )
  )
}

const foo = () => {
  const bar = some({ a: "1", b: "2" })
  return replace(bar, "a", simpleInputBox("a"))()
}
