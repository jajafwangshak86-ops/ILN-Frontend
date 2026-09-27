'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { StrKey } from '@stellar/stellar-sdk';
import { formatAddress } from '@/utils/format';
import { resolveStellarAddressFromName } from '@/utils/federation';
import { getReputation } from '@/utils/soroban';
import * as soroban from '@/utils/soroban';

const MAX_WHITELIST_SIZE = 10;

interface WhitelistedLP {
  address: string;
  reputationScore?: number;
}

export interface LPWhitelistManagerProps {
  invoiceId: string;
  submitterAddress: string;
  currentWallet?: string;
  status: string;
  whitelist: string[];
}

export default function LPWhitelistManager({
  invoiceId,
  submitterAddress,
  currentWallet,
  status,
  whitelist,
}: LPWhitelistManagerProps) {
  const [localWhitelist, setLocalWhitelist] = useState<WhitelistedLP[]>([]);
  const [newAddress, setNewAddress] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lpToRemove, setLpToRemove] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // Determine if contract instruction is available: the deployed contract
  // does not expose update_lp_whitelist (see #783), so whitelist
  // modification is deferred behind the feature flag exported from soroban.
  const isContractSupported =
    soroban.UPDATE_LP_WHITELIST_SUPPORTED === true &&
    typeof soroban.updateLPWhitelist === 'function';

  useEffect(() => {
    let isMounted = true;

    async function loadReputations() {
      const formatted = await Promise.all(
        whitelist.map(async (address) => {
          try {
            const rep = await getReputation(address);
            return { address, reputationScore: rep?.score };
          } catch {
            return { address };
          }
        })
      );
      if (isMounted) {
        setLocalWhitelist(formatted);
      }
    }

    loadReputations();

    return () => {
      isMounted = false;
    };
  }, [whitelist]);

  // Visibility Rules
  if (!currentWallet || currentWallet.toLowerCase() !== submitterAddress.toLowerCase()) {
    return null;
  }
  if (status !== 'Pending') {
    return null;
  }

  const handleAddLP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsAdding(true);

    try {
      if (localWhitelist.length >= MAX_WHITELIST_SIZE) {
        throw new Error('Maximum whitelist size reached.');
      }

      const input = newAddress.trim();
      if (!input) {
        throw new Error('Please enter a Stellar address or federation name.');
      }

      let resolvedAddress = input;
      if (input.includes('*')) {
        try {
          resolvedAddress = await resolveStellarAddressFromName(input);
        } catch {
          throw new Error('Unable to resolve federation address.');
        }
      }

      if (!StrKey.isValidEd25519PublicKey(resolvedAddress)) {
        throw new Error('Invalid Stellar address.');
      }

      if (localWhitelist.some((lp) => lp.address.toLowerCase() === resolvedAddress.toLowerCase())) {
        throw new Error('Address is already whitelisted.');
      }

      const newWhitelist = [...localWhitelist.map((lp) => lp.address), resolvedAddress];

      if (isContractSupported) {
        await soroban.updateLPWhitelist({
          invoiceId: BigInt(invoiceId),
          whitelist: newWhitelist,
        });
      } else {
        // Fallback or optimistic addition when contract is unsupported
        // Usually, if not supported, we don't allow action, but instructions say:
        // "Scenario B: Contract Instruction Does Not Exist -> Display governance notice... No broken actions should be displayed."
        // We will hide the Add button if not supported, but this logic is here for completeness.
        throw new Error('Whitelist modification is not currently supported by the protocol.');
      }

      // Optimistic Update
      const rep = await getReputation(resolvedAddress);
      setLocalWhitelist([
        ...localWhitelist,
        { address: resolvedAddress, reputationScore: rep?.score },
      ]);
      setNewAddress('');
      setSuccessMsg('LP added successfully.');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred.');
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveLP = async () => {
    if (!lpToRemove) return;

    setError(null);
    setSuccessMsg(null);
    setIsRemoving(true);

    try {
      const newWhitelist = localWhitelist
        .map((lp) => lp.address)
        .filter((addr) => addr.toLowerCase() !== lpToRemove.toLowerCase());

      if (isContractSupported) {
        await soroban.updateLPWhitelist({
          invoiceId: BigInt(invoiceId),
          whitelist: newWhitelist,
        });
      }

      // Optimistic update
      setLocalWhitelist(
        localWhitelist.filter((lp) => lp.address.toLowerCase() !== lpToRemove.toLowerCase())
      );
      setSuccessMsg('LP removed successfully.');

      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to remove LP.');
      }
    } finally {
      setIsRemoving(false);
      setLpToRemove(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="mt-8">
      <h2 className="mb-4 text-xl font-headline font-bold text-on-surface">Manage LP Whitelist</h2>

      {!isContractSupported ? (
        <div className="mb-6 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5">
          <div className="flex items-start gap-3 text-warning">
            <span className="material-symbols-outlined shrink-0 text-xl">info</span>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">
                Whitelist modification is not currently supported by the protocol.
              </p>
              <p className="text-sm">
                A governance proposal is required to introduce an <code>update_lp_whitelist()</code>{' '}
                contract instruction.
              </p>
              <Link
                href="/governance/create"
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
              >
                Request Governance Proposal
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-bold text-on-surface-variant">
            Whitelisted LPs{' '}
            <span className="font-normal opacity-70">
              ({localWhitelist.length} / {MAX_WHITELIST_SIZE})
            </span>
          </h3>

          {localWhitelist.length >= 8 && localWhitelist.length < MAX_WHITELIST_SIZE && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
              <span className="material-symbols-outlined text-[14px]">warning</span>
              Approaching whitelist limit
            </span>
          )}

          {localWhitelist.length >= MAX_WHITELIST_SIZE && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-error/10 px-3 py-1 text-xs font-bold text-error">
              <span className="material-symbols-outlined text-[14px]">error</span>
              Maximum whitelist size reached.
            </span>
          )}
        </div>

        <div className="mb-6 flex flex-col gap-3">
          {localWhitelist.length === 0 ? (
            <div className="py-6 text-center text-sm text-on-surface-variant italic border border-dashed border-outline-variant/20 rounded-xl">
              No LPs are currently whitelisted.
            </div>
          ) : (
            localWhitelist.map((lp) => (
              <div
                key={lp.address}
                className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-[18px]">
                    check_circle
                  </span>
                  <span className="font-mono text-sm">{formatAddress(lp.address)}</span>
                  <button
                    onClick={() => copyToClipboard(lp.address)}
                    className="flex items-center text-outline-variant hover:text-primary transition-colors"
                    aria-label="Copy address"
                    title="Copy Address"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  </button>
                  {lp.reputationScore !== undefined ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary ml-2">
                      Reputation: {lp.reputationScore}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-medium text-on-surface-variant ml-2">
                      Reputation unavailable
                    </span>
                  )}
                </div>

                {isContractSupported && (
                  <button
                    onClick={() => setLpToRemove(lp.address)}
                    className="flex items-center text-on-surface-variant hover:text-error transition-colors"
                    aria-label={`Remove ${lp.address} from whitelist`}
                  >
                    <span className="text-sm font-medium mr-1 hidden sm:inline">Remove</span>
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {isContractSupported && (
          <form onSubmit={handleAddLP} className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
              <div className="flex-grow">
                <input
                  type="text"
                  placeholder="Stellar Address or federation name (e.g. alice*lobstr.co)"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  disabled={isAdding || localWhitelist.length >= MAX_WHITELIST_SIZE}
                  className="w-full rounded-xl border border-outline-variant/30 bg-surface-container p-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  aria-label="Add LP Address"
                />
              </div>
              <button
                type="submit"
                disabled={
                  isAdding || localWhitelist.length >= MAX_WHITELIST_SIZE || !newAddress.trim()
                }
                className="shrink-0 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
              >
                {isAdding ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary" />
                ) : (
                  'Add LP'
                )}
              </button>
            </div>

            <div aria-live="polite" className="min-h-[24px]">
              {error && (
                <p className="text-sm text-error flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {error}
                </p>
              )}
              {successMsg && (
                <p className="text-sm text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  {successMsg}
                </p>
              )}
            </div>
          </form>
        )}
      </div>

      {!!lpToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
            role="dialog"
            aria-labelledby="dialog-title"
            aria-describedby="dialog-desc"
          >
            <h3 id="dialog-title" className="text-xl font-bold text-on-surface mb-2">
              Remove LP from whitelist?
            </h3>
            <p id="dialog-desc" className="text-on-surface-variant mb-6 text-sm">
              Are you sure you want to remove {formatAddress(lpToRemove)} from the whitelist? They
              will no longer be able to fund this invoice.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setLpToRemove(null)}
                disabled={isRemoving}
                className="rounded-xl px-4 py-2 font-bold text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveLP}
                disabled={isRemoving}
                className="flex items-center justify-center min-w-[90px] rounded-xl bg-error px-4 py-2 font-bold text-on-error hover:bg-error/90 transition-colors disabled:opacity-50"
              >
                {isRemoving ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-on-error/30 border-t-on-error" />
                ) : (
                  'Remove'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
