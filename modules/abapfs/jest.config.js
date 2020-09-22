// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html
const { existsSync } = require("fs")
const setupFiles = ["./setenv.js"].filter(existsSync)

module.exports = {
  // A set of global variables that need to be available in all test environments
  globals: {
    preset: "ts-jest",
    "ts-jest": {
      tsConfig: "tsconfig.json"
    }
  },

  // An array of directory names to be searched recursively up from the requiring module's location
  moduleDirectories: ["node_modules"],

  // An array of file extensions your modules use
  moduleFileExtensions: ["ts", "tsx", "js", "json"],

  // The test environment that will be used for testing
  testEnvironment: "node",

  // The paths to modules that run some code to configure or set up the testing environment before each test
  setupFiles,

  // The glob patterns Jest uses to detect test files
  testMatch: ["**/__tests__/*.+(ts|tsx|js)", "**/*.test.ts"],

  moduleNameMapper: {
    vscode: "<rootDir>/out/tests/vscode_alias_for_test.js"
  },

  // A map from regular expressions to paths to transformers
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
}
