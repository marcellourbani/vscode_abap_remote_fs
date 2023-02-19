import {
  after,
  fieldReplacer,
  dependFieldReplacer,
  splitAdtUriInternal,
} from "./functions"
import { none } from "fp-ts/lib/Option"
import { right, isLeft, isRight } from "fp-ts/lib/Either"
import { chain, bind, map } from "fp-ts/lib/TaskEither"
import { RfsTaskEither, rfsTryCatch, chainTaskTransformers, addField, rfsChainE, rfsBind, rfsBindReplace } from "./rfsTaskEither"
import { pipe } from "fp-ts/lib/function"
const isFalsey = (x: any) => !x
const rejectPromise = () => Promise.reject(new Error("foo"))

interface A extends Record<string, string> {
  a: string
  b: string
}

const fakeselect = <T1, T2 = string>(
  x?: T2,
  f?: () => Promise<T1>
): RfsTaskEither<T2> => rfsTryCatch(async () => {
  if (f) await f()
  return after(1).then(() => x)
})

function dependentInput<T1 extends Record<string, string>, T2>(
  x?: string,
  f?: () => Promise<T2>
): (record: T1, field: keyof T1) => RfsTaskEither<string> {
  return (record: T1, field: keyof T1) => {
    const old: string = record[field] || ""
    return fakeselect(old + x, f)
  }
}
test("fakeselect", async () => {
  const x = await fakeselect({ "foobar": 3 })()
  if (isRight(x)) expect(x.right.foobar).toBe(3)
  else throw new Error(`${x.left}`)
})
test("compose text input and selections", async () => {
  const base2 = { a: "", b: "b" }

  const single = await fieldReplacer("b", fakeselect("bb"))(base2)()
  if (isRight(single)) {
    expect(single.right.a).toBe("")
  } else {
    expect(single.left).toBe(none)
  }
  const inputBoth = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect("bb")),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base2)

  const both = await inputBoth()
  if (isLeft(both)) throw new Error("Unexpected none")
  expect(both.right.a).toBe("aa")
  expect(both.right.b).toBe("bb")
  const inputBoth2 = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect()),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base2)
  const both2 = await inputBoth2()
  if (isRight(both2)) fail("Unexpected right")
  expect(isLeft(both2) && both2.left).toBe(none)
  const inputBoth3 = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect("c", rejectPromise)),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"))
  )(base2)
  const both3 = await inputBoth3()
  if (isRight(both3)) fail("Unexpected right")
  else expect(both3.left.toString()).toBe("Error: foo")
})

test("compose dependent replacers", async () => {
  const base3 = { a: "", b: "b" }
  const _ = ""
  const changed = await chainTaskTransformers<A>(
    dependFieldReplacer("a", dependentInput("aa")),
    dependFieldReplacer("a", dependentInput<A, any>("suffix")),
    dependFieldReplacer("b", dependentInput<A, any>("suffix")),
    dependFieldReplacer("a", () => fakeselect("aa")),
    fieldReplacer("a", fakeselect("aa"))
  )(base3)()
  if (isLeft(changed)) fail("Unexpected failure")
  else {
    expect(changed.right.a).toBe("aa")
    expect(changed.right.b).toBe("bsuffix")
  }

  const rejectPromise2 = () => {
    return rejectPromise()
  }

  const changed2 = await chainTaskTransformers<A>(
    dependFieldReplacer("a", dependentInput<A, any>("aa")),
    dependFieldReplacer("b", dependentInput<A, any>("suffix", rejectPromise2)),
    dependFieldReplacer("a", () => fakeselect("aa")),
    fieldReplacer("a", fakeselect("aa"))
  )(base3)()
  if (isRight(changed2)) fail("Unexpected success")
})

const base = "sap/bc/adt/oo/classes/zfoobar/includes/testclasses"
test("split uri simple", () => {
  const parts = splitAdtUriInternal(base)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeUndefined()
  expect(parts.start).toBeUndefined()
})

