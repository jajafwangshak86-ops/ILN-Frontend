# Frontend Security, SRI, Wallet Isolation & Transaction Hardening Policy

## Overview

The **ILN-Frontend** web application interacts with Soroban smart contracts, decentralized relay networks, and user cryptographic wallets. This document establishes technical controls, defense-in-depth policies, and security architectural standards across the frontend codebase.

---

## 1. Threat Model & Technical Controls

### Threat 1: Malicious CDN / Script Injection (SEV-1 Mitigation)

- **Local Bundling Preference**: All dependencies and assets are bundled locally into static build chunks rather than fetched from external CDN domains whenever possible.
- **Subresource Integrity (SRI)**: Any external resource or third-party stylesheet loaded via `<script>` or `<link>` tags specifies `crossorigin="anonymous"` and cryptographically validated origins.
- **Content Security Policy (CSP)**: Strict headers enforced in `next.config.ts` restrict script execution exclusively to first-party origins (`'self'`), disallow embedding (`frame-ancestors 'none'`), restrict font origins (`fonts.gstatic.com`), and prevent unauthorized data exfiltration.

### Threat 2: Signing Path Isolation & Wallet Provider Parity

- **Common Wallet Interface**: All wallet providers (Freighter and WalletConnect v2) conform strictly to the unified `WalletContextType` interface.
- **Transaction Preview Hardening**: Every transaction XDR is inspected and validated before forwarding to wallet signers.
- **Provider Security Checklist**:
  - [x] Provider credentials (`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`) validated at runtime.
  - [x] Unconfigured state surfaced honestly without fake success.
  - [x] Clear session lifecycle methods (`disconnect`, `connect`, `signTx`).
  - [x] Isolated signer execution without cross-contamination between wallet providers.

### Threat 3: Unattended Browser Session Hijacking

- **Session & Idle Timeout**: When a wallet is connected, user activity is monitored across interaction events (`mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`).
- **Inactivity Warning**: At `DEFAULT_IDLE_TIMEOUT_MS - WARNING_BEFORE_TIMEOUT_MS` (e.g. 28 minutes into a 30-minute session), a persistent warning toast prompts the user with a "Stay Connected" action.
- **Automated Disconnect**: If no interaction occurs before the full idle timeout elapses, the wallet automatically disconnects, in-memory state is wiped, local storage is cleared, and navigation safely redirects to the public home route.

### Threat 4: Clipboard Hijacking & Destination Typo Exploits

- **Confirmation Friction Gate**: High-value and irreversible financial actions (such as `transfer_lp_position`) require the user to explicitly type the last 6 characters of the destination Stellar address.
- **Deliberate UX Friction**: Irreversible fund and claim transfers permanently reassign ownership on-chain. Requiring explicit confirmation typing defeats automated clipboard-replacement malware and accidental paste mistakes before enabling transaction submission.

---

## 2. Content Security Policy (CSP) Directives

Configured in `next.config.ts` across all incoming routes:

| Directive                   | Policy                                                | Purpose                                                                                            |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                              | Disallow loading unapproved external assets by default.                                            |
| `script-src`                | `'self' 'unsafe-inline' 'unsafe-eval'`                | Restrict executable scripts to first-party bundle.                                                 |
| `style-src`                 | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Restrict stylesheets to local bundle and verified font stylesheets.                                |
| `font-src`                  | `'self' https://fonts.gstatic.com data:`              | Allow font binaries from verified Google Fonts CDN and inline data.                                |
| `img-src`                   | `'self' data: https: blob:`                           | Allow local, data URI, and authenticated HTTPS image resources.                                    |
| `connect-src`               | `'self' https: wss:`                                  | Allow RPC queries and WebSocket connections to Horizon/Soroban RPC nodes and WalletConnect relays. |
| `object-src`                | `'none'`                                              | Block Flash and Java applets.                                                                      |
| `base-uri`                  | `'self'`                                              | Prevent `<base>` tag hijacking.                                                                    |
| `form-action`               | `'self'`                                              | Restrict form submissions to first-party routes.                                                   |
| `frame-ancestors`           | `'none'`                                              | Prevent clickjacking by forbidding embedding in frames/iframes.                                    |
| `upgrade-insecure-requests` | _Active_                                              | Upgrade all HTTP links to HTTPS.                                                                   |

---

## 3. Admin Surface Hardening

The `/admin` and `/admin/flags` routes received a dedicated security audit and hardening pass (Issues #916–#922). The closing report is at [docs/admin-surface-security-review.md](admin-surface-security-review.md).

Summary of controls in place:

- **Access gating:** `isAdminAddress()` in `src/utils/admin-health.ts` checks the connected wallet against `GOVERNANCE_ADMIN_ADDRESS` at render time. A 403 state is shown and no data is fetched for unauthorized wallets.
- **Confirmation dialog:** `src/components/admin/AdminConfirmDialog.tsx` replaces `window.confirm` for all destructive admin actions (pause/unpause, governance execution, token removal). The dialog is accessible (`role="dialog"`, focus trap, Escape-to-cancel, Cancel as initial focus).
- **Structured audit logging:** `src/lib/auditLog.ts` emits fire-and-forget Sentry events tagged by `admin_audit.action` and `admin_audit.actor` for every admin action lifecycle stage. See [sentry-integration.md](sentry-integration.md) for query patterns.
- **Elevated test coverage:** `vitest.config.ts` enforces 90/90/80/90 (lines/functions/branches/statements) on `src/components/admin/**`, `src/lib/auditLog.ts`, and `src/utils/admin-health.ts` — higher than the general component threshold.

Residual risk (mock contract stubs, client-side-only access check) is documented in [admin-surface-security-review.md § Residual risk](admin-surface-security-review.md#7-residual-risk).

---

## 4. Additional Security Headers

- `X-Content-Type-Options: nosniff` — Prevents MIME-sniffing vulnerabilities.
- `X-Frame-Options: DENY` — Prevents clickjacking.
- `X-XSS-Protection: 1; mode=block` — Enables legacy browser XSS filters.
- `Referrer-Policy: strict-origin-when-cross-origin` — Protects referral leakage.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()` — Restricts invasive browser APIs.
