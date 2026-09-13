# Test-suite migration codemods

Six idempotent ts-morph codemods used to mass-migrate the test suite from
jest 29 to vitest 5.0.0-beta.4. All scripts walk
`{client,server,modules/{abapfs,abapObject}}/src/**/*.test.ts` from the repo
root and write changes in place.

## When to run

Run them only as a batch when migrating a test runner or when adopting the
same project conventions in a forked branch. Day-to-day test edits do NOT
need to invoke these.

## Run order

Run all commands FROM THE REPO ROOT. The codemods derive the repo root
from `process.cwd()` via `scripts/lib/projectRoot.ts` and fail fast if the
layout doesn't match.

```bash
# 1. jest.* -> vi.* (call sites, multi-line safe)
pnpm dlx tsx@4 scripts/jest-to-vitest-codemod.ts

# 2. jest.Mock / jest.Mocked* / jest.MockedFunction etc. (TYPE positions)
#    -> bare global names from vitest-shim.d.ts
fd '\.test\.ts$' client/src server/src modules/abapfs/src modules/abapObject/src \
  --no-ignore -x sd '\bjest\.(Mock|Mocked|MockedFunction|MockedClass|MockedObject|MockInstance)\b' '$1'

# 3. require("./X") inside test bodies -> await import("./X") + async-mark.
#    For modules vi.mock'd in the same file, top-level requires are also
#    converted (vitest's mock registry needs await import for re-evaluation).
pnpm dlx tsx@4 scripts/require-to-import-codemod.ts

# 4. vi.mock(spec, factory, { virtual: true }) -> vi.mock(spec, factory)
pnpm dlx tsx@4 scripts/drop-virtual-true-codemod.ts

# 5. Class-mock arrows -> function expressions (vitest 4+ class-mock
#    semantics: arrows can't be `new`'d).
pnpm dlx tsx@4 scripts/class-mock-fix-codemod.ts

# 6. (await import("X")) for vi.mock'd X -> top-level static import
#    `import * as __$mock_X from "X"`. Drops async from functions whose only
#    await was the import.
pnpm dlx tsx@4 scripts/hoist-mock-imports-codemod.ts

# 7. Top-level `const` declarations referenced inside vi.mock factories ->
#    wrapped in `vi.hoisted(() => ({ ... }))` so they're available before
#    the factory runs (vi.mock is hoisted to file top by vitest).
pnpm dlx tsx@4 scripts/hoist-vars-codemod.ts
```

## Idempotency

Each script is a no-op on already-migrated files. Re-running the chain on a
fully-migrated tree should print 0 changes from each step.

## Limitations (left for hand-fix)

- vi.mock factories that return only a default export (e.g. for CommonJS
  packages with `module.exports = SomeClass`): factory must return
  `{ default: ... }`. We did this by hand for `oauth.test.ts`.
- vi.mock placement inside `describe`/`beforeEach` blocks (vitest 5
  beta.4 enforces top-level): a few files needed the nested vi.mock
  removed manually.
- vi.hoisted blocks whose initializers reference *other* top-level
  `const`s: the codemod hoists what's directly referenced inside vi.mock
  factories, not transitive deps. If you see "Cannot access X before
  initialization" at runtime, hand-merge the relevant `const`s into one
  vi.hoisted block (logger.test.ts is an example).
- Source code that imports through deep build paths (`abapfs/out/...`,
  `abapobject/out/...`) needs the public package surface widened to
  cover the leaked symbols. We re-exported `ReloginError` and
  `LockStatus` from `abapfs` and `AbapObjectBase` is already on the
  public surface of `abapobject`.

See the migration commit messages for the full catalog of patterns and
caveats discovered during this run.
