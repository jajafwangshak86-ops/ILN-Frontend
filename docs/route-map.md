# ILN Route Map

This document lists every canonical page route in the Invoice Liquidity Network (ILN) Frontend, its purpose, the primary consumer, and any active redirects. The authoritative runtime route tree is `app/`; the older `src/app/` tree is retained for legacy tests and experiments and does not add public routes.

## Analytics vs. Stats

These routes are intentionally distinct:

- `/analytics` is a private, wallet-connected freelancer workspace. It reports the current freelancer's invoice performance, cash flow, earnings, and related activity.
- `/stats` is a public, protocol-wide reporting page. It reports aggregate metrics such as TVL, volume, yield, dispute rate, and token activity without requiring a wallet.
- `/leaderboard` is the public cross-role ranking page for payers, freelancers, and liquidity providers. It is not a child of either analytics route.

The old `/analytics/freelancer` and `/analytics/leaderboard` paths are preserved only as permanent compatibility redirects; there are no nested page implementations for them.

## Canonical Routes

| Route Path                 | Description                                                           | Primary Consumer | Access Type                   |
| :------------------------- | :-------------------------------------------------------------------- | :--------------- | :---------------------------- |
| `/`                        | Landing page explaining the ILN protocol and entry points             | Public           | Unauthenticated               |
| `/freelancer`              | Freelancer workspace to submit invoices and track status              | Freelancer       | Authenticated Wallet          |
| `/payer`                   | Payer dashboard for viewing and settling unpaid invoices              | Payer            | Authenticated Wallet          |
| `/lp`                      | Liquidity Provider dashboard for viewing and managing funded invoices | LP               | Authenticated Wallet          |
| `/lp/compare`              | Comparison tool for comparing invoices                                | LP               | Authenticated Wallet          |
| `/marketplace`             | Marketplace listing active invoices open for funding                  | LP / Public      | Unauthenticated / Wallet      |
| `/submit`                  | On-chain invoice submission form                                      | Freelancer       | Authenticated Wallet          |
| `/governance`              | Governance portal for viewing, creating, and voting on proposals      | Public / Voter   | Authenticated Wallet          |
| `/dashboard`               | Actor-agnostic dashboard overview                                     | Active Actor     | Authenticated Wallet          |
| `/notifications`           | Wallet notification inbox with read/unread state (polled, see below)  | Active Actor     | Authenticated Wallet          |
| `/analytics`               | Freelancer-specific performance and earnings analytics                | Freelancer       | Authenticated Wallet          |
| `/stats`                   | Protocol-wide public stats (TVL, volume, yield, dispute rate)         | Public           | Unauthenticated               |
| `/leaderboard`             | Canonical protocol leaderboard for Payers, Freelancers, and LPs       | Public           | Unauthenticated               |
| `/referrals`               | Referral dashboard showing referral links and earnings stats          | Public / User    | Authenticated Wallet          |
| `/roadmap`                 | Public roadmap showing product timeline                               | Public           | Unauthenticated               |
| `/offline`                 | PWA offline fallback page                                             | Public           | Unauthenticated               |
| `/i/[id]`                  | Public invoice detail view                                            | Public           | Unauthenticated               |
| `/pay/[id]`                | Payer checkout page for settling individual invoices                  | Payer            | Authenticated Wallet          |
| `/pay/[id]/dispute`        | Invoice dispute page                                                  | Payer            | Authenticated Wallet          |
| `/profile/[address]`       | Public reputation profile and transaction activity history            | Public           | Unauthenticated               |
| `/tokens`                  | Approved token list and decimal metadata                              | Public           | Unauthenticated               |
| `/invoices/batch`          | Batch invoice submission workflow                                     | Freelancer       | Authenticated Wallet          |
| `/admin`                   | Protocol health and administrative controls                           | Admin            | Admin wallet only (see below) |
| `/admin/actions`           | Admin actions management (live)                                       | Admin            | Public read-only (see below)  |
| `/admin/flags`             | Admin feature flag controls (live)                                    | Admin            | Admin wallet only (see below) |
| `/governance/[id]`         | Governance proposal detail and voting                                 | Voter            | Authenticated Wallet          |
| `/governance/new`          | New governance proposal form                                          | Voter            | Authenticated Wallet          |
| `/governance/how-it-works` | Governance explainer                                                  | Public           | Unauthenticated               |

## Admin Route Authorization

