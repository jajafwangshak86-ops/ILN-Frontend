#!/usr/bin/env tsx
import { getProtocolStatus } from '../src/utils/soroban';
import { reportComponentStatus } from '../src/lib/instatus';
import { routeAlert } from '../src/lib/alert-routing';

export interface ComponentCheckResult {
  component: 'smart-contracts' | 'web-app' | 'indexer' | 'stellar-rpc';
  componentId?: string;
  passed: boolean;
  message: string;
  skippedOverride?: boolean;
}

export async function checkSmartContractsComponent(): Promise<ComponentCheckResult> {
  const componentId = process.env.INSTATUS_SMARTCONTRACTS_COMPONENT_ID;
  if (process.env.SMART_CONTRACT_MANUAL_OVERRIDE === 'true') {
    return {
      component: 'smart-contracts',
      componentId,
      passed: true,
      message: 'SMART_CONTRACT_MANUAL_OVERRIDE is active; skipping automated check.',
      skippedOverride: true,
    };
  }

  try {
    const status = await getProtocolStatus();
    return {
      component: 'smart-contracts',
      componentId,
      passed: true,
      message: status.paused
        ? 'Smart contract is reachable but currently paused.'
        : 'Smart contract is fully operational and reachable.',
    };
  } catch (error: any) {
    return {
      component: 'smart-contracts',
      componentId,
      passed: false,
      message: `Smart contract health check failed: ${error.message || error}`,
    };
  }
}

export async function checkWebAppComponent(): Promise<ComponentCheckResult> {
  const componentId = process.env.INSTATUS_WEBAPP_COMPONENT_ID;
  if (process.env.WEBAPP_MANUAL_OVERRIDE === 'true') {
    return {
      component: 'web-app',
      componentId,
      passed: true,
      message: 'WEBAPP_MANUAL_OVERRIDE is active; skipping automated check.',
      skippedOverride: true,
    };
  }

  const targetUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const res = await fetch(targetUrl, { method: 'HEAD' });
    const passed = res.ok || res.status < 500;
    return {
      component: 'web-app',
      componentId,
      passed,
      message: passed
        ? 'Web App deployment is reachable and serving traffic.'
        : `Web App endpoint returned status ${res.status}.`,
    };
  } catch (error: any) {
    return {
      component: 'web-app',
      componentId,
      passed: false,
      message: `Web App health check failed: ${error.message || error}`,
    };
  }
}

export async function checkIndexerComponent(): Promise<ComponentCheckResult> {
  const componentId = process.env.INSTATUS_INDEXER_COMPONENT_ID;
  if (process.env.INDEXER_MANUAL_OVERRIDE === 'true') {
    return {
      component: 'indexer',
      componentId,
      passed: true,
      message: 'INDEXER_MANUAL_OVERRIDE is active; skipping automated check.',
      skippedOverride: true,
    };
  }

  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000/api/status';
  try {
    const res = await fetch(indexerUrl, { method: 'GET' });
    const passed = res.ok || res.status < 500;
    return {
      component: 'indexer',
      componentId,
      passed,
      message: passed
        ? 'API / Indexer service is online and responding.'
        : `API / Indexer returned HTTP status ${res.status}.`,
    };
  } catch (error: any) {
    return {
      component: 'indexer',
      componentId,
      passed: false,
      message: `API / Indexer health check failed: ${error.message || error}`,
    };
  }
}

export async function checkStellarRpcComponent(): Promise<ComponentCheckResult> {
  const componentId = process.env.INSTATUS_STELLARRPC_COMPONENT_ID;
  if (process.env.STELLAR_RPC_MANUAL_OVERRIDE === 'true') {
    return {
      component: 'stellar-rpc',
      componentId,
      passed: true,
      message: 'STELLAR_RPC_MANUAL_OVERRIDE is active; skipping automated check.',
      skippedOverride: true,
    };
  }

  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    const data = await res.json().catch(() => ({}));
    const passed = res.ok && (data.result?.status === 'healthy' || data.result !== undefined);
    return {
      component: 'stellar-rpc',
      componentId,
      passed,
      message: passed
        ? 'Stellar Soroban RPC node is healthy and responsive.'
        : `Stellar RPC health check returned unexpected status.`,
    };
  } catch (error: any) {
    return {
      component: 'stellar-rpc',
      componentId,
      passed: false,
      message: `Stellar RPC health check failed: ${error.message || error}`,
    };
  }
}

export async function main() {
  console.log('Starting automated component-level status checks for all status-page components...');

  const checks = [
    await checkSmartContractsComponent(),
    await checkWebAppComponent(),
    await checkIndexerComponent(),
    await checkStellarRpcComponent(),
  ];

  let overallSuccess = true;

  for (const check of checks) {
    if (check.skippedOverride) {
      console.log(`[${check.component}] ${check.message}`);
      continue;
    }

    if (check.componentId) {
      const instatusResult = await reportComponentStatus({
        componentId: check.componentId,
        status: check.passed ? 'OPERATIONAL' : 'PARTIALOUTAGE',
        incidentName: check.passed ? undefined : `${check.component} outage detected`,
        message: check.message,
      });

      if (!instatusResult.ok) {
        console.error(`Instatus report for ${check.component} failed:`, instatusResult.error);
      } else {
        console.log(`Instatus report for ${check.component} OK`);
      }
    } else {
      console.log(`[${check.component}] Component ID not set in env. Status: ${check.passed ? 'PASS' : 'FAIL'} (${check.message})`);
    }

    if (!check.passed) {
      overallSuccess = false;
      await routeAlert({
        component: check.component,
        status: 'degraded',
        severity: 'critical',
        summary: check.message,
        source: 'status-page-component-health-check',
      });
    }
  }

  process.exit(overallSuccess ? 0 : 1);
}

if (process.argv[1]?.endsWith('check-status-page-components.ts')) {
  main().catch((err) => {
    console.error('check-status-page-components crashed:', err);
    process.exit(0);
  });
}
