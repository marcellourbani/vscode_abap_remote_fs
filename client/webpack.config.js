// @ts-check

"use strict"

const path = require("path")
const TerserPlugin = require("terser-webpack-plugin")
const CopyPlugin = require("copy-webpack-plugin")

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node", // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
  
  // Enable webpack caching for faster builds
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename]
    }
  },

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
    vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    "@playwright/mcp": "commonjs @playwright/mcp",
    "@modelcontextprotocol/sdk/server/mcp.js": "commonjs @modelcontextprotocol/sdk/server/mcp.js",
    "@modelcontextprotocol/sdk/server/sse.js": "commonjs @modelcontextprotocol/sdk/server/sse.js",
    "@modelcontextprotocol/sdk/server/streamableHttp.js": "commonjs @modelcontextprotocol/sdk/server/streamableHttp.js",
    "zod": "commonjs zod"
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"]
  },
  watchOptions: {
    ignored: /node_modules|out/
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { 
          from: "media", 
          to: "media",
          noErrorOnMissing: true,
          force: true,
          priority: 0
        }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /.*\.test\.(d\.)[tj]s/, /media/],
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true
            }
          }
        ]
      }, {
        test: /\.(node)$/i,
        use: [
          {
            loader: 'file-loader',
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
          exclude: /media\/.*\.js$/,  // Exclude media JS files from minification
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