The three `/admin/*` routes have deliberately different access requirements.
Undocumented admin routes are a security-through-obscurity smell, so the exact
mechanism and its enforcement boundary are stated here explicitly (#914, #915).

**Mechanism.** Admin identity is a wallet-address comparison, not a role claim
or session: the connected wallet address must equal
`NEXT_PUBLIC_GOVERNANCE_ADMIN_ADDRESS` (see `src/constants.ts`). The check
itself is `isAdminAddress()` in `src/utils/admin-health.ts`; server-side code
(empty of browser dependencies) uses the equivalent `requireAdmin()` /
`assertAdminAddress()` in `src/lib/admin-gate.ts`.

**Enforcement boundary — read the caveat.** Page-level gating is
**client-side only**: `/admin` (`app/admin/page.tsx`) and `/admin/flags`
(`app/admin/flags/page.tsx`) are `'use client'` components that render an
"Access Restricted" / "Admin access required" screen for non-admin wallets
(and `/admin/flags` additionally `router.replace('/admin')`). There is no
Next.js middleware or server-component check — there cannot be one, because a
wallet address is a client-side credential with no session cookie for the
server to verify. A modified client can bypass the UI gate.

That bypass grants nothing, because the real enforcement lives elsewhere:

- **Reads are public.** Protocol health and the admin action history are
  public on-chain state read via Soroban RPC. No privileged data is served to
  the page, so bypassing the gate discloses nothing.
- **Writes require the admin key.** Pause/unpause, ready-proposal execution,
  and token allowlist changes must be signed in Freighter by the admin wallet
  itself. The Stellar contract rejects non-admin signers on-chain regardless
  of what the UI allowed. Client-side mutations additionally fail fast via
  `assertAdminAddress()` before any transaction is built.

| Route            | Requirement               | Enforcement                                                                                                                                            |
| :--------------- | :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`         | Admin wallet only         | Client-side `isAdminAddress` gate rendering "Admin access required" (403-style screen, HTTP 200); writes enforced on-chain by admin-signer requirement |
| `/admin/flags`   | Admin wallet only         | Client-side `isAdminAddress` gate rendering "Access Restricted" + redirect to `/admin`; read-only flag display, no mutating controls                   |
| `/admin/actions` | **Public, intentionally** | No gate by design: read-only transparency log (`AdminActionHistoryPanel` with `publicView`) sourced from the on-chain admin action history view        |

Every privileged action on `/admin` and `/admin/flags` is also emitted as a
structured Sentry audit event via `logAdminAction()` (`src/lib/auditLog.ts`),
so misuse or bypass attempts leave a queryable `admin_audit.*` trail.

**Regression coverage:** `src/lib/__tests__/admin-gate.test.ts` and
`src/utils/__tests__/admin-route-access.test.ts` assert that non-admin
addresses are denied by the gate, the mutation guards, and the route-access
matrix (#916).

## Notifications Route Data Source

`/notifications` (`app/notifications/page.tsx`, which loads `src/screens/NotificationsPage.tsx` client-side only) is **polling-based, not real-time**. No WebSocket or SSE channel delivers notifications.

- **Store.** The page renders the wallet's notifications from `NotificationContext` (`src/context/NotificationContext.tsx`) and fetches nothing itself.
- **Source.** `NotificationBell`, rendered by the `Navbar` this page includes, polls `GET /api/notifications/[address]` on mount and then every 60 seconds, merging results into the store by notification id. The route proxies the backend notifications service (`NOTIFICATION_API` → `/notifications/:address`, uncached), is rate limited to 30 requests per minute per client, and returns `[]` when `NOTIFICATION_API` is not configured.
- **Latency.** A new notification can take up to 60 seconds, plus backend latency, to appear. Browsers throttle timers in background tabs, so it can take longer there. Users should not expect instant delivery.
- **Degraded service.** On `429`/`503` the page keeps showing cached notifications and the bell shows its degraded marker. See [notifications-service.md](./notifications-service.md) for the failure modes.
- **Persistence.** The list is cached per wallet in `localStorage` (`iln-notifications:<address>`, up to 50 items) and read state in `iln-notification-read:<address>`. Read state survives reloads and stays in sync across tabs of the same browser through `storage` events. It does not sync across devices: a `read` flag from the backend is honored, but the frontend never writes read state back.
- **Filtering.** A filter bar narrows the feed by category (All, Invoices, Liquidity, Governance, Reputation, Admin) with per-category total and unread counts. Filtering applies to the cached list (latest 50) and restarts the "Load more" window. See [notifications-service.md](./notifications-service.md#categories-and-filtering).
- **Readiness.** The category's findings and accepted risks are consolidated in the [notifications surface readiness report](./notifications-surface-readiness-report.md).
- **Not a source.** The app's real-time channels, the indexer WebSocket (`src/lib/indexer-websocket.ts`) and the Horizon SSE stream (`src/lib/horizon-stream.ts`) behind `ContractEventSync`, only patch invoice query caches and do not feed this inbox. `NotificationEventPoller`, which derives notifications from invoice, governance, and reputation polling, is not mounted anywhere in the app tree.

## Active Redirects

To prevent route drift and maintain a consolidated structure, the following redirects are defined in `next.config.ts`:

- `/dashboard/payer` &rarr; `/payer`
- `/analytics/freelancer` &rarr; `/analytics` (consolidated duplicate freelancer views)
- `/analytics/leaderboard` &rarr; `/leaderboard` (consolidated duplicate leaderboard paths)
- `/invoices/:id` &rarr; `/i/:id` (redirect legacy/long-form invoice detail path to canonical short-form `/i/[id]`)
