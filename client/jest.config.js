// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  // name: "Client",
  // A set of global variables that need to be available in all test environments
  globals: {
    "ts-jest": {
      tsConfig: "tsconfig.json"
    }
  },

  // An array of directory names to be searched recursively up from the requiring module's location
  moduleDirectories: ["node_modules"],

  // An array of file extensions your modules use
  moduleFileExtensions: ["ts", "tsx", "js"],

  // The test environment that will be used for testing
  testEnvironment: "node",

  // The glob patterns Jest uses to detect test files
  testMatch: ["**/__tests__/*.+(ts|tsx|js)", "**/*.test.ts"],

  // A map from regular expressions to paths to transformers
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
}
