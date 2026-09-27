'use client';

import React, { useMemo, useState } from 'react';
import { Invoice } from '@/utils/soroban';
import { useTransaction } from '@/hooks/useTransaction';
import { useWallet } from '@/context/WalletContext';
import { useBalances } from '@/hooks/useBalances';
import TokenSelector from './TokenSelector';
import { formatTokenAmount } from '@/utils/format';
import type { ApprovedToken } from '@/hooks/useApprovedTokens';
import DestinationConfirmationInput from './DestinationConfirmationInput';
import {
  TransactionBuilder,
  Operation,
  Address,
  nativeToScVal,
  BASE_FEE,
  rpc,
} from '@stellar/stellar-sdk';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
  TESTNET_EURC_TOKEN_ID,
  TESTNET_USDC_TOKEN_ID,
  TESTNET_XLM_TOKEN_ID,
} from '@/constants';

const G_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

const TRANSFER_TOKENS: ApprovedToken[] = [
  {
    contractId: TESTNET_USDC_TOKEN_ID,
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 7,
    iconLabel: 'US',
    logo: '/tokens/usdc.svg',
    isAllowed: true,
  },
  {
    contractId: TESTNET_EURC_TOKEN_ID,
    name: 'Euro Coin',
    symbol: 'EURC',
    decimals: 7,
    iconLabel: 'EU',
    logo: '/tokens/eurc.svg',
    isAllowed: true,
  },
  {
    contractId: TESTNET_XLM_TOKEN_ID,
    name: 'Stellar Lumens',
    symbol: 'XLM',
    decimals: 7,
    iconLabel: 'XL',
    logo: '/tokens/xlm.svg',
    isAllowed: true,
  },
];

const TOKEN_MINIMUMS: Record<string, bigint> = {
  USDC: 1_0000000n,
  EURC: 1_0000000n,
  XLM: 10_0000000n,
};

interface LPTransferModalProps {
  invoice: Invoice;
  onClose: () => void;
  onSuccess: (invoice: Invoice, newOwner: string) => void;
}

async function buildTransferLPPositionTx(funder: string, invoiceId: bigint, newOwner: string) {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(funder);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: 'transfer_lp_position',
        args: [nativeToScVal(invoiceId, { type: 'u64' }), Address.fromString(newOwner).toScVal()],
      })
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${'error' in sim ? sim.error : 'unknown error'}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

