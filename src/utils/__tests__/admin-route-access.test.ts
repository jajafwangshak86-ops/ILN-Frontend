/**
 * Route-access matrix and mutation-guard regression tests (#916).
 *
 * Pins the #915 audit outcome at the level the wallet-based enforcement
 * mechanism allows:
 *
 * - `/admin/actions` is intentionally PUBLIC (read-only transparency log).
 * - `/admin` and `/admin/flags` are admin-gated via `isAdminAddress()`, and
 *   the privileged mutations (`setProtocolPaused`, `executeReadyProposals`)
 *   fail fast for non-admin callers instead of attempting a transaction the
 *   contract would refuse.
 *
 * There are no admin API routes to probe — reads go directly to Soroban RPC
 * (public chain state) and writes are signed in Freighter — so these unit
 * tests assert the actual enforcement points: the address check, the
 * mutation guards, and the documented per-route access matrix.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  executeReadyProposals,
  isAdminAddress,
  setProtocolPaused,
} from '../admin-health';
import { requireAdmin } from '@/lib/admin-gate';
import { GOVERNANCE_ADMIN_ADDRESS } from '@/constants';

const getAllInvoicesMock = vi.fn();
const getNativeXlmBalanceMock = vi.fn();
vi.mock('@/utils/soroban', () => ({
  getAllInvoices: (...args: unknown[]) => getAllInvoicesMock(...args),
  getNativeXlmBalance: (...args: unknown[]) => getNativeXlmBalanceMock(...args),
}));

const fetchProposalsMock = vi.fn();
const executeProposalMock = vi.fn();
vi.mock('@/utils/governance', () => ({
  fetchProposals: (...args: unknown[]) => fetchProposalsMock(...args),
  fetchSignerRotations: vi.fn(async () => []),
  fetchParameterUpdates: vi.fn(async () => []),
  executeProposal: (...args: unknown[]) => executeProposalMock(...args),
}));

const NON_ADMIN = 'GBNONADMINWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB';

/**
 * The documented access matrix from docs/route-map.md ("Admin Route
 * Authorization"). `/admin/actions` is public by design; the other two
 * admin routes require the admin wallet.
 */
const ROUTE_ACCESS: Record<
  '/admin' | '/admin/actions' | '/admin/flags',
  'admin' | 'public'
> = {
  '/admin': 'admin',
  '/admin/actions': 'public',
  '/admin/flags': 'admin',
};

function canViewRoute(
  route: keyof typeof ROUTE_ACCESS,
  address: string | null | undefined
): boolean {
  if (ROUTE_ACCESS[route] === 'public') return true;
  return isAdminAddress(address) && requireAdmin(address).authorized;
}

describe('admin route-access matrix', () => {
  it('denies a non-admin wallet on /admin and /admin/flags', () => {
    expect(canViewRoute('/admin', NON_ADMIN)).toBe(false);
    expect(canViewRoute('/admin/flags', NON_ADMIN)).toBe(false);
  });

  it('denies a disconnected wallet on /admin and /admin/flags', () => {
    for (const address of [null, undefined] as const) {
      expect(canViewRoute('/admin', address)).toBe(false);
      expect(canViewRoute('/admin/flags', address)).toBe(false);
    }
  });

  it('grants the admin wallet on /admin and /admin/flags', () => {
    expect(canViewRoute('/admin', GOVERNANCE_ADMIN_ADDRESS)).toBe(true);
    expect(canViewRoute('/admin/flags', GOVERNANCE_ADMIN_ADDRESS)).toBe(true);
  });

  it('leaves /admin/actions public for every caller, by design', () => {
    for (const address of [GOVERNANCE_ADMIN_ADDRESS, NON_ADMIN, null, undefined] as const) {
      expect(canViewRoute('/admin/actions', address)).toBe(true);
    }
  });
});

describe('admin mutation guards', () => {
  it('setProtocolPaused rejects a non-admin caller before signing', async () => {
    const signTx = vi.fn();
    await expect(setProtocolPaused(true, NON_ADMIN, signTx)).rejects.toThrow(
      /admin access required/i
    );
    expect(signTx).not.toHaveBeenCalled();
  });

  it('setProtocolPaused rejects a disconnected wallet', async () => {
    await expect(setProtocolPaused(true, null as unknown as string, vi.fn())).rejects.toThrow(
      /admin access required/i
    );
  });

  it('executeReadyProposals rejects a non-admin caller without touching the contract', async () => {
    const signTx = vi.fn();
    const proposals = [{ id: 1, status: 'Passed' }] as never[];
    await expect(executeReadyProposals(proposals, NON_ADMIN, signTx)).rejects.toThrow(
      /admin access required/i
    );
    expect(executeProposalMock).not.toHaveBeenCalled();
    expect(signTx).not.toHaveBeenCalled();
  });

  it('executeReadyProposals still executes for the admin caller', async () => {
    executeProposalMock.mockResolvedValue({ id: 1, txHash: 'tx-1' });
    const proposals = [{ id: 1, status: 'Passed' }] as never[];
    const results = await executeReadyProposals(proposals, GOVERNANCE_ADMIN_ADDRESS, vi.fn());
    expect(results).toEqual([{ id: 1, txHash: 'tx-1' }]);
  });
});
