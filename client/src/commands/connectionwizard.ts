import { AbapServiceKey, cfCodeGrant, CfEntity, CfInfo, cfInfo, cfInstanceServiceKeyCreate, cfInstanceServiceKeys, CfOrganizationEntity, cfOrganizations, cfPasswordGrant, CfResource, CfServiceEntity, CfServiceInstanceEntity, cfServiceInstances, cfServices, CfSpaceEntity, cfSpaces, getAbapSystemInfo, getAbapUserInfo, isAbapEntity, isAbapServiceKey, loginServer } from "abap_cloud_platform";
import { Token } from "client-oauth2";
import { isLeft } from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import { none } from "fp-ts/lib/Option";
import { bind, chain, map } from "fp-ts/lib/TaskEither";
import { ConfigurationTarget, QuickPickItem, Uri, workspace } from "vscode";
import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi";
import { saveNewRemote, validateNewConfigId } from "../config";
import {
    after, inputBox, isString, openDialog, quickPick, rfsChainE, rfsExtract, rfsTaskEither, RfsTaskEither,
    rfsTryCatch, rfsWrap
} from "../lib";

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
        const sk = s.selected?.entity
        if (isAbapEntity(sk)) return sk.credentials
        if (s.name) {
            const key = await cfInstanceServiceKeyCreate(endpoint, instance, s.name, token)
            if (isAbapEntity(key.entity)) return key.entity.credentials
        }
        throw new Error("Invalid key");
    }

const selectKey = (endpoint: string, username: string, password: string) => {
    const keyselection = pipe(
        rfsTryCatch(() => cfInfo(endpoint).then(extractLink)),
        bind("token", rfsWrap(({ url }) => cfPasswordGrant(url, username, password))),
        bind("organizations", rfsWrap(x => cfOrganizations(endpoint, x.token.accessToken))),
        bind("organization", x => selectEntity(x.organizations, "Select organization")),
        bind("spaces", rfsWrap(x => cfSpaces(endpoint, x.organization.entity, x.token.accessToken))),
        bind("space", x => selectEntity(x.spaces, "Select space")),
        bind("instances", rfsWrap(x => cfServiceInstances(endpoint, x.space.entity, x.token.accessToken))),
        bind("services", rfsWrap(x => cfServices(endpoint, x.token.accessToken))),
        bind("keydetails", rfsWrap(extractKeyDetails(endpoint))),
        chain(x => {
            const hasName = <T extends { name: string }>(e: any): e is T => isString(e?.name)
            if (!x.keydetails) return rfsTaskEither(undefined)
            const create = { label: "Create a new key", entity: undefined }
            const keys = [...x.keydetails.keys.map(e => e.entity).filter(hasName).map(e => ({ label: e.name, entity: e })), create]
            return pipe(quickPick(keys, { placeHolder: "Select key" }),
                map(selected => ({ selected })),
                bind("name", s => s.selected === create ? inputBox({ prompt: "Key name" }) : rfsTaskEither("")),
                rfsChainE(entitySelector(endpoint, x.keydetails.abapServiceInstance, x.token.accessToken))
            )
        })
    )
    return keyselection
}

const configFromUrl = (url: string) => pipe(
    rfsTaskEither({ url }),
    bind("user", _ => inputBox({ prompt: "username" })),
    bind("password", _ => inputBox({ prompt: "password", password: true })),
    bind("key", y => selectKey(y.url, y.user, y.password)),
    chain(rfsWrap(x => configFromKey(x.key)))
)
const configFromKey = async (key: AbapServiceKey) => {
    const { url, uaa: { clientid, clientsecret, url: loginUrl } } = key
    const server = loginServer()
    const baseGrant = cfCodeGrant(loginUrl, clientid, clientsecret, server)
    const timeout = after(60000).then(() => {
        server.server.close()
        throw new Error("User logon timed out")
    })
    const grant = await Promise.race([baseGrant, timeout])
    const user = await getAbapUserInfo(url, grant.accessToken)
    const info = await getAbapSystemInfo(url, grant.accessToken)
    const config: ClientConfiguration = {
        name: info.SYSID,
        url,
        username: user.UNAME,
        password: "",
        language: "en",
        client: user.MANDT,
        allowSelfSigned: false,
        diff_formatter: "ADT formatter",
        oauth: {
            clientId: clientid,
            clientSecret: clientsecret,
            loginUrl,
            saveCredentials: true
        }

    }
    const languages = info.INSTALLED_LANGUAGES.map(l => l.ISOLANG.toLowerCase())
    return { config, languages }
}
const pickDestination = () => quickPick(["User", "Workspace"],
    { placeHolder: "Select destination file" },
    (d: any) => d === "User" ? ConfigurationTarget.Global : ConfigurationTarget.Workspace)
const inputName = <T extends { config: ClientConfiguration, destination: ConfigurationTarget }>(c: T) => inputBox({
    prompt: "Connection name",
    value: c.config.name,
    validateInput: validateNewConfigId(c.destination)
})
const saveCloudConfig = (cfg: RfsTaskEither<{ config: ClientConfiguration, languages: string[] }>) =>
    pipe(cfg,
        bind("destination", pickDestination),
        bind("name", inputName),
        bind("autoSave", _ => quickPick(["Yes", "No"], { placeHolder: "save credentials?" })),
        bind("language", c => quickPick(c.languages, { placeHolder: "Select language" })),
        map(x => {
            const { config, autoSave, name, destination, language } = x
            const oauth = config.oauth && { ...config.oauth, saveCredentials: autoSave === "Yes" }
            const newConfig = { ...config, name, oauth, language }
            return saveNewRemote(newConfig, destination)
        })
    )
const configFromFile = (name: RfsTaskEither<Uri>) => pipe(
    name,
    chain(loadFile),
    map((f) => {
        const key = JSON.parse(f)
        if (isAbapServiceKey(key)) return { key }
        throw new Error("File is not an ABAP service key");
    }),
    chain(rfsWrap(x => configFromKey(x.key)))
)
export const createConnection = async () => {
    const source = await pipe(
        quickPick(CONFIGSOURCES),
        chain(x => async () => {
            switch (x.key) {
                case "LOADKEY":
                    return pipe(openDialog({ title: "Service Key" }), configFromFile)()
                case "MANUAL":
                    return pipe(inputBox({ prompt: "Cloud instance endpoint" }), chain(configFromUrl))()
                case "URL":
                    return configFromUrl(x.url)()
            }
        }))
    const result = rfsExtract(await pipe(source, saveCloudConfig)())
    return result
}