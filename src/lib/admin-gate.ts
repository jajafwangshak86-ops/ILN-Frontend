/**
 * Server-safe admin authorization gate (#915).
 *
 * The admin pages (`/admin`, `/admin/flags`) are `'use client'` components
 * gated in the browser by `isAdminAddress()` from `@/utils/admin-health`,
 * which compares the connected wallet address against
 * `NEXT_PUBLIC_GOVERNANCE_ADMIN_ADDRESS`. A wallet address is a client-side
 * credential: there is no session cookie for Next.js middleware or a server
 * component to verify, so page-level gating alone is bypassable by a
 * modified client. That is acceptable here because:
 *
 * - Privileged *reads* do not exist: protocol health and the admin action
 *   history are public on-chain state read via Soroban RPC. Bypassing the UI
 *   gate reveals nothing a non-admin could not already query directly.
 * - Privileged *writes* (pause/unpause, proposal execution, token allowlist
 *   changes) require a Freighter signature from the admin key itself. The
 *   Stellar contract is the real enforcement point — a non-admin signer is
 *   rejected on-chain regardless of what the UI allowed.
 *
 * This module is the canonical enforcement point for any current or future
 * **server** admin surface (API routes, server actions). It performs the same
 * wallet-address comparison without browser dependencies so it can run in
 * route handlers and middleware-adjacent code, and it produces a consistent
 * `403` denial shape. Mutations in `@/utils/admin-health` fail fast through
 * `assertAdminAddress()` so a non-admin caller gets an explicit rejection
 * instead of attempting a transaction the contract would refuse.
 *
 * `/admin/actions` is intentionally NOT gated: it is a public, read-only
 * transparency log (`AdminActionHistoryPanel` with `publicView`) sourced
 * from the on-chain admin action history view.
 */

import { GOVERNANCE_ADMIN_ADDRESS } from '@/constants';

/** Machine-readable code for admin denials, used by the 403 response body. */
export const ADMIN_ACCESS_DENIED_CODE = 'ADMIN_ACCESS_REQUIRED' as const;

export interface AdminGranted {
  authorized: true;
  adminAddress: string;
}

export interface AdminDenied {
  authorized: false;
  /** Always 403 — non-admin callers are authenticated but forbidden. */
  status: 403;
  code: typeof ADMIN_ACCESS_DENIED_CODE;
  message: string;
}

export type AdminDecision = AdminGranted | AdminDenied;

/**
 * Pure wallet-address comparison. `adminAddress` defaults to the configured
 * governance admin so route handlers can call `requireAdmin(candidate)`
 * with a single argument; tests inject an explicit allowlist value.
 */
export function isAdminAddressFromValue(
  address: string | null | undefined,
  adminAddress: string = GOVERNANCE_ADMIN_ADDRESS
): boolean {
  return Boolean(address) && address === adminAddress;
}

/**
 * Authorize a candidate admin address. Returns a discriminated union so
 * callers handle the denial explicitly instead of catching.
 */
export function requireAdmin(
  address: string | null | undefined,
  adminAddress: string = GOVERNANCE_ADMIN_ADDRESS
): AdminDecision {
  if (isAdminAddressFromValue(address, adminAddress)) {
    return { authorized: true, adminAddress: address as string };
  }
  return {
    authorized: false,
    status: 403,
    code: ADMIN_ACCESS_DENIED_CODE,
    message:
      'Admin access required. Connect the configured governance admin address.',
  };
}

/**
 * Throw when `address` is not the configured admin. Used by privileged
 * client-side mutations to fail fast with an explicit rejection before any
 * transaction is built or signed.
 *
 * @throws {Error} with message `Admin access required …` for non-admin input.
 */
export function assertAdminAddress(
  address: string | null | undefined,
  adminAddress: string = GOVERNANCE_ADMIN_ADDRESS
): asserts address is string {
  if (!isAdminAddressFromValue(address, adminAddress)) {
    throw new Error(
      'Admin access required: connect the configured governance admin address.'
    );
  }
}

/**
 * Convert a denial from {@link requireAdmin} into an HTTP response for use
 * in API route handlers. Kept separate from `requireAdmin` so unit tests
 * can assert the authorization decision without depending on web runtimes.
 */
export function adminForbiddenResponse(denial: AdminDenied): Response {
  return Response.json(
    { error: denial.code, message: denial.message },
    { status: denial.status }
  );
}
