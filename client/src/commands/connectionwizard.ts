import { AbapServiceKey, cfCodeGrant, CfInfo, cfInfo, cfInstanceServiceKeyCreate, cfInstanceServiceKeys, cfOrganizations, cfPasswordGrant, CfResource, CfServiceEntity, CfServiceInstanceEntity, cfServiceInstances, cfServices, cfSpaces, getAbapSystemInfo, getAbapUserInfo, isAbapEntity, isAbapServiceKey, loginServer } from "abap_cloud_platform"
import { Token } from "client-oauth2"
import { pipe } from "fp-ts/lib/function"
import { bind, chain, map } from "fp-ts/lib/TaskEither"
import { ConfigurationTarget, QuickPickItem, Uri, workspace } from "vscode"
import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"
import { saveNewRemote, validateNewConfigId } from "../config"
import {
    after, askConfirmation, inputBox, isString, openDialog, quickPick, rfsChainE, rfsExtract, rfsTaskEither, RfsTaskEither,
    rfsTryCatch, rfsWrap
} from "../lib"

interface SimpleSource extends QuickPickItem { key: "LOADKEY" | "MANUAL" | "NONCLOUD" }
interface UrlSource extends QuickPickItem { key: "URL", url: string }
type Source = SimpleSource | UrlSource
const CONFIGSOURCES: Source[] = [
    { label: "Known application server", key: "NONCLOUD" },
    { label: "Cloud instance - load service key from file", key: "LOADKEY" },
    { label: "Cloud instance - Europe trial", key: "URL", url: "https://api.cf.eu10.hana.ondemand.com" },
    { label: "Cloud instance - USA trial", key: "URL", url: "https://api.cf.us10.hana.ondemand.com" },
    { label: "Cloud instance - enter connection endpoint", key: "MANUAL" }]

const loadFile = (u: Uri): RfsTaskEither<string> =>
    rfsTryCatch(async () => workspace.fs.readFile(u).then(a => a.toString()))

const selectEntity = <T extends { name: string }>(sources: CfResource<T>[], placeHolder: string) => {
    const source = sources.map(e => ({ label: e.entity.name, entity: e }))
    return quickPick(source, { placeHolder, bypassIfSingle: true }, s => s.entity)
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
        throw new Error("Invalid key")
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
const inputUrl = () => inputBox({
    prompt: "Server base URL (same as the beginning of your Fiori pages)",
    value: "http://localhost:8000",
    validateInput: (url: string) => url && url.match(/^http(s)?:\/\/[\w\.-]+(:\d+)?$/i) ? "" : "Format: http(s)://domain[:port], i.e. https://myserver.com:44311"
})
const ignoreSSL = <T extends { url: string }>({ url }: T) =>
    url.match(/^https:\/\//i) ? askConfirmation("Allow self signed certificates (NOT SAFE!)") : rfsTaskEither(false)
const inputClient = () => inputBox({
    prompt: "Client",
    validateInput: (x: string) => x !== "000" && x.match(/^\d\d\d$/) ? "" : "Client must be a 3 digit number number from 001 to 999"
})
const inputLanguage = () => inputBox({
    prompt: "Enter connection language",
    validateInput: (x: string) => x.match(/^[a-z][a-z]$/) ? "" : "Language code must be 2 lowercase letters"
})

const localConfig = () =>
    pipe(rfsTaskEither({}),
        bind("url", inputUrl),
        bind("username", () => inputBox({ prompt: "User name" })),
        // bind("password", () => inputBox({ prompt: "Password", password: true })),
        bind("client", inputClient),
        bind("language", inputLanguage),
        bind("allowSelfSigned", ignoreSSL),
        map(({ url, username, allowSelfSigned, client, language }) => {
            const config: ClientConfiguration = {
                name: "",
                url,
                username,
                password: "",
                language,
                client,
                allowSelfSigned,
                diff_formatter: "ADT formatter"
            }
            return { config }
        })
    )

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
        bind("saveCredentials", _ => askConfirmation("save credentials?")),
        bind("language", c => quickPick(c.languages, { placeHolder: "Select language" })),
        map(x => {
            const { config, saveCredentials, name, destination, language } = x
            const oauth = config.oauth && { ...config.oauth, saveCredentials }
            const newConfig = { ...config, name, oauth, language }
            return saveNewRemote(newConfig, destination)
        })
    )
const saveLocal = (cfg: RfsTaskEither<{ config: ClientConfiguration }>) =>
    pipe(cfg,
        bind("destination", pickDestination),
        bind("name", inputName),
        map(x => {
            const { config, name, destination } = x
            const newConfig = { ...config, name }
            return saveNewRemote(newConfig, destination)
        })
    )

const configFromFile = (name: RfsTaskEither<Uri>) => pipe(
    name,
    chain(loadFile),
    map((f) => {
        const key = JSON.parse(f)
        if (isAbapServiceKey(key)) return { key }
        throw new Error("File is not an ABAP service key")
    }),
    chain(rfsWrap(x => configFromKey(x.key)))
)
export const createConnection = async () => {
    const source = await pipe(
        quickPick(CONFIGSOURCES),
        chain(x => async () => {
            switch (x.key) {
                case "LOADKEY":
                    return pipe(openDialog({ title: "Service Key" }), configFromFile, saveCloudConfig)()
                case "MANUAL":
                    return pipe(inputBox({ prompt: "Cloud instance endpoint" }), chain(configFromUrl), saveCloudConfig)()
                case "URL":
                    return pipe(configFromUrl(x.url), saveCloudConfig)()
                case "NONCLOUD":
                    return pipe(localConfig(), saveLocal)()
            }
        }))
    const result = rfsExtract(await source())
    return result
}