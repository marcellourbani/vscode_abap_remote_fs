import type { InactiveObjectElement, InactiveObjectRecord } from "abap-adt-api"
import { QuickPickItemKind, type QuickPickItem } from "vscode"
import { funWindow as window } from "../../../services/funMessenger"

interface TransportGroup {
  order: string
  task: string
  description: string
  entries: InactiveObjectRecord[]
}

interface ObjectItem extends QuickPickItem {
  object: InactiveObjectElement
}

const transportId = (uri?: string) => uri?.split("/").filter(Boolean).pop() || ""

const transportOf = (entry: InactiveObjectRecord) => {
  const transport = entry.transport
  const task =
    transport?.["adtcore:name"] || transportId(transport?.["adtcore:uri"]) || "Without transport"
  return {
    order: transportId(transport?.["adtcore:parentUri"]) || task,
    task,
    description: `${transport?.["adtcore:description"] || ""}`.trim()
  }
}

const transportLabel = (group: TransportGroup) =>
  group.order === group.task ? group.task : `${group.order} / ${group.task}`

const groupLabel = (group: TransportGroup) =>
  group.description ? `${transportLabel(group)}  ${group.description}` : transportLabel(group)

const groupByTransport = (entries: InactiveObjectRecord[]) => {
  const groups = new Map<string, TransportGroup>()
  for (const entry of entries) {
    const transport = transportOf(entry)
    const key = `${transport.order}::${transport.task}`
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { ...transport, entries: [entry] })
  }
  return [...groups.values()].sort(
    (left, right) => left.order.localeCompare(right.order) || left.task.localeCompare(right.task)
  )
}

const compareObjects = (left: InactiveObjectElement, right: InactiveObjectElement) =>
  `${left["adtcore:type"] || ""}`.localeCompare(`${right["adtcore:type"] || ""}`) ||
  `${left["adtcore:name"] || ""}`.localeCompare(`${right["adtcore:name"] || ""}`)

const objectItem = (object: InactiveObjectElement, group: TransportGroup): ObjectItem => ({
  label: `  ${object["adtcore:name"]}`,
  description: [
    object["adtcore:type"],
    transportLabel(group),
    object.deleted ? "deleted" : "",
    object.user
  ]
    .filter(Boolean)
    .join(" • "),
  detail: [group.description, object["adtcore:uri"]].filter(Boolean).join(" • "),
  picked: false,
  object
})

const groupItems = (group: TransportGroup): (QuickPickItem | ObjectItem)[] => [
  { kind: QuickPickItemKind.Separator, label: groupLabel(group) },
  ...group.entries
    .flatMap(entry => (entry.object ? [entry.object] : []))
    .sort(compareObjects)
    .map(object => objectItem(object, group))
]

const isObjectItem = (item: QuickPickItem): item is ObjectItem => "object" in item

/** Lets the user pick inactive objects grouped by transport. Undefined when cancelled */
export async function pickInactiveObjects(
  entries: InactiveObjectRecord[]
): Promise<InactiveObjectElement[] | undefined> {
  const items = groupByTransport(entries).flatMap(groupItems)
  const selected = await window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Select unactivated objects grouped by transport order",
    title: `Select unactivated objects (${entries.length} found)`
  })
  return selected?.filter(isObjectItem).map(item => item.object)
}
