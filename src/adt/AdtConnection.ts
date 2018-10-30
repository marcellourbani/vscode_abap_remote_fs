import * as request from "request"
// import { AdtPathClassifier } from "./AdtPathClassifier"
import { Uri, FileSystemError } from "vscode"

enum ConnStatus {
  new,
  active,
  failed
}
export class AdtConnection {
  readonly name: string
  readonly url: string
  readonly username: string
  readonly password: string
  private _csrftoken: string = "fetch"
  private _status: ConnStatus = ConnStatus.new
  private _listeners: Array<Function> = []

  constructor(name: string, url: string, username: string, password: string) {
    this.name = name
    this.url = url
    this.username = username
    this.password = password
  }

  isActive(): boolean {
    return this._status === ConnStatus.active
  }

  waitReady(): Promise<AdtConnection> {
    const connection = this
    return new Promise((resolve, reject) => {
      const respond = () => {
        switch (connection._status) {
          case ConnStatus.active:
            resolve(connection)
          case ConnStatus.failed:
            resolve(connection)
        }
      }
      if (this._status === ConnStatus.new) {
        connection._listeners.push(respond)
      } else {
        respond()
      }
    })
  }

  request(
    uri: Uri,
    method: string,
    config: request.Options | Object = {}
  ): Promise<request.Response> {
    const path = uri.query ? uri.path + "?" + uri.query : uri.path
    return this.myrequest(this.createrequest(path, method, config))
  }

  private createrequest(
    path: string,
    method: string = "GET",
    config: request.Options | Object = {}
  ): request.Options {
    return {
      ...config,
      url: this.url + path,
      jar: true,
      auth: {
        user: this.username,
        pass: this.password
      },
      method,
      headers: {
        "x-csrf-token": this._csrftoken,
        Accept: "*/*"
      }
    } as request.Options //workaround for compiler bug
  }
  private myrequest(options: request.Options): Promise<request.Response> {
    return new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if (error) throw error
        if (response.statusCode < 300) resolve(response)
        else
          throw FileSystemError.NoPermissions(
            `Failed to connect to ${this.name}:${response.statusCode}:${
              response.statusMessage
            }`
          )
      })
    })
  }

  connect(): Promise<request.Response> {
    return this.myrequest(
      this.createrequest("/sap/bc/adt/compatibility/graph")
    ).then((response: request.Response) => {
      const newtoken = response.headers["x-csrf-token"]
      if (typeof newtoken === "string") {
        this._csrftoken = newtoken
      }
      if (response.statusCode < 300) {
        this.setStatus(ConnStatus.active)
      } else {
        this.setStatus(ConnStatus.failed)
      }
      return response
    })
  }
  setStatus(newStatus: ConnStatus): any {
    this._status = newStatus
    this._listeners.forEach(l => l())
  }
}
