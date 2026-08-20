import { ADTClient, objectPath } from "abap-adt-api"

export const packageUri = async (client: ADTClient, name: string) => {
  const cancreate = await client.collectionFeatureDetails("/sap/bc/adt/packages")
  return cancreate
    ? objectPath("DEVC/K", name)
    : `/sap/bc/adt/vit/wb/object_type/devck/object_name/${encodeURIComponent(name)}`
}
