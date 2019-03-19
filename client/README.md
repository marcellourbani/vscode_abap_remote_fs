# ABAP remote filesystem for visual studio code (beta)

This extension allows editing and activation of ABAP code on your server directly in Visual studio code, including transport assignment and creation (if your system supports it).

Warning: **THIS SOFTWARE IS IN BETA TEST, USE AT YOUR OWN RISK**

Please refer to the [wiki](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki) for system requirements, [installation](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki/installation) and [usage](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki/usage) instructions

## new in 0.5.19: CDS support

Creation, deletion and syntax check works, no completion or other helps

## new in 0.5.18: Run abap unit tests

Can be run from the menu or with hotkey ctrl+shift+F11 (sadly ctrl+shift+F10 was taken )

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

Check the system requirements on the [wiki](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki) and follow the [installation instructions](https://github.com/marcellourbani/vscode_abap_remote_fs/wiki/installation)

You will end up with one or more server connections like this in your vs code configuration:

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

## License

MIT license applies
some icons found in client/images are from [Material design](https://material.io) and subject to the [Apache license 2.0](https://www.apache.org/licenses/LICENSE-2.0.html)
