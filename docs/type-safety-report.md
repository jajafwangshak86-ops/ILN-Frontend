# Type-Safety Before/After Report (`as any` Hardening Pass)

**Closing artifact for #913.** Quantifies the improvement delivered by this
category's work (#906 inventory → #907, #908/#909 elimination batches, #910
third-party-gap documentation, #911 lint gate, #912 strictness flags).

## Before / after metrics

Scope for both counts: all `*.ts` / `*.tsx` files **outside** test suites
(`__tests__/`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`).

| Metric                                        | Before (#906 baseline) | After                                                                                      | Δ              |
| :-------------------------------------------- | :--------------------- | :----------------------------------------------------------------------------------------- | :------------- |
| Total `as any` casts                          | **66**                 | **30**                                                                                     | **−36 (−55%)** |
| Production casts (excl. Storybook stories)    | 39                     | **3**                                                                                      | −36 (−92%)     |
| Storybook story casts                         | 27                     | 27 (unchanged, Tier 4)                                                                     | 0              |
| Unjustified / lazy-escape casts in production | ~36                    | **0**                                                                                      | −36            |
| Strictness flags beyond `strict`              | 0                      | 3 (`forceConsistentCasingInFileNames`, `noFallthroughCasesInSwitch`, `noImplicitOverride`) | +3             |
| Lint gate against new bare casts              | none                   | `local/require-as-any-justification` (error)                                               | new            |

## What the 3 remaining production casts are

All three carry an inline `as-any justification` comment (enforced by the
#911 rule) and are genuine third-party type gaps, not lazy escapes:

1. `src/app/tokens/page.tsx` — `(freighter as any).addTrustline`: `@stellar/freighter-api` does not type the experimental `addTrustline` wallet method.
2. `src/components/ReputationHistoryChart.tsx` (×2) — recharts v2 `Tooltip` `formatter` / `labelFormatter` props do not cover the tuple-returning custom formatters.

## What was eliminated (−36)

- **#907:** 2 high-risk casts in `DelegationPanel` (`execute({} as any)`) replaced with typed `TransactionOperation` callbacks.
- **#908/#909:** lazy escapes across the Soroban utils (`src/utils/soroban.ts`), `src/lib/invoice-nft.ts`, `TokenSelector`, `CompareInvoices`, `Dashboard`, `LPTransferModal`, `LPWhitelistManager`, `WalletContext`, contract error parsing, the Supabase stub, the freelancer Horizon polling loop, marketplace fallback token, and the invoice `whitelist` typing (including unwrapping a `PayerScoreResult` numeric score a cast had let leak through as an object).
- **#910:** documented the 3 remaining third-party gaps inline with upstream links.

## Strictness flags (#912)

`tsconfig.json` now enables, in addition to the pre-existing `strict: true`:

- `forceConsistentCasingInFileNames`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride` (with `override` modifiers added in `ErrorBoundary` and contract-failure test-utils)

Deferred with recorded rationale (disproportionate churn vs. risk for this
pass): `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`.

## Durability

- `eslint-rules/require-as-any-justification.mjs` (wired in `eslint.config.mjs`, convention documented in `CONTRIBUTING.md` → "Type Safety: `as any` Casts") fails CI on any new unjustified `as any`, so the count cannot silently grow back.
- Baseline inventory and per-cast categorization: [as-any-cast-inventory.md](./as-any-cast-inventory.md).
- Remaining Tier 4 work (27 Storybook story casts → shared typed fixtures in `.storybook/`) is tracked in the inventory's roadmap and intentionally left for a follow-up: stories are excluded from `tsconfig.json` and carry no runtime risk.

## SCF / audit-readiness reading

For auditors: the money-moving and vote-casting paths (`fundInvoice`,
`markPaid`, `castVote`, `createProposal`) are now free of type escapes, and
the mutation-testing bar for those paths (≥90%, see [testing.md](./testing.md))
guards behavior the type-checker cannot. The only remaining escapes sit behind
explicit justifications at third-party library boundaries.
