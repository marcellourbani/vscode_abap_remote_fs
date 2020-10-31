import {
  window,
  InputBoxOptions,
  Uri,
  Progress,
  CancellationToken,
  ProgressLocation,
  QuickPickItem,
  Memento,
  Position,
  Range,
  OpenDialogOptions,
  QuickPickOptions
} from "vscode"
import { splitAdtUriInternal, isUnDefined, isFn, isNonNullable } from "./functions"
import { Range as ApiRange } from "abap-adt-api"
import { RfsTaskEither, rfsTryCatch } from "./rfsTaskEither"


export const uriName = (uri: Uri) => uri.path.split("/").pop() || ""

export const withp = <T>(
  title: string,
  cb: (
    progress?: Progress<{ message?: string; increment?: number }>,
    token?: CancellationToken
  ) => Promise<T>,
  location = ProgressLocation.Window,
  cancellable?: boolean
) => {
  if (isUnDefined(cancellable))
    cancellable = location === ProgressLocation.Notification
  return window.withProgress({ location, title, cancellable }, cb)
}
interface MultiOpenOptions extends OpenDialogOptions { canSelectMany: true }
interface SingleOpenOptions extends OpenDialogOptions { canSelectMany?: false }
export function openDialog(options: SingleOpenOptions): RfsTaskEither<Uri>
export function openDialog(options: MultiOpenOptions): RfsTaskEither<Uri[]>
export function openDialog(options: OpenDialogOptions): RfsTaskEither<Uri[] | Uri> {
  const openTask = async () => window.showOpenDialog(options)
    .then(u => options.canSelectMany ? u : u?.[0])
  return rfsTryCatch<Uri | Uri[]>(openTask)
}

export const inputBox = (
  options: InputBoxOptions,
  token?: CancellationToken
): RfsTaskEither<string> => rfsTryCatch(async () =>
  await window.showInputBox({ ignoreFocusOut: true, ...options }, token))

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

async function pickSourceToArray<T extends QuickPickItem>(sources: pickSource<T>): Promise<T[] | string[]> {
  if (isFn(sources)) return sources()
  return sources
}

export function quickPick(
  items: simplePickSource,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): RfsTaskEither<string>
export function quickPick<T>(
  items: simplePickSource,
  options: QuickPickOptions | undefined,
  projector: (item: string) => T,
  token?: CancellationToken
): RfsTaskEither<T>
export function quickPick<T extends QuickPickItem, T2 = string>(
  items: recordPickSource<T>,
  options: QuickPickOptions | undefined,
  projector: (item: T) => T2,
  token?: CancellationToken
): RfsTaskEither<T2>
export function quickPick<T extends QuickPickItem>(
  items: recordPickSource<T>,
  options?: QuickPickOptions,
  projector?: undefined,
  token?: CancellationToken
): RfsTaskEither<T>
export function quickPick<T extends QuickPickItem, T2 = string>(
  items: pickSource<T>,
  options?: QuickPickOptions,
  projector?: (item: T) => T2,
  token?: CancellationToken): RfsTaskEither<string | T | T2> {

  return rfsTryCatch<T2 | T>(async () => {
    const qo = { ignoreFocusOut: true, ...options }
    const pickItems = await pickSourceToArray(items)
    const res = await window.showQuickPick(pickItems as T[], qo, token) // need to fool TS
    if (isNonNullable(res)) return projector ? projector(res) : res
    return
  })
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

export const rangeApi2Vsc = (r: ApiRange) =>
  new Range(
    vscPosition(r.start.line, r.start.column),
    vscPosition(r.end.line, r.end.column)
  )

export const splitAdtUri = (uri: string): AdtUriParts => {
  const { start, end, ...rest } = splitAdtUriInternal(uri)
  return {
    ...rest,
    start: start && vscPosition(start.line, start.character),
    end: end && vscPosition(end.line, end.character)
  }
}
