'use client';

import React from 'react';
import { ExternalLink, PlusCircle } from 'lucide-react';
import { useApprovedTokens } from '@/hooks/useApprovedTokens';
import { useWallet } from '@/context/WalletContext';
import { TokenIcon } from '@/components/TokenSelector';
import type { ApprovedToken } from '@/hooks/useApprovedTokens';

const STELLAR_DEX_BASE = 'https://stellarterm.com/exchange';

const TOKEN_NOTES: Record<string, string> = {
  XLM: 'Native Stellar asset — no trustline required. Precision: 7 decimal places.',
  USDC: 'Circle USD Coin on Stellar. Requires a trustline.',
  EURC: 'Circle Euro Coin on Stellar. Requires a trustline.',
};

function getAcquireUrl(token: ApprovedToken): string {
  if (token.symbol === 'XLM') return 'https://www.stellar.org/lumens/buy';
  return `${STELLAR_DEX_BASE}/${token.symbol}-${token.contractId}/XLM-native`;
}

function TokenCard({
  token,
  onAddTrustline,
}: {
  token: ApprovedToken;
  onAddTrustline: (t: ApprovedToken) => void;
}) {
  const { isConnected } = useWallet();
  const isNative = token.contractId === 'native-xlm' || token.symbol === 'XLM';

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5"
      data-testid={`token-card-${token.symbol}`}
    >
      <div className="flex items-center gap-3">
        <TokenIcon token={token} className="h-10 w-10 text-sm" />
        <div>
          <p className="font-bold text-on-surface">{token.symbol}</p>
          <p className="text-xs text-on-surface-variant">{token.name}</p>
        </div>
        {token.isAllowed ? (
          <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
            Active
          </span>
        ) : (
          <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
            Inactive
          </span>
        )}
      </div>

      <div className="text-xs text-on-surface-variant space-y-1">
        <p>
          <span className="font-semibold text-on-surface">Contract: </span>
          <span className="font-mono break-all">{token.contractId}</span>
        </p>
        {TOKEN_NOTES[token.symbol] && <p className="italic">{TOKEN_NOTES[token.symbol]}</p>}
      </div>

      <div className="flex gap-2 mt-auto">
        <a
          href={getAcquireUrl(token)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Acquire
        </a>
        {!isNative && (
          <button
            type="button"
            onClick={() => onAddTrustline(token)}
            disabled={!isConnected}
            title={isConnected ? 'Add trustline via Freighter' : 'Connect wallet to add trustline'}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`add-trustline-${token.symbol}`}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Add to Wallet
          </button>
        )}
      </div>
    </div>
  );
}

export default function TokensPage() {
  const { tokens, isLoading, error } = useApprovedTokens();
  const { isConnected } = useWallet();

  async function handleAddTrustline(token: ApprovedToken) {
    if (!isConnected) return;
    try {
      const freighter = await import('@stellar/freighter-api');
      // as-any justification: @stellar/freighter-api does not type the
      // experimental `addTrustline` wallet method, so we cast the module
      // namespace to reach it. Remove once upstream types include it.
      // See https://github.com/stellar/freighter/issues (addTrustline typing gap).
      await (freighter as any).addTrustline?.({
        assetCode: token.symbol,
        assetIssuer: token.contractId,
      });
    } catch {
      // Freighter handles its own error UI
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-on-surface mb-1">Supported Tokens</h1>
      <p className="text-on-surface-variant mb-8 text-sm">
        Live allowlist from the ILN protocol contract. No wallet required to view.
      </p>

      {isLoading && (
        <p className="text-on-surface-variant text-sm" role="status">
          Loading tokens…
        </p>
      )}

      {error && (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      )}

      {!isLoading && !error && tokens.length === 0 && (
        <p className="text-on-surface-variant text-sm" data-testid="no-tokens">
          No supported tokens found.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((token) => (
          <TokenCard key={token.contractId} token={token} onAddTrustline={handleAddTrustline} />
        ))}
      </div>
    </main>
  );
}
