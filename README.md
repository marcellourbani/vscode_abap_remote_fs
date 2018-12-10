# ABAP remote filesystem for visual studio code

This extension allows editing and activation of ABAP code on your server directly in Visual studio code, including transport assignment and creation (if your system supports it).

**Unless your system is very modern, write support will require you to install [this extension](https://github.com/marcellourbani/abapfs_extensions)** in your dev server to enable locking files

**THIS SOFTWARE IS IN BETA TEST, USE AT YOUR OWN RISK**

![anim](https://user-images.githubusercontent.com/2453277/47482169-ae0cc300-d82d-11e8-8d19-f55dd877c166.gif)
![image](https://user-images.githubusercontent.com/2453277/47466602-dd99dc00-d7e9-11e8-97ed-28e23dfd8f90.png)
syntax highlighting provided by [ABAP language extension](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap), picture was too lame without it :)

Sadly [ABAPlint](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abaplint) doesn't work over remote FS

## Features

Connect to your SAP server using the ADT interface, edit, save and activate files
The complete list of editable objects depends on your installation, on my local 7.51 works for:

- programs/includes
- function groups
- classes
- transformations (except creation)

![anim](https://user-images.githubusercontent.com/2453277/48232926-30a78d80-e3ab-11e8-8a12-00844431f9af.gif)

## setup

Will soon be published in the marketplace, in the meanwhile there's a compiled extension you can run from source or install from the command line with

```shell
code --install-extension vscode-abap-remote-fs-0.3.0.vsix
```

The compiled file can be either downloaded from for the
[releases](https://github.com/marcellourbani/vscode_abap_remote_fs/releases) or
built by the following commands:

```shell
npm install
npm run build
```

Once installed you'll need an ABAP system with the ADT (Abap Developer Tools for eclipse) installed and SICF node `/sap/bc/adt` activated:

![image](https://user-images.githubusercontent.com/2453277/47607084-5760de00-da13-11e8-9c51-7e04eeff4299.png)

You will need connection details in your settings:

```json
{
  "abapfs.remote": {
    "NPL": {
      "url": "https://vhcalnplci.bti.local:8000",
      "username": "developer",
      "password": "secret"
    }
  }
}
```

## License

MIT license applies
