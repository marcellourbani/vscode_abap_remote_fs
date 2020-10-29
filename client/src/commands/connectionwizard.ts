import { AbapServiceKey, CfEntity, CfInfo, cfInfo, cfInstanceServiceKeyCreate, cfInstanceServiceKeys, CfOrganizationEntity, cfOrganizations, cfPasswordGrant, CfResource, CfServiceEntity, CfServiceInstanceEntity, cfServiceInstances, cfServices, CfSpaceEntity, cfSpaces, isAbapEntity, isAbapServiceKey } from "abap_cloud_platform";
import { Token } from "client-oauth2";
import { isLeft } from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import { none } from "fp-ts/lib/Option";
import { chain, map } from "fp-ts/lib/TaskEither";
import { QuickPickItem, Uri, workspace } from "vscode";
import { chainField, chainFieldTE, inputBox, isString, openDialog, quickPick, rfsChainE, rfsTaskEither, RfsTaskEither, rfsTryCatch } from "../lib";
interface SimpleSource extends QuickPickItem { key: "LOADKEY" | "MANUAL" }
interface UrlSource extends QuickPickItem { key: "URL", url: string }
type Source = SimpleSource | UrlSource
const CONFIGSOURCES: Source[] = [
    { label: "load service key", key: "LOADKEY" },
    { label: "Europe Cloud trial", key: "URL", url: "https://api.cf.eu10.hana.ondemand.com" },
    { label: "USA Cloud trial", key: "URL", url: "https://api.cf.us10.hana.ondemand.com" },
    { label: "enter connection endpoint", key: "MANUAL" }]

const loadFile = (u: Uri): RfsTaskEither<string> =>
    rfsTryCatch(async () => workspace.fs.readFile(u).then(a => a.toString()))
interface CfDetails {
    services?: CfResource<CfServiceEntity>[];
    instances?: CfResource<CfServiceInstanceEntity>[];
    spaces?: CfResource<CfSpaceEntity>[];
    organizations?: CfResource<CfOrganizationEntity>[];
    keys?: CfResource<CfEntity>[];
    token?: Token;
    url: string,
}

const selectEntity = <T extends { name: string }>(sources: CfResource<T>[], placeHolder: string) => {
    const source = sources.map(e => ({ label: e.entity.name, entity: e }))
    return quickPick(source, { placeHolder }, s => s.entity)
}
const findAbapTag = (tags: string[]) => tags && tags.find(t => t === "abapcp")
const extractLink = (i: CfInfo) => i.links.login?.href ? { url: i.links.login?.href } : undefined
interface Dummy {
    services: CfResource<CfServiceEntity>[],
    instances: CfResource<CfServiceInstanceEntity>[],
    token: Token
}

const extractKeyDetails = (endpoint: string) => async <T extends Dummy>(x: T) => {
    const abapService = x.services.find(s => findAbapTag(s.entity.tags))
    if (!abapService) return
    const abapServiceInstance = x.instances.find(
        i => i.entity.service_guid === abapService?.metadata.guid
    )
    if (!abapServiceInstance) return
    const keys = await cfInstanceServiceKeys(
        endpoint,
        abapServiceInstance.entity,
        x.token.accessToken
    )
    return { abapService, abapServiceInstance, keys }
}

const entitySelector = (endpoint: string, instance: CfResource<CfServiceInstanceEntity>, token: string) =>
    async <T extends { name: string, selected: any }>(s: T): Promise<AbapServiceKey> => {
        if (isAbapEntity(s.selected.entity)) return s.selected.entity
        if (s.name) {
            const key = await cfInstanceServiceKeyCreate(endpoint, instance, s.name, token)
            if (isAbapEntity(key.entity)) return key.entity.credentials
        }
        throw new Error("Invalid key");
    }

const selectKey = (endpoint: string, username: string, password: string) => {
    const keyselection = pipe(
        rfsTryCatch(() => cfInfo(endpoint).then(extractLink)),
        chainField("token", async ({ url }) => cfPasswordGrant(url, username, password)),
        chainField("organizations", async x => cfOrganizations(endpoint, x.token.accessToken)),
        chainFieldTE("organization", x => selectEntity(x.organizations, "Select organization")),
        chainField("spaces", x => cfSpaces(endpoint, x.organization.entity, x.token.accessToken)),
        chainFieldTE("space", x => selectEntity(x.spaces, "Select space")),
        chainField("instances", x => cfServiceInstances(endpoint, x.space.entity, x.token.accessToken)),
        chainField("services", x => cfServices(endpoint, x.token.accessToken)),
        chainField("keydetails", extractKeyDetails(endpoint)),
        chain(x => {
            const hasName = <T extends { name: string }>(e: any): e is T => isString(e?.name)
            if (!x.keydetails) return rfsTaskEither(undefined)
            const create = { label: "Create a new key", entity: undefined }
            const keys = [...x.keydetails.keys.map(e => e.entity).filter(hasName).map(e => ({ label: e.name, entity: e })), create]
            return pipe(quickPick(keys, { placeHolder: "Select key" }),
                map(selected => ({ selected })),
                chainFieldTE("name", s => s.selected === create ? inputBox({ prompt: "Key name" }) : rfsTaskEither("")),
                rfsChainE(entitySelector(endpoint, x.keydetails.abapServiceInstance, x.token.accessToken))
            )
        })
    )
    return keyselection
}

const keyFromUrl = (url: string) => pipe(
    rfsTaskEither({ url }),
    chainFieldTE("user", _ => inputBox({ prompt: "username" })),
    chainFieldTE("password", _ => inputBox({ prompt: "password", password: true })),
    chainFieldTE("key", y => selectKey(y.url, y.user, y.password))
)
const keyFromFile = (name: RfsTaskEither<Uri>) => pipe(
    name,
    chain(loadFile),
    map((f) => {
        const key = JSON.parse(f)
        if (isAbapServiceKey(key)) return { key }
        throw new Error("File is not an ABAP service key");
    })
)
export const createConnection = async () => {
    const source = await pipe(
        quickPick(CONFIGSOURCES),
        chain(x => async () => {
            switch (x.key) {
                case "LOADKEY":
                    return pipe(openDialog({ title: "Service Key" }), keyFromFile)()
                case "MANUAL":
                    return pipe(inputBox({ prompt: "Cloud instance endpoint" }), chain(keyFromUrl))()
                case "URL":
                    return keyFromUrl(x.url)()
            }
        }))()
    if (isLeft(source)) { if (source.left !== none) throw source.left }
    else {
        const { url, uaa: { clientid, clientsecret, url: loginUrl } } = source.right.key
    }
}