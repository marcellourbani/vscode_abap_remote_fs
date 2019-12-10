import {
  fieldReplacer,
  chainTaskTransformers,
  delay,
  chainTaskEitherTransformers,
  fieldReplacerte
} from "./functions"
import {
  some,
  Option,
  option,
  fromNullable,
  none,
  isSome,
  isNone
} from "fp-ts/lib/Option"
import { right, left, isLeft, isRight } from "fp-ts/lib/Either"
import { TaskEither, taskEither } from "fp-ts/lib/TaskEither"

const fakeinput = <T>(x?: T) => () => delay(1).then(() => fromNullable(x))

const fakeselect = <T>(x?: T): TaskEither<typeof none, T> => () =>
  delay(1).then(() => (x ? right(x) : left(none)))

interface A {
  a: string
  b: string
}
test("compose text input tasks", async () => {
  const base = some({ a: "", b: "b" })

  const witha = await fieldReplacer("a", fakeinput("avalue"), base)()
  expect(isSome(witha)).toBeTruthy()
  expect(isSome(witha) && witha.value.a).toBe("avalue")
  const withb = await fieldReplacer("b", fakeinput())(witha)()
  expect(withb).toBe(none)
  expect(await fieldReplacer("a", fakeinput("a"), withb)()).toBe(none)
  option.map(withb, x => expect(x.a).toBe("avalue"))
  option.map(withb, x => expect(x.b).toBe("Bvalue"))

  const inputBoth = chainTaskTransformers<Option<A>>(
    fieldReplacer("a", fakeinput("aa")),
    fieldReplacer("b", fakeinput("bb")),
    fieldReplacer("a", fakeinput("cc"))
  )(base)

  const both = await inputBoth()
  if (isNone(both)) throw new Error("Unexpected none")
  expect(both.value.b).toBe("bb")
  expect(both.value.a).toBe("cc")
})

test("compose text input tasks with filter", async () => {
  const base = some({ a: "", b: "b" })

  const isFalsey = (x: any) => !x

  const inputBoth = chainTaskTransformers<Option<A>>(
    fieldReplacer("b", fakeinput("bb"), isFalsey),
    fieldReplacer("a", fakeinput("aa"), isFalsey),
    fieldReplacer("a", fakeinput(), isFalsey)
  )(base)

  const both = await inputBoth()
  if (isNone(both)) throw new Error("Unexpected none")
  expect(both.value.a).toBe("aa")
  expect(both.value.b).toBe("b")
})

test("compose text input and selections", async () => {
  const base = { a: "", b: "b" }

  const isFalsey = (x: any) => {
    if (x) {
      return false
    } else return true
  }

  const single = await fieldReplacerte("b", fakeselect("bb"))(base)()
  if (isRight(single)) {
    expect(single.right.a).toBe("")
  } else {
    expect(single.left).toBe(none)
  }
  const inputBoth = chainTaskEitherTransformers<typeof none, A>(
    fieldReplacerte("b", fakeselect("bb")),
    fieldReplacerte("a", fakeselect("aa")),
    fieldReplacerte("a", fakeselect("b"), isFalsey)
  )(base)

  const both = await inputBoth()
  if (isLeft(both)) throw new Error("Unexpected none")
  expect(both.right.a).toBe("aa")
  expect(both.right.b).toBe("bb")
  const inputBoth2 = chainTaskEitherTransformers<typeof none, A>(
    fieldReplacerte("b", fakeselect()),
    fieldReplacerte("a", fakeselect("aa")),
    fieldReplacerte("a", fakeselect("b"), isFalsey)
  )(base)
  const both2 = await inputBoth2()
  if (isRight(both2)) throw new Error("Unexpected right")
})
