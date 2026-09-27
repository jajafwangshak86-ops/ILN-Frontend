'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import Navbar from '@/components/Navbar';
import InvoiceFilterBar from '@/components/InvoiceFilterBar';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useApprovedTokens } from '@/hooks/useApprovedTokens';
import { useTransactionPreview } from '@/hooks/useTransactionPreview';
import { applyInvoiceFilters, useInvoiceFilters } from '@/hooks/useInvoiceFilters';
import { getAllInvoices, submitInvoice, Invoice } from '@/utils/soroban';
import { formatUSDC, formatAddress, formatDate } from '@/utils/format';
import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { RPC_URL, NETWORK_PASSPHRASE } from '@/constants';
import { paginate, pageCountFor } from '@/utils/pagination';
import { ExportButton } from '@/components/ExportButton';

const server = new rpc.Server(RPC_URL);

/** Maximum invoice rows shown per page on the freelancer dashboard (#13). */
const INVOICES_PER_PAGE = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'submit' | 'my-invoices';

interface FormState {
  payer: string;
  amount: string;
  dueDate: string;
  discountRate: string;
}

const EMPTY_FORM: FormState = {
  payer: '',
  amount: '',
  dueDate: '',
  discountRate: '',
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Pending: 'bg-primary-container text-on-primary-container',
    Funded: 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1e3a8a]/30 dark:text-[#93c5fd]',
    Paid: 'bg-[#dcfce7] text-[#15803d] dark:bg-[#14532d]/30 dark:text-[#86efac]',
    Defaulted: 'bg-error-container text-on-error-container',
  };
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
        styles[status] ?? 'bg-surface-container text-on-surface-variant'
      }`}
    >
      {status}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FreelancerPage() {
  useDocumentTitle({ pageTitle: 'Freelancer Portal' });
  return (
    <Suspense fallback={null}>
      <FreelancerPageContent />
    </Suspense>
  );
}

function FreelancerPageContent() {
  const { t, i18n } = useTranslation();
  const getLocale = () => (i18n.language === 'es' ? 'es-ES' : 'en-US');
  const { address, isConnected, connect } = useWallet();
  const { addToast, updateToast } = useToast();
  const { signTx } = useWallet();
  const { tokenMap, defaultToken } = useApprovedTokens();
  const { previewModal, requestPreview } = useTransactionPreview();

  const [screen, setScreen] = useState<Screen>('submit');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedId, setConfirmedId] = useState<bigint | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { filters, setFilters, clearFilters, activeFilterCount } = useInvoiceFilters({
    namespace: 'freelancerInvoices',
  });

  // ── Fetch invoices for connected wallet ─────────────────────────────────────
  const fetchMyInvoices = useCallback(async () => {
    if (!address) return;
    setLoadingInvoices(true);
    try {
      const all = await getAllInvoices();
      setInvoices(all.filter((inv) => inv.freelancer === address));
    } catch (err) {
      console.error('Failed to fetch invoices', err);
    } finally {
      setLoadingInvoices(false);
    }
  }, [address]);

  useEffect(() => {
    if (screen === 'my-invoices') {
      fetchMyInvoices();
      refreshIntervalRef.current = setInterval(fetchMyInvoices, 30_000);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [screen, fetchMyInvoices]);

  const filteredInvoices = useMemo(
    () =>
      applyInvoiceFilters(invoices, filters, {
        resolveTokenSymbol: (invoice) => {
          const token = tokenMap.get(invoice.token ?? defaultToken?.contractId ?? '');
          return token?.symbol ?? 'USDC';
        },
      }),
    [defaultToken?.contractId, filters, invoices, tokenMap]
  );

  // ── Pagination (max 20 rows per page, per issue #13) ────────────────────────
  const [page, setPage] = useState(0);
  const pageCount = pageCountFor(filteredInvoices.length, INVOICES_PER_PAGE);
  // Keep the page in range as filters shrink the result set.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  // Reset to the first page whenever the active filters change.
  useEffect(() => {
    setPage(0);
  }, [filters]);
  const pagedInvoices = useMemo(
    () => paginate(filteredInvoices, page, INVOICES_PER_PAGE),
    [filteredInvoices, page]
  );

  // ── Form validation ──────────────────────────────────────────────────────────
  function validate(): boolean {
    const next: Partial<FormState> = {};
    if (!form.payer.trim() || form.payer.trim().length < 56) {
      next.payer = t('freelancer.validation.payerRequired');
    }
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      next.amount = t('freelancer.validation.amountRequired');
    }
    if (!form.dueDate) {
      next.dueDate = t('freelancer.validation.dueDateRequired');
    } else if (new Date(form.dueDate) <= new Date()) {
      next.dueDate = t('freelancer.validation.dueDateFuture');
    }
    const rate = parseFloat(form.discountRate);
    if (!form.discountRate || isNaN(rate) || rate < 0 || rate > 100) {
      next.discountRate = t('freelancer.validation.discountRange');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // ── Submit handler ───────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected) {
      await connect();
      return;
    }
    if (!validate()) return;

    setIsSubmitting(true);
    const toastId = addToast({ type: 'pending', title: t('freelancer.toast.submitting') });

    try {
      const amountStroops = BigInt(
        Math.round(parseFloat(form.amount) * 10 ** (defaultToken?.decimals ?? 6))
      );
      const dueDateUnix = Math.floor(new Date(form.dueDate).getTime() / 1000);
      const discountBps = Math.round(parseFloat(form.discountRate) * 100);

      const { tx } = await submitInvoice({
        freelancer: address!,
        payer: form.payer.trim(),
        amount: amountStroops,
        dueDate: dueDateUnix,
        discountRate: discountBps,
      });

      const txXdr = tx.toXDR();
      await requestPreview(txXdr, 'submit_invoice');
      const signedXdr = await signTx(txXdr);
      const sendResult = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)
      );

      if (sendResult.status === 'PENDING') {
        let txStatus = await server.getTransaction(sendResult.hash);
        let tries = 0;
        while (txStatus.status === 'NOT_FOUND' && tries < 20) {
          await new Promise((r) => setTimeout(r, 1500));
          txStatus = await server.getTransaction(sendResult.hash);
          tries++;
        }

        setConfirmedId(null);
        setForm(EMPTY_FORM);
        setErrors({});
        updateToast(toastId, {
          type: 'success',
          title: t('freelancer.toast.submitted'),
          txHash: sendResult.hash,
        });
      } else {
        throw new Error(`Transaction rejected: ${sendResult.status}`);
      }
    } catch (err: any) {
      updateToast(toastId, {
        type: 'error',
        title: t('freelancer.toast.submissionFailed'),
        message: err?.message ?? t('freelancer.toast.unknownError'),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  const tableHeaders = [
    t('freelancer.invoices.headers.id'),
    t('freelancer.invoices.headers.payer'),
    t('freelancer.invoices.headers.amount'),
    t('freelancer.invoices.headers.discount'),
    t('freelancer.invoices.headers.dueDate'),
    t('freelancer.invoices.headers.status'),
  ];

  return (
    <>
      {previewModal}
      <Navbar />
      <main className="min-h-screen pt-28 pb-20 px-4">
        <div className="max-w-4xl mx-auto">
          {/* ── Page Header ──────────────────────────────────────────────────── */}
          <div className="mb-8">
            <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">
              {t('submitForm.freelancerPortal')}
            </p>
            <h1 className="text-4xl font-bold tracking-tight mb-3">{t('freelancer.pageTitle')}</h1>
            <p className="text-on-surface-variant max-w-xl">{t('freelancer.pageSubtitle')}</p>
          </div>

          <div className="flex bg-surface-container-low p-1 rounded-xl w-fit mb-8 gap-1">
            {(['submit', 'my-invoices'] as Screen[]).map((s) => (
              <button
                key={s}
                id={`tab-${s}`}
                onClick={() => {
                  setScreen(s);
                  setConfirmedId(null);
                }}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${
                  screen === s
                    ? 'bg-primary text-surface-container-lowest shadow-md'
                    : 'text-on-surface-variant hover:bg-surface-variant/30'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px]">
                    {s === 'submit' ? 'add_circle' : 'receipt_long'}
                  </span>
                  {s === 'submit'
                    ? t('freelancer.tabs.submitInvoice')
                    : t('freelancer.tabs.myInvoices')}
                </span>
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              SCREEN 1 — Submit Invoice
          ════════════════════════════════════════════════════════════════════ */}
          {screen === 'submit' && (
            <div className="bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/10 overflow-hidden">
              <div className="p-6 border-b border-surface-dim">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">send</span>
                  {t('freelancer.submit.cardTitle')}
                </h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  {t('freelancer.submit.cardSubtitle')}
                </p>
              </div>

              {!isConnected ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 gap-5">
                  <div className="w-16 h-16 rounded-full bg-primary-container flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-3xl">
                      account_balance_wallet
                    </span>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-lg">{t('freelancer.submit.connectFirst')}</p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      {t('freelancer.submit.connectFirstDesc')}
                    </p>
                  </div>
                  <button
                    id="connect-wallet-submit"
                    onClick={connect}
                    className="bg-primary text-surface-container-lowest px-8 py-3 rounded-xl text-sm font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      account_balance_wallet
                    </span>
                    {t('freelancer.submit.connectFreighter')}
                  </button>
                </div>
              ) : (
                <>
                  {/* Success confirmation banner */}
                  {confirmedId !== null && (
                    <div className="mx-6 mt-6 p-4 rounded-xl bg-[#dcfce7] border border-[#bbf7d0] text-[#15803d] dark:bg-[#14532d]/20 dark:border-[#166534]/30 dark:text-[#86efac] flex items-start gap-3">
                      <span className="material-symbols-outlined mt-0.5">check_circle</span>
                      <div>
                        <p className="font-bold text-sm">{t('freelancer.submit.successTitle')}</p>
                        <p
                          className="text-xs mt-0.5 opacity-90"
                          dangerouslySetInnerHTML={{
                            __html: t('freelancer.submit.successDesc', {
                              id: confirmedId.toString(),
                            }),
                          }}
                        />
                      </div>
                      <button
                        onClick={() => setConfirmedId(null)}
                        className="ml-auto opacity-60 hover:opacity-100 transition-opacity"
                        aria-label="Dismiss"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  )}

                  {/* Form */}
                  <form
                    id="submit-invoice-form"
                    onSubmit={handleSubmit}
                    className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6"
                    noValidate
                  >
                    {/* Payer address — full width */}
                    <div className="md:col-span-2">
                      <label
                        htmlFor="field-payer"
                        className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
                      >
                        {t('freelancer.submit.payerLabel')}
                      </label>
                      <input
                        id="field-payer"
                        type="text"
                        placeholder="G…"
                        value={form.payer}
                        onChange={(e) => setForm({ ...form, payer: e.target.value })}
                        className={`w-full bg-surface-container-low border rounded-xl px-4 py-3 text-sm font-mono placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                          errors.payer ? 'border-error' : 'border-outline-variant/30'
                        }`}
                      />
                      {errors.payer && (
                        <p className="text-error text-xs mt-1.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {errors.payer}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="field-amount"
                        className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
                      >
                        {t('freelancer.submit.amountLabel')}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm font-bold">
                          $
                        </span>
                        <input
                          id="field-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={form.amount}
                          onChange={(e) => setForm({ ...form, amount: e.target.value })}
                          className={`w-full bg-surface-container-low border rounded-xl pl-7 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                            errors.amount ? 'border-error' : 'border-outline-variant/30'
                          }`}
                        />
                      </div>
                      {errors.amount && (
                        <p className="text-error text-xs mt-1.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {errors.amount}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="field-due-date"
                        className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
                      >
                        {t('freelancer.submit.dueDateLabel')}
                      </label>
                      <input
                        id="field-due-date"
                        type="date"
                        value={form.dueDate}
                        min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                        onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                        className={`w-full bg-surface-container-low border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                          errors.dueDate ? 'border-error' : 'border-outline-variant/30'
                        }`}
                      />
                      {errors.dueDate && (
                        <p className="text-error text-xs mt-1.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {errors.dueDate}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="field-discount"
                        className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
                      >
                        {t('freelancer.submit.discountLabel')}
                      </label>
                      <div className="relative">
                        <input
                          id="field-discount"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="e.g. 5"
                          value={form.discountRate}
                          onChange={(e) => setForm({ ...form, discountRate: e.target.value })}
                          className={`w-full bg-surface-container-low border rounded-xl px-4 pr-9 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                            errors.discountRate ? 'border-error' : 'border-outline-variant/30'
                          }`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm font-bold">
                          %
                        </span>
                      </div>
                      {errors.discountRate && (
                        <p className="text-error text-xs mt-1.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">error</span>
                          {errors.discountRate}
                        </p>
                      )}
                      <p className="text-[11px] text-on-surface-variant mt-1.5">
                        {t('freelancer.submit.discountHint')}
                      </p>
                    </div>

                    {form.amount && form.discountRate && (
                      <div className="md:col-span-2 bg-primary-container/30 border border-primary/10 rounded-xl px-5 py-4 flex flex-wrap gap-6">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                            {t('freelancer.submit.preview.youReceive')}
                          </p>
                          <p className="font-bold mt-0.5">
                            {(() => {
                              const amt = parseFloat(form.amount) || 0;
                              const rate = parseFloat(form.discountRate) || 0;
                              const net = amt * (1 - rate / 100);
                              return `$${net.toFixed(2)} USDC`;
                            })()}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                            {t('freelancer.submit.preview.lpYield')}
                          </p>
                          <p className="font-bold mt-0.5 text-primary">
                            {(() => {
                              const amt = parseFloat(form.amount) || 0;
                              const rate = parseFloat(form.discountRate) || 0;
                              return `$${((amt * rate) / 100).toFixed(2)} USDC`;
                            })()}
                          </p>
                        </div>
                        {form.dueDate && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                              {t('freelancer.submit.preview.due')}
                            </p>
                            <p className="font-bold mt-0.5">
                              {new Date(form.dueDate).toLocaleDateString(getLocale())}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Submit button — full width */}
                    <div className="md:col-span-2">
                      <button
                        id="submit-invoice-btn"
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-primary text-surface-container-lowest py-3.5 rounded-xl font-bold text-sm shadow-md hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? (
                          <>
                            <span className="w-4 h-4 border-2 border-surface-container-lowest border-t-transparent rounded-full animate-spin" />
                            {t('freelancer.submit.submittingToStellar')}
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[18px]">send</span>
                            {t('freelancer.tabs.submitInvoice')}
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          )}

          {screen === 'my-invoices' && (
            <div className="bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/10 overflow-hidden min-h-[400px]">
              <div className="p-6 border-b border-surface-dim flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">receipt_long</span>
                    {t('freelancer.invoices.title')}
                  </h2>
                  <p className="text-sm text-on-surface-variant mt-1">
                    {t('freelancer.invoices.subtitle')}
                  </p>
                </div>
                <button
                  id="refresh-invoices-btn"
                  onClick={fetchMyInvoices}
                  disabled={loadingInvoices}
                  className="flex items-center gap-1.5 text-sm font-bold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                >
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      loadingInvoices ? 'animate-spin' : ''
                    }`}
                  >
                    refresh
                  </span>
                  {t('common.refresh')}
                </button>
              </div>

              {!isConnected ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 gap-5">
                  <div className="w-16 h-16 rounded-full bg-primary-container flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-3xl">
                      account_balance_wallet
                    </span>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-lg">{t('freelancer.invoices.connectToView')}</p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      {t('freelancer.invoices.connectDesc')}
                    </p>
                  </div>
                  <button
                    id="connect-wallet-invoices"
                    onClick={connect}
                    className="bg-primary text-surface-container-lowest px-8 py-3 rounded-xl text-sm font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      account_balance_wallet
                    </span>
                    {t('freelancer.submit.connectFreighter')}
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="px-6 pt-4 flex flex-col gap-3">
                    <InvoiceFilterBar
                      filters={filters}
                      onFiltersChange={setFilters}
                      onClearFilters={clearFilters}
                      activeFilterCount={activeFilterCount}
                    />
                    <ExportButton data={filteredInvoices} filenamePrefix="iln-freelancer-export" />
                  </div>
                  <table className="w-full text-left" id="my-invoices-table">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {tableHeaders.map((h) => (
                          <th
                            key={h}
                            className="px-6 py-4 text-[11px] font-bold uppercase text-on-surface-variant tracking-wider whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-dim">
                      {loadingInvoices ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-6 py-14 text-center text-on-surface-variant italic"
                          >
                            <span className="flex items-center justify-center gap-2">
                              <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              Loading invoices from Stellar…
                            </span>
                          </td>
                        </tr>
                      ) : invoices.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-14 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">
                                inbox
                              </span>
                              <p className="text-on-surface-variant italic text-sm">
                                No invoices found for your address.
                              </p>
                              <button
                                onClick={() => setScreen('submit')}
                                className="text-primary text-sm font-bold hover:underline"
                              >
                                Submit your first invoice →
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        pagedInvoices.map((inv) => (
                          <tr
                            key={inv.id.toString()}
                            className="hover:bg-surface-variant/10 transition-colors"
                          >
                            <td className="px-6 py-5 font-bold text-primary whitespace-nowrap">
                              #{inv.id.toString()}
                            </td>
                            <td className="px-6 py-5">
                              <span className="font-mono text-sm">{formatAddress(inv.payer)}</span>
                            </td>
                            <td className="px-6 py-5 font-bold whitespace-nowrap">
                              {formatUSDC(inv.amount)}
                            </td>
                            <td className="px-6 py-5 whitespace-nowrap">
                              <span className="bg-primary-container text-on-primary-container px-2 py-0.5 rounded text-xs font-bold">
                                {(inv.discount_rate / 100).toFixed(2)}%
                              </span>
                            </td>
                            <td className="px-6 py-5 text-sm whitespace-nowrap">
                              {formatDate(inv.due_date)}
                            </td>
                            <td className="px-6 py-5 whitespace-nowrap">
                              <StatusBadge status={inv.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {!loadingInvoices && filteredInvoices.length > INVOICES_PER_PAGE ? (
                    <nav
                      className="flex items-center justify-between gap-3 border-t border-surface-dim px-6 py-4"
                      aria-label="Invoice pagination"
                    >
                      <span className="text-xs text-on-surface-variant">
                        Showing {page * INVOICES_PER_PAGE + 1}–
                        {Math.min((page + 1) * INVOICES_PER_PAGE, filteredInvoices.length)} of{' '}
                        {filteredInvoices.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          disabled={page === 0}
                          className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40"
                        >
                          Previous
                        </button>
                        <span className="text-xs font-bold text-on-surface-variant">
                          Page {page + 1} of {pageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                          disabled={page >= pageCount - 1}
                          className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </nav>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
