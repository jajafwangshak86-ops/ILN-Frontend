# Testing strategy

The repository uses a layered testing setup rather than a single test tool. Use the tool that matches the risk you are changing:

- Unit and integration tests with Vitest for utilities, hooks, and component behavior.
- Browser-level regression tests with Playwright for critical flows such as wallet connection, invoice workflows, governance, and responsive layouts.
- Accessibility checks with jest-axe for component-level accessibility regressions.
- Visual regression and UI documentation with Storybook plus Chromatic for high-risk components and design-system states.
- MSW to mock network responses where a real backend or contract node is unnecessary.

## When to use which tool

| Scenario                                               | Preferred tool        | Why                                                                                              |
| ------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------ |
| Pure logic, state hooks, or small component behavior   | Vitest                | Fast feedback, easy to run locally, and already used across `__tests__/` and `src/**/__tests__`. |
| Full user journey in a browser                         | Playwright            | Exercises real navigation and interaction across the app.                                        |
| Accessibility regressions for a component              | jest-axe              | Best fit for screen-reader and semantic HTML issues.                                             |
| UI consistency and visual diffs                        | Storybook + Chromatic | Lets contributors review component states and catch unintended styling changes.                  |
| API or contract responses that should be deterministic | MSW                   | Keeps tests isolated from external services and matches the current mock setup.                  |

## Test locations and conventions

### Vitest

Vitest suites live in the repository test folders and next to relevant source files:

- `__tests__/` for broader app-level, contract, and integration coverage.
- `src/**/__tests__/` for hooks, utilities, and focused component tests.

Run locally with:

```bash
pnpm test
pnpm test:watch
```

### Playwright

End-to-end tests live under `e2e/` and should focus on the user flows that are too expensive to prove with unit tests alone. Run them with:

```bash
pnpm run test:e2e
```

### Accessibility

Accessibility checks are integrated into the Vitest-based component test suites and should be used for UI changes that affect semantics, tab order, or ARIA state. The repo already depends on `jest-axe`.

### Admin authorization regression tests

Non-admin rejection is pinned by `src/lib/__tests__/admin-gate.test.ts` (server-safe gate: 403-shaped denials for non-admin, null, and disconnected wallets) and `src/utils/__tests__/admin-route-access.test.ts` (per-route access matrix plus fail-fast mutation guards on `setProtocolPaused` / `executeReadyProposals`). See the "Admin Route Authorization" section in [route-map.md](route-map.md) for the enforcement model these tests protect.

### Type-safety report

The consolidated before/after metrics for the `as any` hardening pass (66 → 30 casts, strictness flags enabled, lint gate) live in [type-safety-report.md](type-safety-report.md).

### Storybook and Chromatic

Storybook stories should be added alongside high-value components when the component has meaningful variations such as loading, empty, error, or success states. Start Storybook locally with:

```bash
pnpm run storybook
```

Use Chromatic in CI for visual regression review on the main branch and release branches.

## MSW and fixtures

The app already uses Mock Service Worker to stub network traffic in local tests and browser-based development. The handlers live in [src/mocks/handlers.ts](../src/mocks/handlers.ts), and the fixture data is stored under [src/mocks/fixtures](../src/mocks/fixtures). When adding a new test that depends on an API response:

1. Prefer extending the existing MSW handlers rather than adding ad-hoc fetch stubs inline.
2. Keep fixtures small and representative of the real schema.
3. Reuse the shared handlers for Stellar, leaderboard, and notification endpoints so tests stay consistent.

## Coverage gates

The contract integration workflow in [.github/workflows/contract-tests.yml](../.github/workflows/contract-tests.yml) runs Vitest with coverage against the contract-facing code paths and enforces a 90% coverage threshold. The gate is intentionally scoped to the contract layer (`src/utils/soroban`, `src/utils/contract-stats`, `src/utils/governance`, and `src/lib/contract`) because those modules carry the highest risk of regressions and are the most expensive to validate through UI-only tests.

### Phased coverage expansion — `src/hooks/` (issue #882)

`src/hooks/` contains 38 files and has tests for most hooks but previously had no enforced coverage floor. Coverage enforcement was added in phases to avoid an unrealistic jump from zero enforcement to a high threshold:

