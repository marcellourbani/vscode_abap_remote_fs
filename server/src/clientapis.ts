import {
  ClientConfiguration,
  Methods,
  AbapObjectDetail,
  AbapObjectSource
} from "sharedtypes"
import { connection } from "./clientManager"

export async function readConfiguration(key: string) {
  const c = (await connection.sendRequest(Methods.readConfiguration, key)) as
    | ClientConfiguration
    | undefined
  return c
}

export async function getObjectDetails(uri: string) {
  const object = (await connection.sendRequest(Methods.objectDetails, uri)) as
    | AbapObjectDetail
    | undefined
  return object
}

export async function getObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readObjectSource,
    uri
  )) as AbapObjectSource
  return (source && source.source) || ""
}
