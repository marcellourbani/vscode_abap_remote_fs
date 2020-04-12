import { TaskEither } from "fp-ts/lib/TaskEither"
import {
  window,
  InputBoxOptions,
  Uri,
  Progress,
  CancellationToken,
  ProgressLocation,
  QuickPickItem,
  QuickPickOptions,
  Memento,
  Position
} from "vscode"
import { none, None } from "fp-ts/lib/Option"
import { isFn, splitAdtUriInternal } from "./functions"
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
    const op = { ignoreFocusOut: true, ...options }
    const result = await window.showInputBox(op, token)
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

type recordPickSource<T extends QuickPickItem> =
  | T[]
  | Promise<T[]>
  | (() => T[])
  | (() => Promise<T[]>)

type pickSource<T extends QuickPickItem> =
  | simplePickSource
  | recordPickSource<T>

export function quickPick(
  items: simplePickSource,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): TaskEither<Error | None, string>
export function quickPick<T extends QuickPickItem>(
  items: recordPickSource<T>,
  options: QuickPickOptions | undefined,
  projector: (item: QuickPickItem) => string,
  token?: CancellationToken
): TaskEither<Error | None, string>
export function quickPick<T extends QuickPickItem>(
  items: recordPickSource<T>,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): TaskEither<Error | None, T>
export function quickPick<T extends QuickPickItem>(
  items: pickSource<T>,
  options?: QuickPickOptions,
  projector?: (item: QuickPickItem) => string,
  token?: CancellationToken
): TaskEither<Error | None, string | T> {
  return async () => {
    try {
      items = isFn(items) ? await items() : await items
    } catch (error) {
      return left(error)
    }
    const pickItems = items as T[] // typescript fails to deal with the overload...
    if (pickItems.length === 0) return left(none)

    const qo = { ignoreFocusOut: true, ...options }
    const selection = await window.showQuickPick(pickItems, qo, token)
    if (selection !== undefined)
      return right(projector ? projector(selection) : selection)
    return left(none)
  }
}

export const createStore = <T>(name: string, store: Memento): Memento => {
  let _map: Map<string, T>
  const load = () => {
    if (!_map) {
      _map = new Map(store.get(name) || [])
    }
  }
  return {
    get: (key: string, defValue?: T) => {
      load()
      return _map.get(key) || defValue
    },
    update: async (key: string, value: T) => {
      load()
      if (_map.get(key) === value) return
      _map.set(key, value)
      return store.update(name, [..._map])
    }
  }
}

export interface AdtUriParts {
  path: string
  type?: string
  name?: string
  start?: Position
  end?: Position
}

export const vscPosition = (adtLine: number, character: number) =>
  new Position(adtLine - 1, character)

export const splitAdtUri = (uri: string): AdtUriParts => {
  const { start, end, ...rest } = splitAdtUriInternal(Uri.parse(uri))
  return {
    ...rest,
    start: start && vscPosition(start.line, start.character),
    end: end && vscPosition(end.line, end.character)
  }
}
