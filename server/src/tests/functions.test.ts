import { callThrottler } from "../functions"

test("call throttler", async () => {
  const numCalls = 9
  const key = "key"
  const calls: boolean[] = []
  const results: Promise<number>[] = []
  const gencb = (i: number) => () =>
    new Promise<number>(resolve => {
      setTimeout(() => resolve(i), 10)
      // tslint:disable-next-line: no-console
      console.log("called:" + i)
      calls[i] = true
    })

  const throttler = callThrottler<number>()

  for (let idx = 0; idx < numCalls; idx++)
    results[idx] = throttler(key, gencb(idx))
  expect(await results[0]).toBe(0)
  expect(await results[numCalls - 1]).toBe(numCalls - 1)
  for (let idx = 1; idx < numCalls - 1; idx++)
    expect(await results[idx]).toBe(numCalls - 1)
  for (let idx = 1; idx < numCalls - 1; idx++) expect(calls[idx]).toBeFalsy()
  expect(calls[0]).toBe(true)
  expect(calls[numCalls - 1]).toBe(true)
})