test("split uri fragment", () => {
  let parts = splitAdtUriInternal(`${base}#`)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeFalsy()
  expect(parts.type).toBeFalsy()
  parts = splitAdtUriInternal(
    `${base}#type=${"CLAS/OLD"};name=${encodeURIComponent(
      "MULTIPLE                      II"
    )}`
  )
  expect(parts.path).toBe(base)
  expect(parts.name).toBe("MULTIPLE                      II")
  expect(parts.type).toBe("CLAS/OLD")
  parts = splitAdtUriInternal(`${base}#foo;bar=1`)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeFalsy()
  expect(parts.type).toBeFalsy()
})

test("split uri start", () => {
  let parts = splitAdtUriInternal(`${base}?`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeFalsy()
  parts = splitAdtUriInternal(`${base}?start=3,2`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})
test("split uri start in fragment", () => {
  const parts = splitAdtUriInternal(`${base}#start=3,2`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})
test("split namespaced uri start in fragment", () => {
  const path = "/sap/bc/adt/vit/wb/object_type/ttypda/object_name/%2fFOO%2fBAR"
  const parts = splitAdtUriInternal(`${path}#start=3,2`)
  expect(parts.path).toBe(path)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})

test("chain and field collection", async () => {
  const addKey = addField("key", async <T extends { foo: number }>(x: T) => 3)
  const myfn = pipe(
    rfsTryCatch(async () => ({ foo: 1 })),
    rfsChainE(async x => ({ ...x, y: { bar: "baz" } })),
    rfsChainE(addKey),
    rfsBind("name", async x => `foobar ${x.y.bar}`),
    rfsBind("greeting", async x => `hello, ${x.name}`),
    rfsBind("greetingbye", async x => `bye, ${x.name}`),
  )

  const result = await myfn()

  if (isLeft(result)) throw result.left
  expect(result.right.foo).toBe(1)
  expect(result.right.y.bar).toBe("baz")
  expect(result.right.name).toBe("foobar baz")
  expect(result.right.key).toBe(3)
  expect(result.right.greeting).toBe("hello, foobar baz")
  expect(result.right.greetingbye).toBe("bye, foobar baz")

  const overridden = await pipe(
    rfsTryCatch(async () => ({ foo: 1 })),
    rfsChainE(async x => ({ ...x, y: { bar: "baz" } })),
    rfsBindReplace("foo", async x => `bar`),
  )()
  if (isLeft(overridden)) throw overridden.left
  expect(overridden.right.foo).toBe("bar")
  expect(overridden.right.y.bar).toBe("baz")
})

test("chain tasks", async () => {
  const getKey = <T extends { foo: number }>(x: T) => rfsTryCatch(async () => 3)
  const myfn = pipe(
    rfsTryCatch(async () => ({ foo: 1 })),
    bind("key", getKey),
    bind("baz", () => async () => right("foobar")),
    bind("bar", () => fakeselect({ "foo": 1 })),
    chain(x => () => pipe(fakeselect({ "bar": 2 }), map(bar => ({ ...x, bar })))()),
    // rfsChainE("bar", () => fakeselect({ "bar": 2 })),
    bind("bar2", () => fakeselect({ "bar": 2 })),
    bind("foobar", () => fakeselect({ "foobar": 3 })),
    bind("greeting", ({ bar }) => fakeselect("hello"))
  )
  const result = await myfn()
  if (isLeft(result)) throw result.left
  expect(result.right.foo).toBe(1)
  expect(result.right.baz).toBe("foobar")
  expect(result.right.key).toBe(3)
  expect(result.right.bar2.bar).toBe(2)
  expect((result.right.bar as any).bar).toBe(2)
  expect(result.right.foobar.foobar).toBe(3)
  expect(result.right.greeting).toBe("hello")
})

test("chain structures", async () => {
  interface I1 { key: string }
  type T2 = { foo: string }
  interface I3 { bar: string }
  const f1 = async <T>(x: T): Promise<I1> => ({ key: "key" })
  const f2 = async ({ x }: { x: I1 }): Promise<T2> => ({ foo: `x:${x.key}` })
  const f3 = async ({ x, y }: { x: I1, y: T2 }): Promise<T2> => ({ foo: `x:${x.key},y:${y.foo}` })
  const result = await pipe(
    async () => ({}),
    async x => addField("x", f1)(await x()),
    async x => addField("y", f2)(await x as { x: I1 }),
    async x => addField("z", f1)(await x),
  )
  expect(result.x.key).toBe("key")
  expect(result.y.foo).toBe("x:key")
})

