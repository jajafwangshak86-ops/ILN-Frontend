# ILN Frontend Mainnet Launch Notes

**Date:** Not applicable yet (pending mainnet deployment)
**Version:** 1.0.0

---

## Welcome to the ILN Mainnet

The ILN (Invoice Liquidity Network) frontend is now live on the Stellar public network. This document explains what changes for you at the cutover and what to expect when switching from testnet to mainnet.

---

## What's Changing

### Network Switch

The ILN web application now connects to the **Stellar public network** (mainnet) instead of testnet. This means:

- **Real transactions**: All invoice operations, payments, and liquidity pool interactions now occur on the live Stellar network with real XLM and token values.
- **Real wallet balances**: Your connected wallet will show your actual mainnet balances, not testnet funds.
- **Real contract interactions**: The app now interacts with the deployed mainnet smart contracts for invoice factoring and liquidity provision. Governance is **read-only** at launch (see [Governance at Launch](#governance-at-launch)).

### What You Need to Do

#### 1. Switch Your Wallet to Mainnet

If you were using ILN on testnet, you'll need to switch your wallet (e.g., Freighter) to the Stellar public network:

- **Freighter**: Open Freighter settings → Network → Select "Public Network"
- **Other wallets**: Follow your wallet's instructions to switch from testnet to public network

#### 2. Verify Network Connection

After connecting your wallet to ILN:

- Check that the app displays "Public Network" or "Mainnet" in the network indicator
- Ensure no "Network mismatch" banner appears
- Verify that your wallet shows mainnet balances, not testnet balances

#### 3. What Stays the Same

- **Your wallet address**: Your Stellar public key remains the same across testnet and mainnet
- **The UI**: The interface and user experience are identical to testnet
- **Feature availability**: See below for which features are live at launch

---

## Features Available at Launch

### Live Features (Enabled by Default)

The following features are available immediately at mainnet launch:

- **Invoice Creation**: Create and manage real invoices on the mainnet
- **Invoice Funding**: Fund invoices using real XLM and supported tokens
- **Liquidity Provisioning**: Provide liquidity to the invoice factoring pool
- **Wallet Connection**: Connect your mainnet wallet (Freighter and compatible wallets)
- **Leaderboard**: View the live mainnet leaderboard for top liquidity providers
- **Governance View**: View governance proposals and voting status. This is **read-only**: voting, proposal execution, and proposal creation are not live at launch (see [Governance at Launch](#governance-at-launch)).

### Features Shipping Dark (Disabled by Default)

The following features are **not enabled at launch** and will be enabled in future updates:

- **Insurance Pool**: The insurance pool widget is disabled at launch. It will be enabled once the insurance pool contract has been independently reviewed and audited for mainnet.
- **Oracle Verification**: The oracle badge component is disabled at launch. It will be enabled once the oracle data source is verified against mainnet feeds.
- **NFT Display**: Invoice NFT display is disabled at launch. It will be enabled once the mainnet NFT contract is deployed and verified.

**Why ship dark?** These features require additional mainnet-specific contract deployments and security reviews. Shipping them disabled allows us to launch the core invoice factoring functionality safely while we complete the additional reviews for these optional features.

---

## Launch Readiness Status

This section is the plain-language "are we ready?" story behind the [Frontend Mainnet Readiness Checklist](mainnet-frontend-readiness-checklist.md), updated at the close of the final SCF/mainnet frontend readiness sign-off batch. The checklist holds the item-by-item status; this section explains what those statuses mean for launch.

**Overall: not yet ready for mainnet cutover.** The core invoice-factoring and liquidity journeys, accessibility, incident tooling, and performance work are in place. Governance and admin write actions do not yet reach the chain, and the live maintainer sign-off has not taken place. Launch should wait for the blockers listed below, or proceed only with governance and admin writes explicitly disabled and that decision recorded in the sign-off.

### Governance at Launch

- **Reads work; writes are not live.** Proposal lists, vote tallies, and voting power are read from the governance contract when `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID` is configured. If it is not configured, or the contract does not answer, the UI falls back to built-in sample proposals. Mainnet deploys **must** set this variable.
- **Voting, executing, vetoing, and creating proposals are still simulated in the frontend.** They wait on a fixed delay and return a placeholder transaction hash without signing or submitting anything (walkthrough findings F1–F2). They must stay behind the "not yet live" treatment (#850) and must not be presented as on-chain actions until the governance write-path launch gate (#852) closes.
- **Latency is understood ahead of wiring.** Every network stage a real governance write will use was measured on testnet. Reads take ~0.3 s (p50) and submit → confirmed takes ~5 s (p50) / ~5.8 s (p95), within the new governance latency SLO. A real vote will take noticeably longer than the simulated 2 s, so the UI needs a distinct "confirming on-chain" state when writes go live ([SLO 5](slos.md)).

### Dark Features

- **Insurance Pool, Oracle badge, and Invoice NFT ship disabled** (`NEXT_PUBLIC_INSURANCE_POOL_ENABLED`, `NEXT_PUBLIC_ORACLE_ENABLED`, `NEXT_PUBLIC_NFT_ENABLED` all default to `false`; see [Feature Flags](feature-flags.md)).
- **These are build-time flags.** Enabling one means changing the environment variable and redeploying; `/admin/flags` only displays the current values. The flag-flip step of the maintainer walkthrough verifies that flipping one flag in a test environment exposes only that feature and that production defaults stay off. That walkthrough has **not yet been conducted**.

### Admin Surface Hardening

- **In place:** sensitive admin actions go through an accessible in-page confirmation dialog instead of `window.confirm`, `/admin` and `/admin/flags` are gated to the configured governance admin address, every privileged action emits a structured Sentry audit event (`src/lib/auditLog.ts`), and the admin surface has elevated test coverage thresholds enforced in `vitest.config.ts`. See [admin-surface-security-review.md](admin-surface-security-review.md) for the full category closing report.
- **Not yet launch-ready:** pausing/unpausing the protocol and executing ready proposals do not call the contract. Approving or removing an accepted token asks the admin wallet to sign but never submits the transaction. None of these actions are on-chain audit-log event sources (walkthrough findings F2–F4, F8). Until fixed, protocol-level admin operations must be performed directly against the contract with the multisig, not through the frontend.

### Performance

- The batch was checked against its pre-batch baseline with the repository's Lighthouse CI configuration. **No Core Web Vitals regression was found** beyond run-to-run noise ([Lighthouse CI — Batch Regression Check](LIGHTHOUSE_CI.md#batch-regression-check--final-scfmainnet-frontend-readiness-sign-off-959)).
- The check found, and fixed, a broken production build on `dev` and a Lighthouse workflow that never ran on `dev` pull requests.
- Known, pre-existing budget breaches are accepted as residual risk for launch: home-page layout shift (CLS ≈ 0.13 vs 0.1 budget) and page weight well above the 200 KB budget, mostly the icon font and home-page transaction history.

### Remaining Blockers

Taken from the readiness checklist at the close of this batch:

| Blocker                                                                                                         | Checklist status                                                          |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Live maintainer walkthrough and sign-off of trust-critical surfaces, including a decision on each finding F1–F8 | Blocked — [Walkthrough & Sign-off](trust-critical-surface-walkthrough.md) |
| Governance write paths wired to the contract, or explicitly disabled for launch (#850, #852)                    | Blocked (walkthrough F1–F2)                                               |
| Admin pause / execute / token actions submitted on-chain and audit-logged, or removed from the launch UI        | Blocked (walkthrough F3–F4, F8)                                           |
| Cumulative batch bundle-size verdict                                                                            | In progress                                                               |
| Status-page automation still open (#934, #871, #872; #935–#938 shipped)                                         | In progress                                                               |
| Contract integration status review                                                                              | In progress                                                               |
| Backend checklist cross-link                                                                                    | In progress                                                               |
| Per-area maintainer sign-off (accessibility, performance, operations, security)                                 | Not signed                                                                |

## What's New vs. Testnet

### Honest Assessment

We're committed to honest, non-inflated communication. Here's what's actually new at mainnet launch:

**What's New:**

- Real transactions and balances on the Stellar public network
- Live invoice factoring with real economic value
- Mainnet-specific contract IDs and RPC endpoints
- Production-grade security hardening (DNSSEC, CAA records, secret rotation)

**What's the Same:**

- The UI and user experience are identical to testnet
- The feature set is intentionally conservative (see "Features Shipping Dark" above)
- No new product features are being introduced at launch—this is a network cutover, not a feature release

**What's Not Included:**

- No "v2" or major redesign at launch
- No new token launches or airdrops
- No experimental features—only core invoice factoring functionality

---

## Security Considerations

### Mainnet = Real Value

On mainnet, all transactions involve real value. Please:

- **Double-check transaction details** before signing in your wallet
- **Verify contract IDs** match the official mainnet contracts (documented in the deployment runbook)
- **Start small** if you're new to the protocol—test with small amounts first
- **Keep your wallet secure**—use hardware wallets or strong password protection

### Incident Response

If you suspect a security issue:

- **Do not sign transactions** if the app behaves unexpectedly
- **Verify the network** in your wallet shows "Public Network"
- **Report issues** via the GitHub issue tracker or security@iln.finance
- **Monitor official channels** for security advisories

---

## Getting Help

### Documentation

- **Deployment Runbook**: [docs/mainnet-deployment-runbook.md](mainnet-deployment-runbook.md) - Technical deployment details
- **Feature Flags**: [docs/feature-flags.md](feature-flags.md) - Feature flag reference
- **Incident Response**: [docs/incident-response.md](incident-response.md) - Security incident procedures

### Community

- **GitHub Issues**: Report bugs and feature requests at [github.com/Invoice-Liquidity-Network/ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend)
- **Discord**: Not applicable yet (tracked by backend support channels issue)
- **Twitter**: Not applicable yet (tracked by backend support channels issue)

---

## Next Steps

1. **Switch your wallet** to the Stellar public network
2. **Connect to ILN** at [app.iln.finance](https://app.iln.finance)
3. **Verify the network** indicator shows mainnet
4. **Start small**—test with small amounts if you're new
5. **Provide feedback** via GitHub issues or community channels

---

---

## Dark-Feature Re-enablement Readiness Sign-off

This section is the **closing gate** for the dark-feature re-enablement category (#881). Before the launch notes can claim readiness for any dark feature, every row in the table below must be **Complete** and the maintainer sign-off must be recorded.

The three features shipping dark at launch are gated by build-time environment flags (see [Feature Flags](feature-flags.md)). Enabling one means changing the flag and redeploying — there is no runtime toggle. The readiness package for each feature must exist and be current before that flag is flipped.

### Required readiness artifacts

Each dark feature requires the following artifacts before its flag is cleared for mainnet:

1. **Smoke-test coverage** — at least one mainnet-smoke test exercises the feature surface after the flag is on (`e2e/dark-feature-flag-flip-smoke.spec.ts`).
2. **Visual baseline** — a Chromatic story baseline capturing the enabled state exists and is current (`pnpm run chromatic`).
3. **Rollback runbook step** — [docs/dark-feature-flag-rollback-runbook.md](dark-feature-flag-rollback-runbook.md) contains an explicit, per-feature section for disabling the feature (flipping the flag back to `false` and redeploying).
4. **Feature flag review** — the flag's entry in [docs/feature-flags.md](feature-flags.md) is current and the production default is confirmed `false`.

The consolidated go/no-go surface for all four artifacts across all three features is maintained in [docs/dark-feature-dashboard.md](dark-feature-dashboard.md).

### Per-feature readiness dashboard

| Feature        | Flag                                 | Smoke test                                                    | Visual baseline                                                                    | Rollback step                                                                        | Flag review                                                          | Status                             |
| -------------- | ------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------- |
| Insurance Pool | `NEXT_PUBLIC_INSURANCE_POOL_ENABLED` | ✅ `e2e/dark-feature-flag-flip-smoke.spec.ts` §Insurance Pool | ✅ `InsurancePoolPanel.stories.tsx` — `FlagEnabled` + `FlagEnabledLoading` stories | ✅ [dark-feature-flag-rollback-runbook.md §1](dark-feature-flag-rollback-runbook.md) | ✅ Confirmed `false` default in [feature-flags.md](feature-flags.md) | ⏳ **Pending maintainer sign-off** |
| Oracle Badge   | `NEXT_PUBLIC_ORACLE_ENABLED`         | ✅ `e2e/dark-feature-flag-flip-smoke.spec.ts` §Oracle Badge   | ✅ `OracleBadge.stories.tsx` — `FlagEnabled*` stories (5 states)                   | ✅ [dark-feature-flag-rollback-runbook.md §2](dark-feature-flag-rollback-runbook.md) | ✅ Confirmed `false` default in [feature-flags.md](feature-flags.md) | ⏳ **Pending maintainer sign-off** |
| Invoice NFT    | `NEXT_PUBLIC_NFT_ENABLED`            | ✅ `e2e/dark-feature-flag-flip-smoke.spec.ts` §Invoice NFT    | ✅ `InvoiceNftCard.stories.tsx` — `FlagEnabled*` stories (4 states)                | ✅ [dark-feature-flag-rollback-runbook.md §3](dark-feature-flag-rollback-runbook.md) | ✅ Confirmed `false` default in [feature-flags.md](feature-flags.md) | ⏳ **Pending maintainer sign-off** |

**Overall status: All four required artifacts are now in place for each feature.** The consolidated readiness dashboard is at [dark-feature-dashboard.md](dark-feature-dashboard.md). Each feature is eligible for maintainer sign-off; the table above will advance to **Ready** once sign-off is recorded in the dashboard. The table above is the go/no-go surface; update each cell when the artifact changes.

### Backend checklist cross-link

The smart-contract repository's [mainnet launch checklist](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/mainnet-launch-checklist.md) carries a parallel set of dark-feature readiness gates for the contract side (contract audit status, address confirmation, and multisig signer verification for each dark contract). Both sides must be **Complete** before a flag is flipped. The coordination record for the two-way link is in [backend-checklist-cross-link-coordination.md](backend-checklist-cross-link-coordination.md).

### Maintainer sign-off

Fill this table after walking the dashboard above and confirming every artifact row that is needed for a flag flip is complete. One row per attending maintainer.

| Maintainer (GitHub handle) | Date | Build / commit reviewed | Insurance Pool ready | Oracle Badge ready | Invoice NFT ready | Signed off | Notes |
| -------------------------- | ---- | ----------------------- | -------------------- | ------------------ | ----------------- | ---------- | ----- |
|                            |      |                         |                      |                    |                   |            |       |

Sign-off is complete only when at least one maintainer has signed off **and** every feature that is being enabled has a **Complete** row in the dashboard above. A feature may proceed to canary rollout independently once its own row is complete; all three do not need to be ready simultaneously.

---

## Post-Launch Roadmap

After the initial mainnet launch, we plan to:

1. **Enable Insurance Pool** - Once the insurance pool contract is audited and verified
2. **Enable Oracle Verification** - Once oracle data sources are verified against mainnet feeds
3. **Enable NFT Display** - Once the mainnet NFT contract is deployed
4. **Additional Features** - Based on community feedback and governance proposals

Stay tuned to official channels for announcements on feature enablements.

---

**Thank you for being part of the ILN mainnet launch!**
