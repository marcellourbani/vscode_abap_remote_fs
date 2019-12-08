import { replace } from "./functions"
import { some, Option, option } from "fp-ts/lib/Option"
test("compose text input tasks", async () => {
  const base = some({ a: "", b: "b" })

  const fakeinput = <T>(x: Option<T>) => () => Promise.resolve(x)
  const witha = await replace(base, "a", fakeinput(some("avalue")))()
  const withb = await replace(witha, "b", fakeinput(some("Bvalue")))()
  option.map(withb, x => expect(x.a).toBe("avalue"))
  option.map(withb, x => expect(x.b).toBe("Bvalue"))
})
