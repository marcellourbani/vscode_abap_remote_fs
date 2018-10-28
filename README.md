# ABAP remote filesystem for visual studio code

Ideally one day this will allow you to edit your ABAP code directly in Visual studio code
Very early stages, for now it only displays some packages and a handful of object types like programs, functions and classes

![anim](https://user-images.githubusercontent.com/2453277/47482169-ae0cc300-d82d-11e8-8d19-f55dd877c166.gif)
![image](https://user-images.githubusercontent.com/2453277/47466602-dd99dc00-d7e9-11e8-97ed-28e23dfd8f90.png)
syntax highlighting provided by [ABAP language extension](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap), picture was too lame without it :)

Sadly [ABAPlint](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abaplint) doesn't work over remote FS

## Features

Connect to your SAP server using the ADT interface

## setup

Too early to publish as an extension, there's a compiled extension you can run from source or install from the command line with

`code --install-extension vscode-abap-remote-fs-0.0.2.vsix`

Once installed you'll need an ABAP system with the ADT (Abap Developer Tools for eclipse) installed and SICF node `/sap/bc/adt` activated:

![image](https://user-images.githubusercontent.com/2453277/47607084-5760de00-da13-11e8-9c51-7e04eeff4299.png)

You will need connection details in your settings:

```json
  "abapfs.remote": {
    "NPL": {
      "url": "https://vhcalnplci.bti.local:8000",
      "username": "developer",
      "password": "secret"
    }
  }
```

## License

MIT license applies
