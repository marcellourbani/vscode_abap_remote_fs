// @ts-check

"use strict"

const path = require("path")
const TerserPlugin = require("terser-webpack-plugin")

/**@type {import('webpack').Configuration}*/
const config = {
  target: "web", // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: "./src/extension.ts", // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode" // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"],
    fallback: {
      crypto: false,
      util: false,
      child_process: false,
      net: false,
      zlib: false,
      os: false,
      url: false,
      tls: false,
      dns: false,
      assert: false,
      readline: false,
      querystring: false,
      constants: false,
      http: false,
      fs: false,
      path: false,
      https: false,
      stream: false
    }
  },
  watchOptions: {
    ignored: /node_modules|out/
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /.*\.test\.(d\.)[tj]s/],
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: false
            }
          }
        ]
      }
    ]
  }
}

/**@type {import('webpack').Configuration}*/
const prodConfig = {
  ...config,
  name: "production",
  mode: "production",
  optimization: {
    minimizer: [
      compiler => {
        new TerserPlugin({
          parallel: true,
          terserOptions: {
            keep_classnames: true
          }
        }).apply(compiler)
      }
    ]
  }
}
/**@type {import('webpack').Configuration}*/
const devConfig = {
  ...config,
  name: "development",
  mode: "development",
  infrastructureLogging: { level: "verbose" }
}
module.exports = [devConfig, prodConfig]
