'use client';

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import ActivityFeed from '@/components/ActivityFeed';
import CancelInvoiceButton from '@/components/CancelInvoiceButton';
import DynamicInvoicePdfButton from '@/components/DynamicInvoicePdfButton';
import ShareInvoiceButton from '@/components/ShareInvoiceButton';
import MarkPaidButton from '@/components/MarkPaidButton';
import LPTransferModal from '@/components/LPTransferModal';
import FundConfirmModal from '@/components/FundConfirmModal';
import DisputeInvoiceModal from '@/components/DisputeInvoiceModal';
import InvoiceStatusBadge from '@/components/InvoiceStatusBadge';
import InvoiceLifecycleTimeline from '@/components/InvoiceLifecycleTimeline';
import InvoiceNftCard from '@/components/InvoiceNftCard';
import LPWhitelistManager from '@/components/invoices/LPWhitelistManager';
import { useWallet } from '@/context/WalletContext';
import { useApprovedTokens } from '@/hooks/useApprovedTokens';
import { formatAddress, formatDate, formatUSDC } from '@/utils/format';
import { getInvoice, type Invoice } from '@/utils/soroban';
import { NEXT_PUBLIC_NFT_ENABLED } from '@/constants';

type LoadState = 'loading' | 'success' | 'error';

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { address, connect } = useWallet();
  const { tokenMap, defaultToken } = useApprovedTokens();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const invoiceId = BigInt(id);

  const fetchInvoice = useCallback(async () => {
    try {
      setLoadState('loading');
      setInvoice(await getInvoice(invoiceId));
      setLoadState('success');
    } catch {
      setError('Failed to load invoice details.');
      setLoadState('error');
    }
  }, [invoiceId]);

  useEffect(() => {
    void fetchInvoice();
  }, [fetchInvoice]);

  if (loadState === 'loading') {
    return (
      <main className="min-h-screen">
        <Navbar />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-outline-variant/30 border-t-primary" />
        </div>
      </main>
    );
  }

  if (loadState === 'error' || !invoice) {
    return (
      <main className="min-h-screen">
        <Navbar />
        <section className="px-4 pt-32 text-center">
          <h1 className="text-2xl font-headline">Invoice Not Found</h1>
          <p className="mt-2 text-on-surface-variant">
            {error || 'The requested invoice does not exist.'}
          </p>
        </section>
      </main>
    );
  }

  const tokenSymbol =
    tokenMap.get(invoice.token ?? defaultToken?.contractId ?? '')?.symbol ?? 'USDC';

  return (
    <main className="min-h-screen">
      <Navbar />
      <section className="px-6 pb-10 pt-32 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                Invoice Detail
              </p>
              <h1 className="mt-2 text-3xl font-headline">Invoice #{invoice.id.toString()}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* PDF export is available for every invoice state (#21). */}
              <DynamicInvoicePdfButton
                invoice={invoice}
                data={{
                  tokenSymbol,
                  amountFormatted: formatUSDC(invoice.amount),
                  dueDateFormatted: formatDate(invoice.due_date),
                }}
              />
              {/* Sharing is offered to the submitter (#23). */}
              {address && invoice.freelancer.toLowerCase() === address.toLowerCase() ? (
                <ShareInvoiceButton invoice={invoice} />
              ) : null}
              {!address ? (
                <button
                  type="button"
                  onClick={connect}
                  className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary"
                >
                  Connect Wallet
                </button>
              ) : (
                <>
                  {/* Each action self-guards on role + status, so only the
                      button relevant to the connected wallet renders. */}
                  {invoice.status === 'Pending' &&
                  invoice.freelancer.toLowerCase() !== address.toLowerCase() &&
                  invoice.payer.toLowerCase() !== address.toLowerCase() ? (
                    <button
                      type="button"
                      onClick={() => setShowFund(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90"
                    >
                      <span className="material-symbols-outlined text-[18px]">payments</span>
                      Fund
                    </button>
                  ) : null}
                  <CancelInvoiceButton
                    invoice={invoice}
                    walletAddress={address}
                    onCancelled={(cancelled) => setInvoice(cancelled)}
                  />
                  <MarkPaidButton
                    invoice={invoice}
                    walletAddress={address}
                    onPaid={(paid) => setInvoice(paid)}
                  />
                  {invoice.status === 'Funded' &&
                  invoice.payer.toLowerCase() === address.toLowerCase() ? (
                    <button
                      type="button"
                      onClick={() => setShowDispute(true)}
                      className="text-xs px-3 py-1.5 rounded-lg font-bold border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors"
                    >
                      Raise Dispute
                    </button>
                  ) : null}
                  {invoice.funder &&
                  invoice.funder.toLowerCase() === address.toLowerCase() &&
                  invoice.status === 'Funded' ? (
                    <button
                      type="button"
                      onClick={() => setShowTransfer(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2.5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                      Transfer Position
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <article className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/10 pb-4">
              <div>
                <p className="text-sm text-on-surface-variant">Current status</p>
                <div className="mt-2">
                  <InvoiceStatusBadge status={invoice.status} />
                </div>
              </div>
              <Link href="/dashboard" className="text-sm font-bold text-primary hover:underline">
                Back to dashboard
              </Link>
            </div>

            <div className="mt-6">
              <InvoiceLifecycleTimeline status={invoice.status} />
            </div>

            <dl className="mt-6 grid gap-4 text-sm">
              <DetailRow
                label="Freelancer"
                href={`/profile/${invoice.freelancer}`}
                value={formatAddress(invoice.freelancer)}
              />
              <DetailRow
                label="Payer"
                href={`/profile/${invoice.payer}`}
                value={formatAddress(invoice.payer)}
              />
              {invoice.funder ? (
                <DetailRow
                  label="Liquidity Provider"
                  href={`/profile/${invoice.funder}`}
                  value={formatAddress(invoice.funder)}
                />
              ) : null}
              <DetailRow label="Face value" value={formatUSDC(invoice.amount)} strong />
              <DetailRow label="Discount" value={`${(invoice.discount_rate / 100).toFixed(2)}%`} />
              <DetailRow label="Due date" value={formatDate(invoice.due_date)} />
            </dl>
          </article>

          {NEXT_PUBLIC_NFT_ENABLED ? (
            <InvoiceNftCard
              invoiceId={invoiceId}
              invoiceStatus={invoice.status}
              walletAddress={address}
              invoiceFunder={invoice.funder}
            />
          ) : null}
          <LPWhitelistManager
            invoiceId={invoiceId.toString()}
            submitterAddress={invoice.freelancer}
            currentWallet={address ?? undefined}
            status={invoice.status}
            whitelist={invoice.whitelist || []}
          />

          <ActivityFeed invoiceId={invoiceId} />
        </div>
      </section>
      {showFund ? (
        <FundConfirmModal
          invoice={invoice}
          onClose={() => setShowFund(false)}
          onSuccess={() => {
            setShowFund(false);
            void fetchInvoice();
          }}
        />
      ) : null}
      {showDispute ? (
        <DisputeInvoiceModal
          invoice={invoice}
          onClose={() => setShowDispute(false)}
          onSuccess={() => {
            setShowDispute(false);
            void fetchInvoice();
          }}
        />
      ) : null}
      {showTransfer ? (
        <LPTransferModal
          invoice={invoice}
          onClose={() => setShowTransfer(false)}
          onSuccess={(transferred, newOwner) => {
            setInvoice({ ...transferred, funder: newOwner });
            setShowTransfer(false);
          }}
        />
      ) : null}
    </main>
  );
}

function DetailRow({
  label,
  value,
  href,
  strong,
}: {
  label: string;
  value: string;
  href?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-outline-variant/10 pb-3 last:border-b-0">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className={strong ? 'font-bold' : 'font-mono text-sm'}>
        {href ? (
          <Link href={href} className="text-primary hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
