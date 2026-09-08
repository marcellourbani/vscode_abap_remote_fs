import * as path from "path"
import { buildTestFolderTsconfig, RuntimePaths } from "./testFolderScaffold"

const folder = path.resolve("test-workspace")
const paths: RuntimePaths = {
  runtimeDir: path.resolve("extension/dist/runtime"),
  playwrightDir: path.resolve("extension/dist/vendor/node_modules/playwright"),
  typesDir: path.resolve("extension/dist/vendor/node_modules/@types")
}
const forward = (value: string) => value.replace(/\\/g, "/")

describe("testing-folder compiler configuration", () => {
  test("creates a modern, non-emitting Node configuration without baseUrl", () => {
    const result = buildTestFolderTsconfig(paths, null, folder)
    expect(result.compilerOptions).toMatchObject({
      module: "Node16",
      moduleResolution: "node16",
      target: "ES2022",
      rootDir: ".",
      noEmit: true,
      types: ["node"]
    })
    expect(result.compilerOptions.baseUrl).toBeUndefined()
    expect(result.compilerOptions.paths["@sap-testing/runtime"]).toEqual([
      forward(paths.runtimeDir)
    ])
    expect(result.compilerOptions.paths["@playwright/test"]).toBeUndefined()
  })

  test.each(["node", "node10", "classic", "Node"])("migrates existing %s settings", resolution => {
    const result = buildTestFolderTsconfig(
      paths,
      {
        compilerOptions: { module: "commonjs", moduleResolution: resolution, baseUrl: "." }
      },
      folder
    )
    expect(result.compilerOptions.module).toBe("Node16")
    expect(result.compilerOptions.moduleResolution).toBe("node16")
    expect(result.compilerOptions.baseUrl).toBeUndefined()
  })

  test.each([
    ["NodeNext", "nodenext"],
    ["Node16", "node16"],
    ["Node18", "node16"],
    ["Node20", "node16"],
    ["preserve", "bundler"],
    ["commonjs", "bundler"]
  ])("preserves the modern %s/%s combination", (module, moduleResolution) => {
    const result = buildTestFolderTsconfig(
      paths,
      { compilerOptions: { module, moduleResolution } },
      folder
    )
    expect(result.compilerOptions).toMatchObject({ module, moduleResolution })
  })

  test("keeps ES modules when replacing their legacy resolver", () => {
    const result = buildTestFolderTsconfig(
      paths,
      {
        compilerOptions: { module: "ESNext", moduleResolution: "node" }
      },
      folder
    )
    expect(result.compilerOptions).toMatchObject({ module: "ESNext", moduleResolution: "bundler" })
  })

  test("preserves custom aliases and baseUrl semantics without mutating input", () => {
    const existing = {
      compilerOptions: {
        baseUrl: "./src",
        strict: true,
        types: ["jest"],
        paths: { "@helpers/*": ["helpers/*"] },
        typeRoots: ["./custom-types"]
      },
      include: ["specs/**/*.ts"]
    }
    const before = JSON.stringify(existing)
    const result = buildTestFolderTsconfig(paths, existing, folder)
    expect(JSON.stringify(existing)).toBe(before)
    expect(result.compilerOptions.paths["@helpers/*"]).toEqual([
      forward(path.join(folder, "src/helpers/*"))
    ])
    expect(result.compilerOptions.paths["*"]).toEqual([forward(path.join(folder, "src/*"))])
    expect(result.compilerOptions.types).toEqual(["node", "jest"])
    expect(result.compilerOptions.typeRoots).toEqual([forward(paths.typesDir)])
    expect(result.compilerOptions.strict).toBe(true)
    expect(result.include).toEqual(existing.include)
    expect(result.compilerOptions.baseUrl).toBeUndefined()
  })

  test("replaces accumulated type roots in an existing folder without mutating it", () => {
    const existing = {
      compilerOptions: {
        typeRoots: [
          forward(paths.typesDir),
          "C:\\extensions\\abapfs-old\\client\\dist\\vendor\\node_modules\\@types",
          "/extensions/abapfs-older/client/dist/vendor/node_modules/@types"
        ]
      }
    }
    const before = JSON.stringify(existing)
    const result = buildTestFolderTsconfig(paths, existing, folder)
    expect(result.compilerOptions.typeRoots).toEqual([forward(paths.typesDir)])
    expect(buildTestFolderTsconfig(paths, result, folder)).toEqual(result)
    expect(JSON.stringify(existing)).toBe(before)
  })

  test("is idempotent and refreshes only the managed extension paths", () => {
    const first = buildTestFolderTsconfig(paths, null, folder)
    expect(buildTestFolderTsconfig(paths, first, folder)).toEqual(first)
    const nextPaths = {
      ...paths,
      runtimeDir: path.resolve("new-extension/runtime"),
      typesDir: path.resolve("new-extension/vendor/node_modules/@types")
    }
    const updated = buildTestFolderTsconfig(nextPaths, first, folder)
    expect(updated.compilerOptions.paths["@sap-testing/runtime"]).toEqual([
      forward(path.resolve("new-extension/runtime"))
    ])
    expect(updated.compilerOptions.typeRoots).toEqual([forward(nextPaths.typesDir)])
    expect(first.compilerOptions.typeRoots).toEqual([forward(paths.typesDir)])
    expect(buildTestFolderTsconfig(nextPaths, updated, folder)).toEqual(updated)
  })
})
