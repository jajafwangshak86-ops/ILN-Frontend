# Status Page Setup & Communications Lead Runbook

_Addresses Issue #705 — verifies the Communications Lead has a tested, ready advisory mechanism independent of the main application infrastructure._

---

## Overview

ILN's status page runs on **[Instatus](https://instatus.com)** (free tier), a third-party hosted service with infrastructure completely separate from the Vercel deployment and Supabase backend. This means the status page remains reachable even during a full production outage.

**Live URL:** `https://iln.instatus.com`  
**Admin panel:** `https://app.instatus.com` (login with the shared `comms@iln.finance` credential stored in the team 1Password vault under _ILN Ops > Instatus Admin_)

The page is **publicly readable** (no login required for users) and is linked from:
- The main app footer
- `SECURITY.md`
- The incident advisory email templates in Section 5 of `incident-response.md`

---

## Monitored Components

The following components are tracked on the status page:

| Component | What it covers | Automation Status |
|---|---|---|
| **Web App** | `app.iln.finance` — Vercel edge deployment | Automated via `check-status-page-components.ts` (with `WEBAPP_MANUAL_OVERRIDE` bypass) |
| **API / Indexer** | Backend invoice indexer and Supabase REST/Realtime | Automated via `check-status-page-components.ts` (with `INDEXER_MANUAL_OVERRIDE` bypass) |
| **Stellar RPC** | `soroban-rpc.stellar.org` connectivity | Automated via `check-status-page-components.ts` (with `STELLAR_RPC_MANUAL_OVERRIDE` bypass) |
| **Smart Contracts** | Invoice escrow contract availability | Automated via `check-status-page-components.ts` / `check-contract-health.ts` (with `SMART_CONTRACT_MANUAL_OVERRIDE` bypass) |

---

## How to Update the Status Page During an Incident

The Communications Lead is responsible for all status page updates. Do this in parallel with containment steps — users need information as early as possible.

### Step 1 — Create an Incident (< 2 minutes)

1. Log in to `https://app.instatus.com`.
2. Click **New Incident** in the top-right corner.
3. Fill in:
   - **Title**: Use the advisory templates in `incident-response.md` Section 5 as a guide. E.g. _Security Advisory — Suspicious Signing Prompts Detected_.
   - **Status**: Set to **Investigating**.
   - **Affected components**: Select all components the incident touches.
   - **Notify subscribers**: Check this box — it triggers an email/push to all opted-in users.
4. Click **Create Incident**.

Alternatively, use the Instatus API for automation (see [Automation](#automation) below).

### Step 2 — Post Updates

As the incident progresses, add timestamped updates:

1. Open the active incident in the admin panel.
2. Click **Add Update**.
3. Change the status to one of:
   - **Identified** — root cause is known
   - **Monitoring** — fix deployed, watching metrics
   - **Resolved** — all clear
4. Paste the relevant template from `incident-response.md` Section 5 (Template A → B → C as the incident progresses).
5. Click **Post Update**. Subscribers are notified automatically.

### Step 3 — Resolve and Close

Once the incident is fully resolved:
1. Set status to **Resolved**.
2. Post a final update summarising what happened and what was fixed (use Template C from `incident-response.md`).
3. Click **Resolve Incident**.

---

## Automation

The Instatus REST API allows the Incident Commander or automated monitors to open/update incidents without the admin UI. The API key is stored in 1Password under _ILN Ops > Instatus API Key_.

```bash
# Open a new incident (SEV-1)
curl -X POST https://api.instatus.com/v1/$PAGE_ID/incidents \
  -H "Authorization: Bearer $INSTATUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Security Advisory — Suspicious Signing Prompts Detected",
    "message": "We are investigating a potential security incident. Do NOT sign any transactions until further notice.",
    "components": [{ "id": "$WEBAPP_COMPONENT_ID", "status": "UNDERMAINTENANCE" }],
    "status": "INVESTIGATING",
    "notify": true
  }'

# Post an update
curl -X POST https://api.instatus.com/v1/$PAGE_ID/incidents/$INCIDENT_ID/incident-updates \
  -H "Authorization: Bearer $INSTATUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Incident mitigated. Clean deployment is live. Users may safely resume wallet interactions.",
    "status": "RESOLVED",
    "notify": true
  }'
```

Environment variables (`INSTATUS_API_KEY`, `PAGE_ID`, component IDs) are documented in `.env.example` under the `# Incident operations` section.

---

## Verified Independence from Main Infrastructure

The status page satisfies the independence requirement because:

1. **Hosted on Instatus infrastructure** — no dependency on Vercel, Supabase, or any ILN-operated server.
2. **Reachable over a separate domain** (`iln.instatus.com`) — not affected by DNS issues at `iln.finance`.
3. **Email notifications sent via Instatus's own SMTP** — not routed through ILN's Resend/email infrastructure.
4. **Admin panel accessible from any network** — the Communications Lead can update it from a mobile device if the office network is compromised.

---

## Rehearsal Checklist

Run this checklist quarterly and after any real incident to confirm the status page remains operational:

- [ ] Log in to `https://app.instatus.com` successfully with the shared credential.
- [ ] Create a test incident titled `[TEST] Rehearsal — ignore`.
- [ ] Confirm the incident appears at `https://iln.instatus.com` within 30 seconds.
- [ ] Post an update and confirm subscribers receive a notification email (use a personal address subscribed to the page).
- [ ] Set status to **Resolved** and confirm the page updates.
- [ ] Delete the test incident from the admin panel.
- [ ] Confirm the API key still works: run the `curl` command above with `"notify": false` on a test incident.

Record rehearsal results (date, operator, pass/fail for each step) in a comment on Issue #705 or in the post-incident review doc.

---

## Runbook Quick Reference

| Situation | Action | Time target |
|---|---|---|
| SEV-1 detected | Open incident, set **Investigating**, notify subscribers | < 5 minutes from IC decision |
| Root cause identified | Post update, change to **Identified** | < 15 minutes |
| Rollback complete | Post update, change to **Monitoring** | Within 5 minutes of rollback |
| All clear confirmed | Post **Resolved** update, close incident | Within 5 minutes of smoke test passing |

---

## Related

- [Incident Response Process](./incident-response.md)
- [Game-Day Exercise Report](./game-day-exercise-report.md)
- [Sentry Integration](./sentry-integration.md)
- [Status Page & Incident Tooling Readiness Report](./status-page-incident-tooling-readiness-report.md) — what is automated, what is still manual, and open gaps (#940)
