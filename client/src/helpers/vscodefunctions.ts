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