export default function LPTransferModal({ invoice, onClose, onSuccess }: LPTransferModalProps) {
  const { address } = useWallet();
  const { execute, loading, error: txError } = useTransaction();
  const initialTokenId = invoice.token ?? TESTNET_USDC_TOKEN_ID;
  const [recipient, setRecipient] = useState('');
  const [isDestinationConfirmed, setIsDestinationConfirmed] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState(initialTokenId);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { balances, unavailable, isLoading: balancesLoading } = useBalances(TRANSFER_TOKENS);

  const selectedToken = useMemo(
    () =>
      TRANSFER_TOKENS.find((token) => token.contractId === selectedTokenId) ?? TRANSFER_TOKENS[0],
    [selectedTokenId]
  );
  const selectedBalance = balances.get(selectedToken.contractId);
  const minimumAmount = TOKEN_MINIMUMS[selectedToken.symbol] ?? 0n;
  const invoiceTokenId = invoice.token ?? TESTNET_USDC_TOKEN_ID;
  const tokenMatchesInvoice = selectedToken.contractId === invoiceTokenId;

  const validate = (value: string): string | null => {
    if (!value.trim()) return 'Recipient address is required.';
    if (!G_ADDRESS_RE.test(value.trim()))
      return 'Enter a valid Stellar G-address (56 characters starting with G).';
    if (value.trim() === address) return 'You cannot transfer a position to yourself.';
    if (!tokenMatchesInvoice) {
      return `Select the invoice token before transferring. Invoice #${invoice.id.toString()} is denominated in ${selectedTokenLabel(
        invoiceTokenId
      )}.`;
    }
    if (invoice.amount < minimumAmount) {
      return `${selectedToken.symbol} transfers require at least ${formatTokenAmount(
        minimumAmount,
        selectedToken
      )}.`;
    }
    if (balancesLoading) {
      return `${selectedToken.symbol} balance is still loading. Please try again in a moment.`;
    }
    if (unavailable.has(selectedToken.contractId)) {
      return `${selectedToken.symbol} balance is unavailable. Add the trustline or refresh your wallet before transferring.`;
    }
    if (selectedBalance !== undefined && selectedBalance < invoice.amount) {
      return `Insufficient ${selectedToken.symbol} balance for this transfer.`;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(recipient);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);

    try {
      const tx = await buildTransferLPPositionTx(address!, invoice.id, recipient.trim());
      const txHash = await execute(
        tx,
        `Transfer ${formatTokenAmount(invoice.amount, selectedToken)} LP position #${invoice.id}`
      );
      if (txHash) {
        onSuccess(invoice, recipient.trim());
      }
    } catch (e: any) {
      setValidationError(e.message ?? 'Transfer failed.');
    }
  };

  const displayError = validationError ?? txError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lp-transfer-title"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-3xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="lp-transfer-title" className="text-lg font-semibold text-on-surface">
            Transfer LP Position #{invoice.id.toString()}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-variant/30"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Warning:</strong> Transferring this position permanently reassigns payout
          ownership to the new address. You will no longer receive repayment for invoice #
          {invoice.id.toString()}.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <TokenSelector
            label="Transfer token"
            value={selectedTokenId}
            tokens={TRANSFER_TOKENS}
            showBalances
            onChange={(value) => {
              setSelectedTokenId(value);
              setValidationError(null);
            }}
            hint={`Minimum transfer: ${formatTokenAmount(minimumAmount, selectedToken)}`}
          />

          <div className="rounded-2xl border border-outline-variant/15 bg-surface-container px-4 py-3 text-sm text-on-surface">
            <div className="flex items-center justify-between gap-3">
              <span className="text-on-surface-variant">Position amount</span>
              <span className="font-bold">{formatTokenAmount(invoice.amount, selectedToken)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-on-surface-variant">Wallet balance</span>
              <span className="font-bold">
                {balancesLoading
                  ? 'Loading...'
                  : selectedBalance !== undefined
                    ? formatTokenAmount(selectedBalance, selectedToken)
                    : unavailable.has(selectedToken.contractId)
                      ? 'Unavailable'
                      : formatTokenAmount(0n, selectedToken)}
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="lp-transfer-recipient"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant"
            >
              Recipient Stellar Address
            </label>
            <input
              id="lp-transfer-recipient"
              type="text"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setValidationError(null);
              }}
              placeholder="G..."
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2.5 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <DestinationConfirmationInput
            destinationAddress={recipient}
            onConfirmationChange={setIsDestinationConfirmed}
          />

          <div className="rounded-2xl border border-primary/15 bg-primary-container/20 px-4 py-3 text-xs text-on-surface-variant">
            Confirm transfer of{' '}
            <span className="font-bold text-on-surface">
              {formatTokenAmount(invoice.amount, selectedToken)}
            </span>{' '}
            for invoice #{invoice.id.toString()} to the recipient above.
          </div>

          {displayError && (
            <p role="alert" className="text-sm text-error">
              {displayError}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || balancesLoading || !isDestinationConfirmed || !recipient.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-surface-container-lowest transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
            >
              {loading && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-container-lowest border-t-transparent" />
              )}
              Transfer Position
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-dim disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function selectedTokenLabel(tokenId: string): string {
  return (
    TRANSFER_TOKENS.find((token) => token.contractId === tokenId)?.symbol ?? 'the selected token'
  );
}