**Phase 1 (current — issue #882):** `src/hooks/**/*.ts` and `src/hooks/**/*.tsx` are added to the coverage `include` list. The global `branches` threshold is set at **50%** to establish a floor without breaking CI. The `lines`, `functions`, and `statements` thresholds remain at 90% (these are already satisfied by the existing hook test suite). The branches threshold is lower because several hooks (e.g. `useTransaction`, `useAdminActions`, `useContractEvents`) have complex conditional paths that require deep wallet/contract mocking to exercise fully.

**Phase 2 (target):** Once the low-coverage hooks gain additional test cases, raise the `branches` threshold to **≥ 70%**. At a minimum, add branch coverage for the primary error paths in `useTransaction` and `useAdminActions`.

**Phase 3 (final target):** Raise the `branches` threshold to **≥ 74%** to match the contract-layer interim floor, with the long-term goal of reaching 90% parity with the other metrics.

This is the same phased approach used for `src/utils/soroban.ts`, where 74% branches is the current, verified interim level (see inline comment in `vitest.config.ts`).

## Mutation testing

Line coverage tells you which code executed, **not** whether your tests would catch a bug. Mutation testing closes that gap: it intentionally introduces small faults (mutants) into the code and checks that at least one test fails. Survivors are tests that pass against broken code — the exact false-confidence trap that line coverage hides.

Run it with Stryker via the existing `test:mutation` script:

```bash
pnpm run test:mutation
```

### Score targets (baseline)

The mutation score is the percentage of mutants that were *killed* (caused a failing test). We hold two bars:

| Scope                                  | Target mutation score | Rationale                                                                 |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| App-wide                               | **≥ 80%**             | Baseline confidence across the general suite.                             |
| Contract / financial-critical layer    | **≥ 90%**             | `fundInvoice`, `markPaid`, and `castVote` move real money and must be defended harder (see below). |
| Governance module (`src/utils/governance.ts`) | **≥ 90%**  | Elevated bar per issue #741 for vote-casting and proposal-creation code.  |

> **Baseline capture:** the authoritative app-wide and per-module baseline numbers must be filled in here after a full `pnpm run test:mutation` run completes on `dev`. Copy the summary line from the Stryker report, e.g. `Mutation score: 84.2% (342/407 killed)`. Until that run happens, treat the targets above as the acceptance gates rather than the current measured score.

### Prioritised critical paths

When triaging survivors, work top-down by financial consequence:

1. **`fundInvoice`** (`src/utils/soroban.ts`) — LP provides liquidity to an invoice.
2. **`markPaid`** (`src/utils/soroban.ts`) — payer settles an invoice (full/partial).
3. **`castVote`** (`src/utils/governance.ts`) — governance vote casting; already covered by `src/utils/__tests__/governance.mutation.test.ts` which exercises every `VoteChoice` branch and the user-vote recording.

**Note:** `castVote` is protected by mutation testing with a ≥90% score as required for financial‑critical paths.

4. **`createProposal`** (`src/utils/governance.ts`) — proposal creation across all four form types (FeeRate / MaxDiscountRate / AddToken / RemoveToken).

Focus remediation on *genuinely dangerous* survivors (e.g. a mutated comparison or removed balance check in a money-moving path), not trivially-equivalent mutants. Each remediation should add a targeted test that kills the specific mutant rather than widening an existing assertion.

## Mock-backing detection

Mutation score and line coverage both stay high on a function that returns a `Math.random()` "transaction hash" without ever signing or submitting anything. To catch that in the function's own test file, use the shared helper in [`src/test-utils/mock-detection.ts`](../src/test-utils/mock-detection.ts) (issue #857):

```ts
import { detectMockBacking, expectMockBackingStatus } from '@/test-utils/mock-detection';

const signTx = vi.fn(async (xdr: string) => 'signedXDR');
const report = await detectMockBacking({
  run: () => castVote(1, 'For', SIGNER, signTx),
  boundaries: { signTx },
});
expectMockBackingStatus('castVote', report, 'real');
```

`detectMockBacking` swaps `Math.random` for a seeded PRNG and runs the function three times (seed A, seed A again, seed B). It reports the function as mock-backed if:

- the returned identifier changes when only the `Math.random` seed changes (so it comes from `Math.random()`);
- the identifier changes between runs with the same seed (so it comes from `Date.now()`, `crypto`, or a similar source); or
- a boundary spy passed in `boundaries` (e.g. `signTx`, `rpc.Server.prototype.simulateTransaction`, `fetch`) is never called. Use `combineRecorders(...)` when any one of several transports is acceptable.

Pass `identify` to pick the identifier out of a structured result (e.g. `(r) => r.txHash`). For read paths that return no identifier, return `undefined` from it and rely on the boundaries.

`expectMockBackingStatus(name, report, status)` asserts against a recorded status:

- `'mock'`: the function is still a stub. The test passes while it stays mock-backed and **fails once it isn't**, asking you to flip the status to `'real'`.
- `'real'`: the function must not look mock-backed. This is the permanent state and catches regressions back to a mock.

The governance write paths (`castVote`, `executeProposal`, `createProposal`) and read paths (`fetchProtocolParameters`, `lookupToken`) are covered in `__tests__/contract/governance.test.ts` and `__tests__/contract/governance-extended.test.ts` under "mock-backing detection". Each is currently recorded as `'mock'` against its implementation issue (#839, #840, #841, #844, #845). The PR that lands a real implementation must flip that function's status to `'real'`, stubbing any RPC calls the new code makes so the boundaries are exercised offline. The detection tests will fail until that's done. Apply the same helper to any new contract-integration function.

## Recommended workflow for contributors

1. Start with a Vitest test for any bug fix or local logic change.
2. Add or update Playwright coverage when the change affects an end-to-end user journey.
3. Add a Storybook story when the change introduces new component states or visual variants.
4. Run the relevant test command before opening a PR.

## Snapshot test review discipline

Snapshot files (`__tests__/__snapshots__/`) must be reviewed carefully in every PR — silently accepting snapshot updates is a known anti-pattern that can mask regressions.

### PR author responsibilities

- When a PR modifies `*.snap` files, the PR description **must** explain what changed and why. Example:
  ```
  ## Snapshot updates
  - `Hero.snapshot.test.tsx.snap`: Updated to reflect new CTA button color (#3b82f6 → #6366f1) per design system v2 migration.
  ```
- If snapshot changes are purely mechanical (e.g. running `--update` after an upgrade), state that explicitly.

### Reviewer responsibilities

- Treat snapshot diffs the same as code diffs — verify the change is intentional.
- Reject PRs that update snapshots without a corresponding code or design change.
- If a snapshot diff is large and hard to read, ask the author to explain the key changes inline.

### CI annotation

The CI pipeline flags PRs that touch snapshot files in the job summary, prompting explicit reviewer attention before merge.

## Common commands

```bash
pnpm test
pnpm run test:e2e
pnpm run test:mutation
pnpm run storybook
pnpm run build-storybook
```
