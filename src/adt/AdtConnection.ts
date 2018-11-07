import * as request from "request"
import { Uri } from "vscode"
import { RemoteConfig } from "../config"
import { AdtException, AdtHttpException } from "./AdtExceptions"
import { Response } from "request"

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
    return this.myrequest(path, method, config)
  }

  private myrequest(
    path: string,
    method: string = "GET",
    options: request.CoreOptions = {}
  ): Promise<request.Response> {
    const { headers, ...rest } = options
    const urlOptions: request.OptionsWithUrl = {
      ...rest,
      url: this.url + path,
      jar: true,
      auth: {
        user: this.username,
        pass: this.password
      },
      method,
      headers: {
        ...headers,
        "x-csrf-token": this._csrftoken,
        Accept: "*/*"
      }
    }

    return new Promise<Response>((resolve, reject) => {
      request(urlOptions, async (error, response, body) => {
        if (error) reject(error)
        //TODO:support 304 non modified? Should only happen if I send a header like
        //If-None-Match: 201811061933580005ZDEMO_CALENDAR
        else if (response.statusCode < 300) resolve(response)
        else
          try {
            reject(await AdtException.fromXml(body))
          } catch (e) {
            reject(new AdtHttpException(response))
          }
      })
    })
  }

  connect(): Promise<request.Response> {
    return this.myrequest("/sap/bc/adt/compatibility/graph").then(
      (response: request.Response) => {
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
      }
    )
  }

  setStatus(newStatus: ConnStatus): any {
    this._status = newStatus
    this._listeners.forEach(l => l())
  }

  static fromRemote(config: RemoteConfig) {
    const connection = new AdtConnection(
      config.name,
      config.url,
      config.username,
      config.password
    )

    return connection
  }
}
