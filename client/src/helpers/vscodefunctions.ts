import { TaskEither } from "fp-ts/lib/TaskEither"
import {
  window,
  InputBoxOptions,
  Uri,
  Progress,
  CancellationToken,
  ProgressLocation,
  QuickPickItem,
  QuickPickOptions
} from "vscode"
import { none, fromNullable, None } from "fp-ts/lib/Option"
import { isFn } from "./functions"
import { left, right } from "fp-ts/lib/Either"

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
  options: InputBoxOptions,
  token?: CancellationToken
) => async () => fromNullable(await window.showInputBox(options, token))

export function simpleInputBox(prompt: string, value = "", password = false) {
  return inputBox({ prompt, value, password })
}

type pickSourceBase = QuickPickItem[] | string[]
type pickSource =
  | pickSourceBase
  | Promise<pickSourceBase>
  | (() => pickSourceBase)
  | (() => Promise<pickSourceBase>)

export function select(
  items: pickSource,
  options?: QuickPickOptions,
  token?: CancellationToken
): TaskEither<Error | None, string | QuickPickItem> {
  return async () => {
    try {
      items = isFn(items) ? await items() : await items
    } catch (error) {
      return left(error)
    }
    const pickItems = items as QuickPickItem[] // typescript fails to deal with the overload...
    if (pickItems.length === 0) return left(none)

    const selection = await window.showQuickPick(pickItems, options, token)
    if (selection !== undefined) return right("selection")
    return left(none)
  }
}
