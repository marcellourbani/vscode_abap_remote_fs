# ABAP remote filesystem for visual studio code (beta)

This extension allows editing and activation of ABAP code on your server directly in Visual studio code, including transport assignment and creation (if your system supports it).

**THIS SOFTWARE IS IN BETA TEST, USE AT YOUR OWN RISK**

## new in 0.5: Much better language support

- syntax checks
- completion
- go to definition
- usages

**Unless your system is very modern (7.51 or later I think), write support will require you to install [this plugin](https://github.com/marcellourbani/abapfs_extensions)** in your dev server to enable. Browsing works even without it

![anim](https://user-images.githubusercontent.com/2453277/47482169-ae0cc300-d82d-11e8-8d19-f55dd877c166.gif)
![image](https://user-images.githubusercontent.com/2453277/47466602-dd99dc00-d7e9-11e8-97ed-28e23dfd8f90.png)
syntax highlighting provided by [ABAP language extension](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap), picture was too lame without it :)

Compatibility with [ABAPlint](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abaplint) is limited by different naming conventions

## Features

Connect to your SAP server using the ADT interface, edit, save and activate files
The complete list of editable objects depends on your installation, on my local 7.52 works for:

- programs/includes
- function groups
- classes
- transformations (except creation)
- CDS and tables (display, didn't try saving)

Now includes ABAP language support!

![anim](https://user-images.githubusercontent.com/2453277/48232926-30a78d80-e3ab-11e8-8a12-00844431f9af.gif)

## setup

- install the extension from the visual studio marketplace
- on your dev system, make sure that in transaction SICF node `/sap/bc/adt` is active, like in the image below

![image](https://user-images.githubusercontent.com/2453277/47607084-5760de00-da13-11e8-9c51-7e04eeff4299.png)

- create a configuration entry for your DEV system

```json
{
  "abapfs.remote": {
    "NPL": {
      "url": "https://vhcalnplci.bti.local:8000",
      "username": "developer",
      "password": "secret",
      "client": "001", // client is required for SAPGUI integration. Might need more
      "language": "EN",
      "allowSelfSigned": true
    }
  }
}
```

- to be able to save files you might need to install [this plugin](https://github.com/marcellourbani/abapfs_extensions)

## License

MIT license applies
