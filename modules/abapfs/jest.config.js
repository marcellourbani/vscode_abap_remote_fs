// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html
import { existsSync } from "node:fs"
const setupFiles = ["./setenv.js"].filter(existsSync)

export default {
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
    "^(\\.{1,2}/.*)\\.js$": "$1",
    vscode: "<rootDir>/src/tests/vscode_alias_for_test.ts"
  },

  // A map from regular expressions to paths to transformers
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "tsconfig.test.json" }]
  }
}
