import { fieldReplacer, chainTaskTransformers, delay } from "./functions"
import {
  some,
  Option,
  option,
  fromNullable,
  none,
  isSome,
  isNone
} from "fp-ts/lib/Option"

const fakeinput = <T>(x?: T) => () => delay(1).then(() => fromNullable(x))

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
  expect(both.value.a).toBe("cc")
})
