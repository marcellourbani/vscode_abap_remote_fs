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
import { isFn, isUnDefined } from "./functions"
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
): TaskEither<Error | typeof none, string> => async () => {
  try {
    const result = await window.showInputBox(options, token)
    return result || result === "" ? right(result) : left(none)
  } catch (error) {
    return left(error)
  }
}

export function simpleInputBox(prompt: string, value = "", password = false) {
  return inputBox({ prompt, value, password })
}

type simplePickSource =
  | string[]
  | Promise<string[]>
  | (() => string[])
  | (() => Promise<string[]>)

type recordPickSource =
  | QuickPickItem[]
  | Promise<QuickPickItem[]>
  | (() => QuickPickItem[])
  | (() => Promise<QuickPickItem[]>)

type pickSource = simplePickSource | recordPickSource

export function quickPick(
  items: simplePickSource,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): TaskEither<Error | None, string>
export function quickPick(
  items: recordPickSource,
  options: QuickPickOptions | undefined,
  projector: (item: QuickPickItem) => string,
  token?: CancellationToken
): TaskEither<Error | None, string>
export function quickPick(
  items: recordPickSource,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): TaskEither<Error | None, QuickPickItem>
export function quickPick(
  items: pickSource,
  options?: QuickPickOptions,
  projector?: (item: QuickPickItem) => string,
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
    if (selection !== undefined)
      return right(projector ? projector(selection) : selection)
    return left(none)
  }
}
