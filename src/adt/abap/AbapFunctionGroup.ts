import { AbapObject, AbapNodeComponentByCategory } from "./AbapObject"
import { ADTClient } from "abap-adt-api"
import { isAbapFunction } from "./AbapFunction"
import { isAbapInclude } from "./AbapInclude"

export class AbapFunctionGroup extends AbapObject {
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
    this.pExpandable = !!expandable
  }
  public async getChildren(
    client: ADTClient
  ): Promise<AbapNodeComponentByCategory[]> {
    const children = await super.getChildren(client)
    children.forEach(c =>
      c.types.forEach(t =>
        t.objects.forEach(o => {
          if (isAbapFunction(o) || isAbapInclude(o)) o.setParent(this)
        })
      )
    )
    return children
  }
}
