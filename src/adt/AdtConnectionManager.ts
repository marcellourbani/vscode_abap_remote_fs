import { AdtConnection } from "./AdtConnection"
import { getRemoteList } from "../config"

export class AdtConnectionManager {
  private connections = new Map<string, AdtConnection>()
  private static _instance: AdtConnectionManager
  static getManager(): AdtConnectionManager {
    if (!AdtConnectionManager._instance) {
      AdtConnectionManager._instance = new AdtConnectionManager()
    }
    return AdtConnectionManager._instance
  }
  private nameFromUrl(url: string): string {
    const matches = url.match("adt://([a-zA-Z0-9]+)/")
    return (matches && matches.length > 0 ? matches[1] : url).toLowerCase()
  }

  getConn(name: string): AdtConnection | undefined {
    let connection = this.connections.get(this.nameFromUrl(name))
    return connection
  }

  findConn(name: string): Promise<AdtConnection> {
    return new Promise(resolve => {
      let connection = this.getConn(name)
      if (connection) {
        connection.waitReady().then(resolve)
      } else {
        const configname = this.nameFromUrl(name)
        getRemoteList()
          .filter(config => config.name.toLowerCase() === configname)
          .some(config => {
            this.setConn(config)
              .then(conn => conn.waitReady())
              .then(conn => {
                resolve(conn)
              })
            return true
          })
      }
    })
  }

  setConn(config: any): Promise<AdtConnection> {
    const connection = new AdtConnection(
      config.name,
      config.url,
      config.username,
      config.password
    )

    this.connections.set(config.name.toLowerCase(), connection)
    return connection.connect().then(() => {
      return connection
    })
  }
}
