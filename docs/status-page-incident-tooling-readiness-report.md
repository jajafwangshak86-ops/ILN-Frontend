# Status Page & Incident Tooling Readiness Report

_Addresses Issue #940 — consolidates the status page and incident coordination automation work (#934 to #939) and the related documentation-reconciliation items (#871, #872) into one readiness record for the mainnet launch narrative._

Snapshot: `dev` as of 2026-09-24. Update the tables below as each open item lands.

---

## Verdict

**Partially ready.** The manual advisory path is in place and has been rehearsed, and the in-app incident surfaces now hold up when several components fail at once (#939). The automation this category calls for is not built yet: the runbook documents only manual and API updates, with no automated component checks, and the related reconciliation items are open. Launch can rely on the manual process below, with the gaps listed under [Residual risk](#residual-risk).

---

## What is in place

| Capability                                                           | Evidence                                                                                                           | Status   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Status page independent of app infrastructure (Instatus)             | [Status Page Runbook](./status-page-runbook.md) (#705)                                                             | Complete |
| Manual and API incident updates with a quarterly rehearsal checklist | [Status Page Runbook](./status-page-runbook.md) (#705)                                                             | Complete |
| Incident process, severity levels, and user advisory templates       | [Incident Response](./incident-response.md) (#601, #693)                                                           | Complete |
| Frontend game-day exercise                                           | [Game-Day Exercise Report](./game-day-exercise-report.md) (#704)                                                   | Complete |
| Error-tracking detection review                                      | [Sentry Integration](./sentry-integration.md) (#706)                                                               | Complete |
| Compromised-dependency playbook                                      | [Compromised Dependency Playbook](./compromised-dependency-playbook.md) (#707)                                     | Complete |
| Cross-repo incident coordination                                     | [Cross-Repo Coordination](./cross-repo-incident-coordination.md) (#709)                                            | Complete |
| Quarterly incident contact-matrix review                             | `.github/workflows/incident-contact-matrix-freshness.yml` (#711)                                                   | Complete |
| In-app surfaces under simultaneous multi-component failure           | [Load testing: multi-incident simulation](./load-testing.md#multi-incident-load-simulation-status-surfaces) (#939) | Complete |

The in-app surfaces are: `MaintenanceModeBanner` (polls the contract's `get_protocol_status()` every 30 seconds), the `ContractEventSync` alert for the indexer and Horizon streams, and the `NotificationBell` degraded marker for the notifications service.

---

## Category status

| Issue | Item                                                               | Status   | Readiness impact                                                                                                                                                |
| ----- | ------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #871  | Automate the Smart Contracts component beyond "manual update only" | Open     | The highest-stakes component depends on someone remembering to update it                                                                                        |
| #872  | Recurring owner check for the cross-repo incident contact matrix   | Open     | Handles in [cross-repo-incident-coordination.md](./cross-repo-incident-coordination.md) can drift; the quarterly #711 review covers `incident-response.md` only |
| #934  | Automated component-level checks for every status-page component   | Resolved | Component health automation implemented in `scripts/check-status-page-components.ts` covering Web App, API / Indexer, Stellar RPC, and Smart Contracts |
| #935  | Incident history view with resolution times                        | Resolved | In-app view at `/status` ([StatusIncidentHistory](../src/components/StatusIncidentHistory.tsx)), sourced from Instatus's public summary via `GET /api/status/incidents` |
| #936  | Status-page health wired into shared alert routing                 | Resolved | `src/lib/alert-routing.ts`; see [Alert-Routing Integration](./alert-routing-integration.md) for the assumptions this makes about the backend repo's endpoint |
| #937  | Subscriber notifications for incidents (email/webhook opt-in)      | Resolved | `/status` opt-in form + `app/api/status-subscriptions/route.ts`, delivered via the Instatus incoming webhook at `app/api/status/webhook/route.ts`, reusing the Resend path documented in [notifications-service.md](./notifications-service.md) |
| #938  | Synthetic end-to-end canary feeding the status page                | Resolved | `.github/workflows/synthetic-canary-status.yml` now schedules `e2e/synthetic-integration-health.spec.ts` and reports to Instatus + alert-routing via `scripts/report-canary-result.ts`; closes readiness-report finding 5 |
| #939  | Load-test status surfaces under multi-incident failure             | Resolved | Three defects found and fixed (below)                                                                                                                           |
| #940  | This report                                                        | Resolved | —                                                                                                                                                               |

---

## Findings

From the #939 multi-incident simulation (details in [load-testing.md](./load-testing.md#multi-incident-load-simulation-status-surfaces)):

1. **Reconnect storm (fixed).** During a combined indexer and Horizon outage, `useContractEvents` left each failed Horizon stream reconnecting on its own while it scheduled a new one. By code trace, one tab could open up to 820 streams. It now opens at most 4 (the fallback plus 3 retries), and they all close on unmount.
2. **Duplicate Horizon fallback (fixed).** A WebSocket that dropped without an error triggered the fallback twice, leaking a stream.
3. **Extra notification requests (fixed).** `NotificationBell` re-polled the notifications service whenever read state changed. It now polls only on its 60-second interval.

From reconciling the documentation against the code:

4. **SLO doc overstates status-page automation.** [slos.md](./slos.md) (SLO 4) lists "Automated sync with Instatus status page", but nothing in this repository syncs to Instatus, and the runbook documents only manual and API updates. This closes when #934 and #871 land.
5. **Synthetic health check is not scheduled.** [slos.md](./slos.md) says `e2e/synthetic-integration-health.spec.ts` runs every 15 minutes, but no workflow runs it. Only `e2e/mainnet-smoke.spec.ts` runs, on deploy and promotion. #938 is where a scheduled check should feed the status page.
6. **RPC outage has no in-app indicator.** `getProtocolStatus()` falls back to "not paused" when the Stellar RPC is unreachable, so the maintenance banner stays hidden. This is intentional (the banner never blocks rendering), so RPC reachability needs its own check under #934 / #871.

---

## Residual risk

Until the open items land, launch relies on:

- The Communications Lead updating Instatus components by hand, following the [Status Page Runbook](./status-page-runbook.md) time targets.
- Instatus's built-in subscriber emails for proactive notice.
- The quarterly rehearsal checklist to confirm the status page, its credentials, and its API key still work.

Items 4 and 5 above mean the SLO document should not be read as evidence of automation that does not exist yet.

---

## Related

- [Status Page Runbook](./status-page-runbook.md)
- [Incident Response](./incident-response.md)
- [Cross-Repo Incident Coordination](./cross-repo-incident-coordination.md)
- [Game-Day Exercise Report](./game-day-exercise-report.md)
- [Load Testing](./load-testing.md)
- [Mainnet Frontend Readiness Checklist](./mainnet-frontend-readiness-checklist.md)
