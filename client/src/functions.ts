export const pick = <T, K extends keyof T>(name: K) => (x: T): T[K] => x[name]
export const flat = <T>(a: T[][]): T[] =>
  a.reduce((res, current) => [...res, ...current], [])

export const flatMap = <T1, T2>(
  arr: T1[],
  cb: (c: T1, idx?: number, arrref?: T1[]) => T2[]
) => flat(arr.map(cb))

// given an array of objects returns a map indexed by a property
// only works if the property is an unique key
export function ArrayToMap(name: string) {
  return (arr: any[]): Map<string, any> => {
    return arr.reduce((map, current: any) => {
      map.set(current[name], current)
      return map
    }, new Map())
  }
}

// returns a function that gets the given property from a map
export const selectMap = <T1, K extends keyof T1, T2>(
  map: Map<string, T1>,
  property: K,
  defval: T2
): ((index: string) => T2) => (index: string): T2 => {
  const record = map && map.get(index)
  return ((record && record[property]) || defval) as T2
}

export const stringOrder = (s1: any, s2: any) => {
  if (s1 > s2) return 1
  return s2 > s1 ? -1 : 0
}

export const fieldOrder = <T>(fieldName: keyof T, inverse: boolean = false) => (
  a1: T,
  a2: T
) => stringOrder(a1[fieldName], a2[fieldName]) * (inverse ? -1 : 1)
