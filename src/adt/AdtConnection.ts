import * as request from "request"
import { Uri } from "vscode"
import { RemoteConfig } from "../config"
import { AdtException, AdtHttpException, isAdtException } from "./AdtExceptions"
import { Response } from "request"

const CSRF_EXPIRED = "CSRF_EXPIRED"
const FETCH_CSRF_TOKEN = "fetch"
enum ConnStatus {
  new,
  active,
  failed
}
export interface StateRequestor {
  needStateFul: boolean
}
export class AdtConnection {
  readonly name: string
  readonly url: string
  readonly username: string
  readonly password: string

  get stateful() {
    for (const r of this._stateRequestors) if (r.needStateFul) return true
    return false
  }
  private _csrftoken: string = FETCH_CSRF_TOKEN
  private _status: ConnStatus = ConnStatus.new
  private _listeners: Array<Function> = []
  private _clone?: AdtConnection
  private _stateRequestors: Set<StateRequestor> = new Set()

  constructor(name: string, url: string, username: string, password: string) {
    this.name = name
    this.url = url
    this.username = username
    this.password = password
  }

  /**
   * get a stateless clone of the original connection
   *
   * some calls, like object creation must be done in a separate connection
   * to prevent leaving dirty data in function groups, which makes other calls fail
   */
  async getStatelessClone(): Promise<AdtConnection> {
    if (!this._clone) {
      this._clone = new AdtConnection(
        this.name + "_clone",
        this.url,
        this.username,
        this.password
      )
    }
    await this._clone.connect()
    return this._clone
  }

  addStateRequestor(r: StateRequestor) {
    this._stateRequestors.add(r)
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
            reject(connection)
        }
      }
      if (this._status === ConnStatus.new) {
        connection._listeners.push(respond)
      } else {
        respond()
      }
    })
  }

  async request(
    uri: Uri,
    method: string,
    config: request.Options | Object = {}
  ): Promise<request.Response> {
    if (this._status !== ConnStatus.active) await this.waitReady()
    const path = uri.query ? uri.path + "?" + uri.query : uri.path
    try {
      return await this.myrequest(path, method, config)
    } catch (e) {
      if (isAdtException(e) && e.type === CSRF_EXPIRED) {
        //Token expired, try getting a new one
        // only retry once!
        this._csrftoken = FETCH_CSRF_TOKEN
        await this.connect()
        return this.myrequest(path, method, config)
      } else throw e
    }
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
        "x-csrf-token": this._csrftoken,
        "X-sap-adt-sessiontype": this.stateful ? "stateful" : "",
        "Cache-Control": "no-cache",
        Accept: "*/*",
        ...headers
      }
    }

    return new Promise<Response>((resolve, reject) => {
      request(urlOptions, async (error, response, body) => {
        if (error) reject(error)
        else if (response.statusCode < 400) resolve(response)
        else if (response.statusCode === 403 && body.match(/CSRF.*failed/))
          reject(new AdtException(CSRF_EXPIRED, ""))
        else
          try {
            reject(await AdtException.fromXml(body))
          } catch (e) {
            reject(new AdtHttpException(response))
          }
      })
    })
  }
  createUri(path: string, query: string = "") {
    return Uri.parse("adt://" + this.name).with({
      path,
      query
    })
  }

  dropSession() {
    return this.myrequest(
      "/sap/bc/adt/repository/informationsystem/objecttypes",
      "GET",
      {
        headers: {
          "x-csrf-token": this._csrftoken,
          "X-sap-adt-sessiontype": "",
          Accept: "*/*"
        }
      }
    )
  }

  connect(): Promise<request.Response> {
    return this.myrequest(
      "/sap/bc/adt/repository/informationsystem/objecttypes?maxItemCount=999&name=*&data=usedByProvider"
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
