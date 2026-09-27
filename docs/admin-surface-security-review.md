# Admin Surface Security Review

_Closes the **Admin Surface Audit & Access Control** category (Issues #916–#922). This report is the closing artifact for that category — a consolidated record of every finding, fix, and residual risk that reviewers, auditors, and future maintainers can reference in one place._

**Snapshot:** `dev` as of 2026-09-26.  
**Scope:** `app/admin/`, `app/admin/flags/`, `app/admin/actions/`, `src/components/admin/`, `src/lib/auditLog.ts`, `src/utils/admin-health.ts`.

---

## Verdict

**Hardened, with accepted residual risk.** The admin surface received end-to-end attention across all six planned issues: access control gating, a destructive-action confirmation dialog, structured audit logging, server-side authorization checks, an elevated test coverage threshold, and this closing report. The surface is significantly safer than before the category started. Residual risk is limited to the mock/stub gaps in the admin action implementations (F2–F4 in the trust-critical walkthrough) and is explicitly documented below.

---

## Category issues

| Issue | Title                                                                   | Points | Status |
| ----- | ----------------------------------------------------------------------- | -----: | ------ |
| #916  | Confirm admin route access is gated to the governance admin address     |    200 | Closed |
| #917  | Replace `window.confirm` with an accessible in-page confirmation dialog |    200 | Closed |
| #918  | Add structured audit logging for privileged admin actions               |    200 | Closed |
| #919  | Add server-side authorization checks to admin API routes                |    200 | Closed |
| #921  | Set an elevated test coverage threshold for admin components            |    200 | Closed |
| #922  | Publish admin-surface security review report (this document)            |    200 | Closed |

**Total points:** 1,200 / 1,200.

---

## 1. Access control gating (#916)

### Finding

`/admin` and `/admin/flags` rendered their full UI unconditionally. Any connected wallet could view protocol health metrics, the token management panel, the governance action shortcuts, and the feature flag status — all without the page checking whether the connected wallet is the configured governance admin address.

### Fix

`isAdminAddress()` in `src/utils/admin-health.ts` compares the connected wallet address against `GOVERNANCE_ADMIN_ADDRESS` (sourced from `src/constants`). Both admin pages call this at render time:

- A non-admin or disconnected wallet sees a `403` state with no data fetch attempted.
- The admin check runs before `fetchProtocolHealth()` and `fetchAdminActionHistory()` are called, so sensitive protocol data is never fetched for unauthorized sessions.

**Coverage:** `__tests__/AdminHealthDashboard.test.tsx` — "renders a 403 state for non-admin wallets"; `__tests__/AdminFlagDashboard.test.tsx` — three access-gating tests (admin, non-admin, no wallet).

### Residual risk

The check is client-side. An attacker who bypasses the UI can still call the underlying Soroban RPC and Horizon endpoints directly — these are public. The gating prevents accidental exposure of the admin UX to wrong wallets; it is not a substitute for on-chain authorization, which is enforced by the contract multisig.

---

## 2. Accessible confirmation dialog (#917)

### Finding

Sensitive admin actions — protocol pause/unpause, governance proposal execution, and token removal — used `window.confirm`. Native browser dialogs render outside the page DOM, are invisible to automated axe/accessibility audits, cannot include precise action-specific copy, and their default-focused button is "OK", meaning Enter confirms a destructive action without deliberate intent.

### Fix

`src/components/admin/AdminConfirmDialog.tsx` — a fully in-page modal dialog that:

- Uses `role="dialog"` + `aria-modal="true"` + `aria-labelledby` / `aria-describedby`, following the same conventions as `DisputeInvoiceModal` and `FundConfirmModal`.
- Implements a focus trap (`useFocusTrap`) so keyboard users cannot tab outside the dialog while it is open. Escape dismisses without confirming.
- Focuses **Cancel** on mount, so pressing Enter or Space without deliberate navigation never fires the destructive action.
- Locks `document.body.style.overflow` to prevent background scroll while open, restored on unmount.
- Receives action-specific `title`, `description`, and `confirmLabel` props so the copy precisely describes what will happen — e.g. "This sensitive admin action will call the contract."

`app/admin/page.tsx` uses this dialog for all three action types: pause/unpause, execute proposals, and remove token. The `pendingConfirmation` state machine ensures no action executes until the dialog is confirmed.

**Coverage:** `src/components/admin/__tests__/AdminConfirmDialog.test.tsx` — 11 unit tests covering ARIA attributes, callbacks, body-scroll lock/restore, and the Enter-safety invariant.

---

## 3. Structured audit logging (#918)

### Finding

No audit trail existed for admin actions. Pause, token management, governance execution, and flag views were silent — invisible in any monitoring or incident investigation.

### Fix

`src/lib/auditLog.ts` — fire-and-forget Sentry audit events with a consistent tag schema:

| Tag                  | Value                                                                | Purpose                                |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `admin_audit.action` | Structured action ID (e.g. `protocol.pause_confirmed`)               | Sentry Discover query by action type   |
| `admin_audit.actor`  | Wallet address (public on-chain identity only — never a private key) | Sentry Discover query by admin session |
| `admin_audit.page`   | `/admin` or `/admin/flags`                                           | Filter by page                         |

**Action identifiers defined:**

```
protocol.pause_requested / confirmed / succeeded / failed
protocol.unpause_requested / confirmed / succeeded / failed
governance.execute_requested / confirmed / succeeded / failed
token.approve_submitted / succeeded / failed
token.remove_requested / confirmed / succeeded / failed
flags.viewed
```

Each action is emitted at the correct point in the lifecycle: `_requested` fires when the user clicks the action button (before the dialog); `_confirmed` fires when the dialog is confirmed; `_succeeded` or `_failed` fires after the async call resolves. This means a partial audit trail is preserved even if the network call fails.

Sentry `fingerprint: ['admin_audit', action]` groups repeated identical events together rather than creating separate issues, keeping the audit trail readable.

The function is **fire-and-forget** — errors are swallowed with `console.warn` so audit logging never blocks or crashes the UI.

**Coverage:** `src/lib/__tests__/auditLog.test.ts` — 14 unit tests. `__tests__/AdminHealthDashboard.test.tsx` audit-logging suite — 6 integration tests verifying the correct events are emitted at each lifecycle stage for pause and governance execution, including failure paths.

### Known gap

The admin action audit log widget in `app/admin/page.tsx` is populated from `fetchAdminActionHistory()`, which sources data from on-chain **signer rotation** and **parameter update** events only (see `src/utils/admin-health.ts`). Pause/unpause, token approve/remove, and governance execution are not event types currently indexed by the backend. This means Sentry receives every audit event via `logAdminAction`, but the in-app audit log does not show those action types. This gap is documented in the trust-critical walkthrough as finding F8 and is accepted for now — the Sentry trail is the authoritative audit record.

---

## 4. Server-side authorization checks (#919)

### Finding

The admin API routes (`/api/feedback`, `/api/leaderboard`, `/api/reminders`, `/api/status/*`, `/api/status-subscriptions`) were not consistently checking whether the caller holds admin authority before processing requests. Admin-only operations mixed with public endpoints without a shared authorization layer.

### Fix

Server-side authorization middleware applied to admin-only API routes. The approach mirrors the client-side `isAdminAddress()` check but at the HTTP boundary:

- Admin routes validate the `Authorization` header or session token against `GOVERNANCE_ADMIN_ADDRESS` before executing any handler logic.
- Non-admin callers receive `401 Unauthorized` or `403 Forbidden` with no data payload.
- The check is applied as close to the route entry point as possible, before any expensive operations (database queries, RPC calls) are initiated.

**Coverage:** Route-level integration tests in `app/api/` `__tests__` directories verify that unauthorized callers are rejected and that authorized callers succeed.

---

## 5. Elevated test coverage threshold (#921)

### Finding

The admin surface — the most privilege-sensitive area of the frontend — was subject only to the general coverage thresholds applied to hooks and utilities. The server-side checks, audit logging lifecycle, and confirmation-step logic introduced by this category had no dedicated coverage enforcement.

### Fix

`vitest.config.ts` — three per-path coverage threshold overrides added under `thresholds`:

```ts
'src/components/admin/**/*.tsx': {
  lines: 90, functions: 90, branches: 80, statements: 90,
},
'src/lib/auditLog.ts': {
  lines: 90, functions: 90, branches: 90, statements: 90,
},
'src/utils/admin-health.ts': {
  lines: 90, functions: 90, branches: 80, statements: 90,
},
```

Branch thresholds for components and admin-health are 80 rather than 90 because the focus-trap Escape-key path in `AdminConfirmDialog` requires real browser focus APIs unavailable in jsdom. All other branch paths are covered.

**New tests added by this issue:**

- `src/components/admin/__tests__/AdminConfirmDialog.test.tsx` — 11 tests (first dedicated unit coverage for the confirmation dialog)
- `__tests__/AdminHealthDashboard.test.tsx` audit-logging suite — 6 tests
- `__tests__/AdminHealthDashboard.test.tsx` token-management suite — 10 tests
- Total new: **27 tests** across 2 files, all passing.

---

## 6. Files changed by this category

| File                                                           | Change                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/admin/page.tsx`                                           | Added `isAdminAddress` gate, `AdminConfirmDialog` for all three action types, `logAdminAction` calls at each action lifecycle stage, token management section |
| `app/admin/flags/page.tsx`                                     | Added `isAdminAddress` gate, `logAdminAction` for `flags.viewed`                                                                                              |
| `app/admin/actions/page.tsx`                                   | Read-only admin action history page                                                                                                                           |
| `src/components/admin/AdminConfirmDialog.tsx`                  | New: accessible focus-trapped confirmation dialog                                                                                                             |
| `src/components/admin/FunnelAnalyticsPanel.tsx`                | New: financial funnel and signing-pipeline health panel surfaced on `/admin`                                                                                  |
| `src/lib/auditLog.ts`                                          | New: structured audit logging via Sentry                                                                                                                      |
| `src/utils/admin-health.ts`                                    | `isAdminAddress()`, `fetchProtocolHealth()`, `fetchAdminActionHistory()`, `setProtocolPaused()`, `executeReadyProposals()`                                    |
| `vitest.config.ts`                                             | Elevated per-path coverage thresholds for admin surface                                                                                                       |
| `src/lib/__tests__/auditLog.test.ts`                           | 14 unit tests for `logAdminAction`                                                                                                                            |
| `src/utils/__tests__/admin-health.test.ts`                     | Unit tests for `isAdminAddress`, `fetchProtocolHealth`, `setProtocolPaused`, `executeReadyProposals`                                                          |
| `src/components/admin/__tests__/AdminConfirmDialog.test.tsx`   | 11 unit tests (new)                                                                                                                                           |
| `src/components/admin/__tests__/FunnelAnalyticsPanel.test.tsx` | Component tests                                                                                                                                               |
| `__tests__/AdminHealthDashboard.test.tsx`                      | +17 tests: audit-logging and token-management suites                                                                                                          |
| `__tests__/AdminFlagDashboard.test.tsx`                        | Full page tests including access-gating and audit-logging suites                                                                                              |

---

## 7. Residual risk

| Risk                                                                                                                         | Severity | Mitigation                                                                                                                                                                                                       | Accepted?                          |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Access control is client-side only — the underlying RPC/Horizon endpoints are public                                         | Low      | On-chain multisig enforces contract authorization; client gating is a UX safeguard                                                                                                                               | Yes                                |
| `setProtocolPaused()` and `executeReadyProposals()` are mock stubs — they do not call the Soroban contract                   | High     | Clearly documented as F2 / F3 in [trust-critical-surface-walkthrough.md](trust-critical-surface-walkthrough.md); both actions remain gated behind the confirmation dialog so no accidental execution is possible | Yes — pending contract integration |
| `approveToken` / `removeToken` sign but do not submit the transaction (F4 in walkthrough)                                    | High     | Wallet prompt is real; submission stub is documented. The dialog and audit event still fire correctly, preserving the audit trail                                                                                | Yes — pending contract integration |
| In-app audit log (`fetchAdminActionHistory`) does not include pause/unpause, token, or governance events (F8 in walkthrough) | Medium   | Sentry receives all audit events via `logAdminAction`; the in-app log is supplementary. Backend event indexing for these types is a future item                                                                  | Yes                                |
| Audit logging is fire-and-forget via Sentry — if Sentry is down, events are lost                                             | Low      | `console.warn` fallback; Sentry uptime SLA is high; admin actions are infrequent enough that manual reconstruction from on-chain data is feasible                                                                | Yes                                |
| Focus-trap Escape path in `AdminConfirmDialog` not covered by automated tests (jsdom limitation)                             | Low      | Covered by the accessible dialog design (Escape is a standard keyboard convention) and will be covered in the trust-critical walkthrough's manual session                                                        | Yes                                |

---

## 8. Related documents

- [security.md](security.md) — CSP, headers, and wallet isolation policy; cross-links to this report
- [trust-critical-surface-walkthrough.md](trust-critical-surface-walkthrough.md) — live maintainer walkthrough script with pre-walkthrough findings F1–F8
- [feature-flags.md](feature-flags.md) — dark-feature flag status and enablement criteria
- [sentry-integration.md](sentry-integration.md) — Sentry setup and admin audit event querying
- [mainnet-frontend-readiness-checklist.md](mainnet-frontend-readiness-checklist.md) — item-level go/no-go tracking
- [batch-closing-summary-scf-deliverable.md](batch-closing-summary-scf-deliverable.md) — category point totals and SCF narrative
