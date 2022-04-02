import { Either, isRight, left, right } from "fp-ts/lib/Either"
import { Lazy, pipe } from "fp-ts/lib/function"
import { fromNullable, isNone, isSome, none, None, Option } from "fp-ts/lib/Option"
import { bind, chain, chainEitherK, map, taskEither, TaskEither, tryCatch } from "fp-ts/lib/TaskEither"
import { types } from "util"

export type LeftType = Error | None
const isOption = <T>(x: any): x is Option<T> => isSome(x) || isNone(x)
export type RfsEither<T> = Either<LeftType, T>
export type RfsTaskEither<T> = TaskEither<LeftType, NonNullable<T>>
export const rfsExtract = <T>(x: RfsEither<T>): T | undefined => {
    if (isRight(x)) return x.right
    if (x.left === none) return
    throw x.left
}
export const nullToNone = <T>(x: T): RfsEither<NonNullable<T>> => {
    const o = fromNullable(x)
    if (isSome(o)) return right(o.value)
    return left(o)
}
export const rfsTaskEither = <T>(x: T): RfsTaskEither<T> => async () => nullToNone(x)
export const rfsTryCatch = <T>(f: Lazy<Promise<T | undefined>>): RfsTaskEither<T> => {
    const x = tryCatch(f, e => types.isNativeError(e) ? e : new Error(`${(e as any)?.message || e}`))
    return chainEitherK(nullToNone)(x)
}
export const rfsWrap = <T, R>(f: (x: T) => R | Promise<R>) => (x: T) => rfsTryCatch(async () => f(x))
export const rfsChainE = <P, T>(f: (x: P) => T | Promise<T>) => chain(rfsWrap(f))
export const rfsBind = <N extends string, A, B>(n: Exclude<N, keyof A>, f: (x: A) => B | Promise<B>) =>
    bind(n, rfsWrap(f))

export const rfsBindReplace = <N extends string, A, B>(name: N, f: (x: A) => B | Promise<B>) => chain((a: A) =>
    pipe(rfsWrap(f)(a), map(value => {
        const r = { [name]: value } as Record<N, NonNullable<B>>
        return { ...a, ...r }
    })))

export const addField = <K extends string, P, R>(name: K, f: (x: P) => Promise<R>) =>
    async (x: P): Promise<P & Record<K, R>> => {
        const rr: R = await f(x)
        const r = { [name]: rr } as Record<K, R>
        return { ...x, ...r }
    }

type TaskTransformer<T> = (x: T) => TaskEither<LeftType, T>
export const createTaskTransformer = <T>(
    f: (y: T) => T | Option<T> | Promise<T | Option<T>>
) => (x: T): TaskEither<LeftType, T> => () => {
    const toProm = async () => f(x)
    return toProm()
        .then((r: T | Option<T>) => {
            if (isOption(r)) return isNone(r) ? left(r) : right(r.value)
            else return right(r)
        })
        .catch(left)
}

export const chainTaskTransformers = <T>(
    first: TaskTransformer<T>,
    ...rest: TaskTransformer<T>[]
) => (y: T) => rest.reduce(taskEither.chain, first(y))
