import { CfEntity, cfInfo, cfInstanceServiceKey, cfInstanceServiceKeys, CfOrganizationEntity, cfOrganizations, cfPasswordGrant, CfResource, CfServiceEntity, CfServiceInstanceEntity, cfServiceInstances, cfServices, CfSpaceEntity, cfSpaces } from "abap_cloud_platform";
import { Token } from "client-oauth2";
import { left, right } from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import { bind, bindTo, chain } from "fp-ts/lib/TaskEither";
import { QuickPickItem, Uri, workspace } from "vscode";
import { chainTaskTransformers, fieldReplacer, inputBox, openDialog, quickPick, rfsChain, RfsTaskEither, rfsTryCatch } from "../lib";
import { command, AbapFsCommands } from "./registry";
interface SimpleSource extends QuickPickItem { key: "LOADKEY" | "MANUAL" }
interface UrlSource extends QuickPickItem { key: "URL", url: string }
type Source = SimpleSource | UrlSource
const CONFIGSOURCES: Source[] = [
    { label: "load service key", key: "LOADKEY" },
    { label: "Europe Cloud trial", key: "URL", url: "https://api.cf.eu10.hana.ondemand.com" },
    { label: "USA Cloud trial", key: "URL", url: "https://api.cf.us10.hana.ondemand.com" },
    { label: "enter connection endpoint", key: "MANUAL" }]

const sourceTourl = (s: Source) => async () => {
    if (s.key === "URL") return right(s.url)
    if (s.key === "MANUAL") return inputBox({ prompt: "Cloudfoundry API endpoint" })()
    return left(new Error("Unexpected selection"))
}
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

const uk = async (endpoint: string, username: string, password: string) => {
    const findAbapTag = (tags: string[]) => tags && tags.find(t => t === "abapcp")
    const details: CfDetails = {
        url: ""
    }
    const loadDetails = rfsTryCatch(async () => {
        const cfi = await cfInfo(endpoint)
        if (!cfi?.links.login?.href) return
        const cfdetails: CfDetails = {
            url: cfi.links.login?.href
        }
        return cfdetails
    })
    chainTaskTransformers<CfDetails>(
        // fieldReplacer("token", loadDetails),
        fieldReplacer("url", rfsTryCatch(() => cfInfo(endpoint).then(i => i.links.login?.href))),
    )
    // pipe(loadDetails, x)
    const foo = pipe(
        rfsTryCatch(() => cfInfo(endpoint).then(i => i.links.login?.href)),
        rfsChain((url: string) => cfPasswordGrant(url, username, password)),
        rfsChain((t: Token) => cfOrganizations(endpoint, t.accessToken))
    )
    const info = await cfInfo(endpoint)
    details.url = info.links.login!.href
    details.token = await cfPasswordGrant(details.url, username, password)
    details.organizations = await cfOrganizations(endpoint, details.token.accessToken)
    details.spaces = await cfSpaces(endpoint, details.organizations[0].entity, details.token.accessToken)
    details.instances = await cfServiceInstances(endpoint, details.spaces[0].entity, details.token.accessToken)
    details.services = await cfServices(endpoint, details.token.accessToken)
    const abapService = details.services.find(s => findAbapTag(s.entity.tags))
    const abapServiceInstance = details.instances.find(
        i => i.entity.service_guid === abapService?.metadata.guid
    )
    details.keys = await cfInstanceServiceKeys(
        endpoint,
        abapServiceInstance!.entity,
        details.token.accessToken
    )
    const abapServiceKey = await cfInstanceServiceKey(
        endpoint,
        abapServiceInstance!.entity,
        "SAP_ADT", // the one Eclipse usually creates
        details.token.accessToken
    )
}

const sourceToServiceKey = (s: Source): RfsTaskEither<string> => {
    return async () => {
        if (s.key === "LOADKEY")
            return chain(loadFile)(openDialog({ title: "Select service key" }))()

        return left(Error(""))
    };
}
const pickSource = async () => {
    const source = await quickPick(CONFIGSOURCES)()
    // bind((s: Source) => {
    //     return left(none)
    // })
}

class CloudConnectionWizard {
    @command(AbapFsCommands.createCloudConnection)
    private static createConnectionCommand() {
        return pickSource()
    }
}