import { ADTClient, ClientOptions, createSSLConfig } from "abap-adt-api"
import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"
import { formatKey } from "../../config"
import { configFromKey } from "../../langClient"
import { futureToken } from "../../oauth"
import { createHash } from "crypto"

export const md5 = (s: string) => createHash('md5').update(s).digest("hex")

function createFetchToken(conf: ClientConfiguration) {
    if (conf.oauth)
        return () => futureToken(formatKey(conf.name)) as Promise<string>
}

export async function newClientFromKey(key: string, options: Partial<ClientOptions> = {}) {
    const conf = await configFromKey(key)
    if (conf) {
        const sslconf = conf.url.match(/https:/i)
            ? { ...options, ...createSSLConfig(conf.allowSelfSigned, conf.customCA) }
            : options
        const pwdOrFetch = createFetchToken(conf) || conf.password
        const client = new ADTClient(
            conf.url,
            conf.username,
            pwdOrFetch,
            conf.client,
            conf.language,
            sslconf
        )
        return client
    }
}
