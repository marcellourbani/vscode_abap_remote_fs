import { context } from "../../extension"

/**
 * Canonical shape for persisted recent objects.
 * Both the popup (AdtObjectFinder) and sidebar (objectSearchView)
 * read/write this same shape so items look identical everywhere.
 */
export interface RecentObject {
  uri: string
  type: string
  name: string
  packageName: string
  typeLabel: string
  description?: string
  localizedTypeLabel?: string
}

const RECENT_KEY_PREFIX = "abapfs.recentObjects."
export const RECENT_MAX = 10

function key(connId: string) {
  return `${RECENT_KEY_PREFIX}${connId}`
}

export function getRecent(connId: string): RecentObject[] {
  return context.globalState.get<RecentObject[]>(key(connId)) || []
}

export async function addRecent(connId: string, item: RecentObject): Promise<void> {
  let recent = getRecent(connId).filter(r => r.uri !== item.uri)
  recent.unshift(item)
  if (recent.length > RECENT_MAX) {
    recent = recent.slice(0, RECENT_MAX)
  }
  await context.globalState.update(key(connId), recent)
}

export async function clearRecent(connId: string): Promise<void> {
  await context.globalState.update(key(connId), [])
}
