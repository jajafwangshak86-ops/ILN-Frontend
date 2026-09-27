import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkSmartContractsComponent,
  checkWebAppComponent,
  checkIndexerComponent,
  checkStellarRpcComponent,
} from '../scripts/check-status-page-components';

vi.mock('../src/utils/soroban', () => ({
  getProtocolStatus: vi.fn(),
}));

import { getProtocolStatus } from '../src/utils/soroban';

describe('check-status-page-components', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubEnv('SMART_CONTRACT_MANUAL_OVERRIDE', '');
    vi.stubEnv('WEBAPP_MANUAL_OVERRIDE', '');
    vi.stubEnv('INDEXER_MANUAL_OVERRIDE', '');
    vi.stubEnv('STELLAR_RPC_MANUAL_OVERRIDE', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('respects SMART_CONTRACT_MANUAL_OVERRIDE flag', async () => {
    vi.stubEnv('SMART_CONTRACT_MANUAL_OVERRIDE', 'true');
    const result = await checkSmartContractsComponent();
    expect(result.skippedOverride).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('checks Smart Contracts component when override is not set', async () => {
    vi.mocked(getProtocolStatus).mockResolvedValue({ paused: false, reason: '' });
    const result = await checkSmartContractsComponent();
    expect(result.passed).toBe(true);
    expect(result.message).toContain('fully operational');
  });

  it('respects WEBAPP_MANUAL_OVERRIDE flag', async () => {
    vi.stubEnv('WEBAPP_MANUAL_OVERRIDE', 'true');
    const result = await checkWebAppComponent();
    expect(result.skippedOverride).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('checks Web App component reachability', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const result = await checkWebAppComponent();
    expect(result.passed).toBe(true);
    expect(result.message).toContain('reachable');
  });

  it('respects INDEXER_MANUAL_OVERRIDE flag', async () => {
    vi.stubEnv('INDEXER_MANUAL_OVERRIDE', 'true');
    const result = await checkIndexerComponent();
    expect(result.skippedOverride).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('checks API / Indexer component status', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const result = await checkIndexerComponent();
    expect(result.passed).toBe(true);
    expect(result.message).toContain('online');
  });

  it('respects STELLAR_RPC_MANUAL_OVERRIDE flag', async () => {
    vi.stubEnv('STELLAR_RPC_MANUAL_OVERRIDE', 'true');
    const result = await checkStellarRpcComponent();
    expect(result.skippedOverride).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('checks Stellar RPC node getHealth response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { status: 'healthy' } }),
    });
    const result = await checkStellarRpcComponent();
    expect(result.passed).toBe(true);
    expect(result.message).toContain('healthy');
  });
});
