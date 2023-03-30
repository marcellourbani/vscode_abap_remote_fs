# ABAP remote filesystem for visual studio code (beta)

Turns Visual studio code into an IDE for ABAP development, operating directly on your SAP server.

Is less capable and more buggy than Eclipse with ADT, but also more responsive, and has a couple of extra features not found in Eclipse, like listing changed sources by transport and normalizing changes in diff views

> **Keyboard shortcuts changed F5 now starts debugger**

## Getting started

The easiest way is to first create a connection with an ABAP server by running command

> AbapFs Create connection

and follow the instructions, then run command

> AbapFs Connect to an ABAP system

to connect to it. Your abap code will appear in the file tree on the left.

You can also look up ABAP objects by name with command

> AbapFs Search for object

## Links

- [Getting started](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki/getting-started)
- [wiki/documentation](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki)
- [blog post by Leon Hassan](https://blogs.sap.com/2019/12/06/abap-development-in-vs-code)

**Unless your system is very modern (7.51 or later I think), write support will require you to install [this plugin](https://github.com/marcellourbani/abapfs_extensions)** in your dev server to enable. Browsing works even without it

![anim](https://user-images.githubusercontent.com/2453277/47482169-ae0cc300-d82d-11e8-8d19-f55dd877c166.gif) ![image](https://user-images.githubusercontent.com/2453277/47466602-dd99dc00-d7e9-11e8-97ed-28e23dfd8f90.png) syntax highlighting provided by [ABAP language extension](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap), picture was too lame without it :)

Compatibility with [abaplint](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abaplint) is limited by different naming conventions

## Features

- edit, create, search and delete ABAP objects
- syntax check with automatic fixing
- where used list
- transport management
- source control
- debugging
- view short dumps
- integrated with [abapGit](https://github.com/larshp/abapGit) (now using the scm view)
- integrated with [test explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer)
- execute select queries (Command "AbapFs Select Query")

![anim](https://user-images.githubusercontent.com/2453277/48232926-30a78d80-e3ab-11e8-8a12-00844431f9af.gif)

## setup

Check the system requirements on the [wiki](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki) and follow the [installation instructions](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki/installation)

You will end up with one or more server connections like this in your vs code configuration:

```json
{
  "abapfs.remote": {
    "NPL": {
      "url": "https://vhcalnplci:8000",
      "username": "developer",
      "password": "secret",
      "client": "001", // client is required for SAPGUI integration. Might need more
      "language": "EN",
      "allowSelfSigned": true
    }
  }
}
```

## Access over RFC

Not supported, but an user provided a [workaround](https://github.com/andwehrm/rfc-connector)

## Proxy support

There's no direct support for proxies in the application, but you can use the builtin proxy in vscode, just use the option 'Use the proxy support for extensions.' If you only want to do it for a single system you can do it in its workspace (and save it, which is a good idea anyway)

```json
{
  "http.proxySupport": "on",
  "http.proxy": "http://localhost:3128"
}
```

![image](https://user-images.githubusercontent.com/2453277/228667375-2c0d189e-3e08-4cbe-8307-721a7d4454f8.png)

## License

MIT license applies

some icons found in client/images are from [Material design](https://material.io) and subject to the [Apache license 2.0](https://www.apache.org/licenses/LICENSE-2.0.html)

## Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
