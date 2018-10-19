# ABAP remote filesystem for visual studio code

Ideally one day this will allow you to edit your ABAP code directly in Visual studio code
Very early stages, for now it only displays a list of packages

## Features

Connect to your SAP server using the ADT interface

## setup

You will need connection details in your settings:

```json
  "abapfs.remote": {
    "NPL": {
      "url": "http://vhcalnplci.bti.local:8000",
      "username": "developer",
      "password": "secret"
    }
  }
```

## License

MIT license applies
