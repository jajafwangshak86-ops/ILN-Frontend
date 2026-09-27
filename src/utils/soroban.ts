import {
  xdr,
  rpc,
  Address,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  Transaction,
  Operation,
  Contract,
  Account,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
  TESTNET_EURC_TOKEN_ID,
  TESTNET_USDC_TOKEN_ID,
  TESTNET_XLM_TOKEN_ID,
} from '@/constants';
import { parseAmountToUnits, parseDiscountRateToBps, toUnixTimestamp } from './invoiceSubmission';
import { fetchNativeXlmBalance } from '@/lib/horizonClient';

// ─── RPC & constants ──────────────────────────────────────────────────────────

const server = new rpc.Server(RPC_URL);
const READ_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POLL_ATTEMPTS = 20;
const ACCEPTED_SEND_STATUSES = new Set(['PENDING', 'DUPLICATE']);
const DEFAULT_TOKEN_ALLOWANCE_LEDGER_BUFFER = 20_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Invoice {
  id: bigint;
  status: string;
  freelancer: string;
  payer: string;
  amount: bigint;
  amount_paid?: bigint;
  due_date: bigint;
  discount_rate: number;
  funder?: string;
  funded_at?: bigint;
  token?: string;
  whitelist?: string[];
}

export interface SubmittedInvoiceResult {
  invoiceId: bigint;
  txHash: string;
}

export interface TokenMetadata {
  contractId: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface PayerScoreResult {
  score: number;
  settled_on_time: number;
  defaults: number;
}

export interface ReputationScore {
  score: number;
  invoices_submitted: number;
  invoices_paid: number;
  invoices_defaulted: number;
  last_activity_ledger?: number;
}

export interface ReputationEvent {
  type: 'submitted' | 'paid' | 'defaulted' | 'score_updated';
  timestamp: number;
  score?: number;
}

export interface InsurancePoolInfo {
  balance: bigint;
  enrolled_count: number;
  premium_rate: number; // in bps
}

export type WalletRole = 'freelancer' | 'payer' | 'lp';

// ─── Private helpers ──────────────────────────────────────────────────────────

const KNOWN_TOKEN_METADATA: Record<string, Omit<TokenMetadata, 'contractId'>> = {
  [TESTNET_USDC_TOKEN_ID]: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  [TESTNET_EURC_TOKEN_ID]: { name: 'Euro Coin', symbol: 'EURC', decimals: 7 },
};

/**
 * Tokens the frontend can propose for the contract allowlist. The contract does
 * not expose a `list_tokens` read; approval is derived per token by querying
 * `get_token_decimals`.
 */
const APPROVED_TOKEN_CANDIDATES = [
  TESTNET_USDC_TOKEN_ID,
  TESTNET_EURC_TOKEN_ID,
  TESTNET_XLM_TOKEN_ID,
];

function buildReadTransaction(contractId: string, method: string, params: xdr.ScVal[]) {
  return new TransactionBuilder(new Account(READ_ACCOUNT, '0'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args: params,
      })
    )
    .setTimeout(30)
    .build();
}

function parseStatus(status: unknown): string {
  if (status && typeof status === 'object') {
    return Object.keys(status as object)[0];
  }
  return String(status);
}

/**
 * Encodes a referral code as a 32-byte value (contract `BytesN<32>`).
 * Codes are ASCII and zero-padded to the fixed 32-byte length.
 */
function encodeReferralCodeBytes(code: string): xdr.ScVal {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(code);
  bytes.set(encoded.slice(0, 32), 0);
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/**
 * Encodes the contract's `ReferralCode` enum (None | Present(code)).
 * `None` -> empty union (`scvVec(null)`), `Present` -> single-arm union.
 */
function encodeReferralCode(code?: string | null): xdr.ScVal {
  if (!code) return xdr.ScVal.scvVec(null);
  return xdr.ScVal.scvVec([encodeReferralCodeBytes(code)]);
}

function extractInvoiceIdFromTransaction(result: unknown): bigint | null {
  if (!result || typeof result !== 'object') return null;

  const maybe = result as { returnValue?: unknown; resultMetaXdr?: string };

  if (maybe.returnValue instanceof xdr.ScVal) {
    return BigInt(scValToNative(maybe.returnValue));
  }

  if (typeof maybe.returnValue === 'string') {
    try {
      return BigInt(scValToNative(xdr.ScVal.fromXDR(maybe.returnValue, 'base64')));
    } catch {
      return null;
    }
  }

  if (maybe.resultMetaXdr) {
    try {
      const meta = xdr.TransactionMeta.fromXDR(maybe.resultMetaXdr, 'base64');
      const returnValue = meta.v3()?.sorobanMeta()?.returnValue();
      if (returnValue) return BigInt(scValToNative(returnValue));
    } catch {
      return null;
    }
  }

  return null;
}

async function readTokenContractValue(tokenId: string, method: string): Promise<unknown> {
  const callResult = await server.simulateTransaction(buildReadTransaction(tokenId, method, []));
  if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
    throw new Error(`Failed to fetch token ${method}.`);
  }
  return scValToNative(callResult.result.retval);
}

// ─── Read functions ───────────────────────────────────────────────────────────

export async function getInvoiceCount(): Promise<bigint> {
  const result = await server.getHealth();
  if (result.status !== 'healthy') {
    throw new Error('RPC server is not healthy');
  }
  const callResult = await server.simulateTransaction(
    buildReadTransaction(CONTRACT_ID, 'get_invoice_count', [])
  );
  if (rpc.Api.isSimulationSuccess(callResult)) {
    return scValToNative(callResult.result!.retval);
  }
  throw new Error('Failed to get invoice count');
}

export async function getInvoice(id: bigint): Promise<Invoice> {
  const params: xdr.ScVal[] = [nativeToScVal(id, { type: 'u64' })];
  const callResult = await server.simulateTransaction(
    buildReadTransaction(CONTRACT_ID, 'get_invoice', params)
  );
  if (rpc.Api.isSimulationSuccess(callResult)) {
    const native = scValToNative(callResult.result!.retval);
    return {
      id: native.id,
      freelancer: native.freelancer,
      payer: native.payer,
      amount: native.amount,
      due_date: native.due_date,
      discount_rate: native.discount_rate,
      status: parseStatus(native.status),
      funder: native.funder,
      funded_at: native.funded_at,
      token: native.token,
    };
  }
  throw new Error(`Failed to get invoice ${id}`);
}

export async function getAllInvoices(): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  let i = BigInt(1);
  let consecutiveFailures = 0;

  while (consecutiveFailures < 1) {
    try {
      invoices.push(await getInvoice(i));
      i++;
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
    }
    if (i > BigInt(1000)) break;
  }
  return invoices;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseInvoiceFromNative(native: any): Invoice {
  return {
    id: BigInt(native.id ?? 0),
    freelancer: String(native.freelancer ?? native.submitter ?? ''),
    payer: String(native.payer ?? ''),
    amount: BigInt(native.amount ?? 0),
    due_date: BigInt(native.due_date ?? 0),
    discount_rate: Number(native.discount_rate ?? 0),
    status: parseStatus(native.status),
    funder: native.funder ? String(native.funder) : undefined,
    funded_at: native.funded_at ? BigInt(native.funded_at) : undefined,
    token: native.token ? String(native.token) : undefined,
  };
}

export async function listInvoicesBySubmitter(
  submitterAddress: string,
  page = 0,
  pageSize = 50
): Promise<Invoice[]> {
  try {
    const addressScVal = Address.fromString(submitterAddress).toScVal();
    const params: xdr.ScVal[] = [
      addressScVal,
      nativeToScVal(page, { type: 'u32' }),
      nativeToScVal(pageSize, { type: 'u32' }),
    ];
    let callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'list_invoices_by_submitter', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      // Older deployments exposed `list_invoices_by_freelancer(submitter)`.
      callResult = await server.simulateTransaction(
        buildReadTransaction(CONTRACT_ID, 'list_invoices_by_freelancer', [addressScVal])
      );
    }
    if (rpc.Api.isSimulationSuccess(callResult) && callResult.result?.retval) {
      const native = scValToNative(callResult.result.retval);
      if (Array.isArray(native)) {
        return native.map(parseInvoiceFromNative);
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function listInvoicesByPayer(payerAddress: string): Promise<Invoice[]> {
  try {
    const params: xdr.ScVal[] = [Address.fromString(payerAddress).toScVal()];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'list_invoices_by_payer', params)
    );
    if (rpc.Api.isSimulationSuccess(callResult) && callResult.result?.retval) {
      const native = scValToNative(callResult.result.retval);
      if (Array.isArray(native)) {
        return native.map(parseInvoiceFromNative);
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function listInvoicesByLp(
  lpAddress: string,
  page = 0,
  pageSize = 50
): Promise<Invoice[]> {
  try {
    const params: xdr.ScVal[] = [
      Address.fromString(lpAddress).toScVal(),
      nativeToScVal(page, { type: 'u32' }),
      nativeToScVal(pageSize, { type: 'u32' }),
    ];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'list_invoices_by_lp', params)
    );
    if (rpc.Api.isSimulationSuccess(callResult) && callResult.result?.retval) {
      const native = scValToNative(callResult.result.retval);
      if (Array.isArray(native)) {
        return native.map(parseInvoiceFromNative);
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function getWalletRoles(address: string): Promise<WalletRole[]> {
  const normalized = address.toLowerCase();
  const roles = new Set<WalletRole>();

  try {
    const [submitterInvoices, payerInvoices, lpInvoices] = await Promise.all([
      listInvoicesBySubmitter(address),
      listInvoicesByPayer(address),
      listInvoicesByLp(address),
    ]);

    if (submitterInvoices.length > 0) roles.add('freelancer');
    if (payerInvoices.length > 0) roles.add('payer');
    if (lpInvoices.length > 0) roles.add('lp');

    if (roles.size > 0) {
      return Array.from(roles);
    }
  } catch {
    // ignore error and proceed to fallback
  }

  try {
    const invoices = await getAllInvoices();
    for (const invoice of invoices) {
      if (invoice.freelancer?.toLowerCase() === normalized) roles.add('freelancer');
      if (invoice.payer?.toLowerCase() === normalized) roles.add('payer');
      if (invoice.funder?.toLowerCase() === normalized) roles.add('lp');
    }
  } catch {
    // ignore fallback failure
  }

  return Array.from(roles);
}

export async function getNativeXlmBalance(address: string): Promise<number> {
  return fetchNativeXlmBalance(address);
}

export async function getApprovedTokenIds(): Promise<string[]> {
  // The contract does not expose a `list_tokens` read. A token is considered
  // approved when `get_token_decimals(Address)` returns a value (the contract
  // stores decimals for every token added via `add_token`).
  const tokenDecimalsReads = await Promise.allSettled(
    APPROVED_TOKEN_CANDIDATES.map(async (tokenId) => {
      const params: xdr.ScVal[] = [Address.fromString(tokenId).toScVal()];
      const callResult = await server.simulateTransaction(
        buildReadTransaction(CONTRACT_ID, 'get_token_decimals', params)
      );
      if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
        throw new Error(`Failed to fetch decimals for ${tokenId}`);
      }
      return scValToNative(callResult.result.retval);
    })
  );

  if (tokenDecimalsReads.every((result) => result.status === 'rejected')) {
    throw new Error('Failed to fetch approved tokens.');
  }

  return APPROVED_TOKEN_CANDIDATES.filter(
    (_, index) =>
      tokenDecimalsReads[index].status === 'fulfilled' &&
      tokenDecimalsReads[index].value != null &&
      Number.isFinite(Number(tokenDecimalsReads[index].value))
  );
}

export async function getTokenMetadata(tokenId: string): Promise<TokenMetadata> {
  const fallback = KNOWN_TOKEN_METADATA[tokenId];
  const [nameResult, symbolResult, decimalsResult] = await Promise.allSettled([
    readTokenContractValue(tokenId, 'name'),
    readTokenContractValue(tokenId, 'symbol'),
    readTokenContractValue(tokenId, 'decimals'),
  ]);
  const name =
    nameResult.status === 'fulfilled' ? String(nameResult.value) : (fallback?.name ?? 'Token');
  const symbol =
    symbolResult.status === 'fulfilled'
      ? String(symbolResult.value)
      : (fallback?.symbol ?? 'TOKEN');
  const decimalsValue =
    decimalsResult.status === 'fulfilled'
      ? Number(decimalsResult.value)
      : (fallback?.decimals ?? 7);
  return {
    contractId: tokenId,
    name,
    symbol,
    decimals: Number.isFinite(decimalsValue) ? decimalsValue : 7,
  };
}

export async function getTokenBalance(
  address: string,
  tokenId = TESTNET_USDC_TOKEN_ID
): Promise<bigint> {
  const params: xdr.ScVal[] = [Address.fromString(address).toScVal()];
  const callResult = await server.simulateTransaction(
    buildReadTransaction(tokenId, 'balance', params)
  );
  if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
    throw new Error('Failed to fetch token balance.');
  }
  return BigInt(scValToNative(callResult.result.retval));
}

export async function getUsdcBalance(
  address: string,
  tokenId = TESTNET_USDC_TOKEN_ID
): Promise<bigint> {
  return getTokenBalance(address, tokenId);
}

export async function getTokenAllowance({
  owner,
  spender = CONTRACT_ID,
  tokenId = TESTNET_USDC_TOKEN_ID,
}: {
  owner: string;
  spender?: string;
  tokenId?: string;
}): Promise<bigint> {
  const params: xdr.ScVal[] = [
    Address.fromString(owner).toScVal(),
    Address.fromString(spender).toScVal(),
  ];
  const callResult = await server.simulateTransaction(
    buildReadTransaction(tokenId, 'allowance', params)
  );
  if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
    throw new Error('Failed to fetch token allowance.');
  }
  return BigInt(scValToNative(callResult.result.retval));
}

export async function approveToken({
  from,
  spender = CONTRACT_ID,
  amount,
  tokenId = TESTNET_USDC_TOKEN_ID,
}: {
  from: string;
  spender?: string;
  amount: bigint;
  tokenId?: string;
}) {
  const account = await server.getAccount(from);
  const params = [
    Address.fromString(from).toScVal(),
    Address.fromString(spender).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(1_000_000, { type: 'u32' }), // Expiration ledger (high enough)
  ];

  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(tokenId).toScAddress(),
            functionName: 'approve',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Approval simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

export async function getUsdcAllowance(args: {
  owner: string;
  spender?: string;
  tokenId?: string;
}): Promise<bigint> {
  return getTokenAllowance(args);
}

/** Returns the invoice amount — used to pass the correct funding amount to fund_invoice. */
async function getInvoiceRequiredFunding(invoiceId: bigint): Promise<bigint> {
  const invoice = await getInvoice(invoiceId);
  return invoice.amount;
}

export async function getPayerScore(payerAddress: string): Promise<PayerScoreResult | null> {
  try {
    const params: xdr.ScVal[] = [Address.fromString(payerAddress).toScVal()];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'payer_score', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) return null;
    const native = scValToNative(callResult.result.retval);
    if (native === null || native === undefined) return null;
    return {
      score: Number(native.score ?? native),
      settled_on_time: Number(native.settled_on_time ?? 0),
      defaults: Number(native.defaults ?? 0),
    };
  } catch {
    return null;
  }
}

export async function getReputation(address: string): Promise<ReputationScore | null> {
  try {
    const params: xdr.ScVal[] = [Address.fromString(address).toScVal()];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_reputation', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) return null;
    const native = scValToNative(callResult.result.retval);
    if (native === null || native === undefined) return null;

    return {
      score: Number(native.score ?? native.reputation_score ?? 0),
      invoices_submitted: Number(native.invoices_submitted ?? native.submitted ?? 0),
      invoices_paid: Number(native.invoices_paid ?? native.paid ?? native.settled_on_time ?? 0),
      invoices_defaulted: Number(
        native.invoices_defaulted ?? native.defaulted ?? native.defaults ?? 0
      ),
      last_activity_ledger:
        native.last_activity_ledger !== undefined ? Number(native.last_activity_ledger) : undefined,
    };
  } catch {
    return null;
  }
}

export async function getReputationEvents(address: string): Promise<ReputationEvent[]> {
  try {
    const params: xdr.ScVal[] = [Address.fromString(address).toScVal()];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_reputation_events', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) return [];
    const native = scValToNative(callResult.result.retval);
    if (!Array.isArray(native)) return [];

    return native
      .map((event) => ({
        type: String(event.type ?? event.event ?? 'score_updated') as ReputationEvent['type'],
        timestamp: Number(event.timestamp ?? event.ledger_time ?? 0),
        score: event.score === undefined ? undefined : Number(event.score),
      }))
      .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0);
  } catch {
    return [];
  }
}

export interface TopPayer {
  address: string;
  score: number;
  invoices_paid: number;
  invoices_defaulted: number;
  total_volume: bigint;
}

export interface TopFreelancer {
  address: string;
  score: number;
  invoices_submitted: number;
  invoices_funded: number;
  total_earned: bigint;
}

export interface TopLP {
  address: string;
  liquidity_provided: bigint;
  fees_earned: bigint;
  total_funded: number;
  score: number;
}

export type LeaderboardTab = 'payers' | 'freelancers' | 'lps';

export async function getPayerScoresBatch(
  addresses: string[]
): Promise<Map<string, PayerScoreResult | null>> {
  const unique = [...new Set(addresses)];
  const results = await Promise.allSettled(unique.map((addr) => getPayerScore(addr)));
  const map = new Map<string, PayerScoreResult | null>();
  unique.forEach((addr, i) => {
    const result = results[i];
    map.set(addr, result.status === 'fulfilled' ? result.value : null);
  });
  return map;
}

export async function getTopPayers(limit = 50): Promise<TopPayer[]> {
  try {
    const params = [nativeToScVal(limit, { type: 'u32' })];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_top_payers', params)
    );

    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      return [];
    }

    const native = scValToNative(callResult.result.retval);
    if (!Array.isArray(native)) {
      return [];
    }

    return native.map((entry) => ({
      address: String(entry.address ?? entry.payer ?? entry.account ?? ''),
      score: Number(entry.score ?? 0),
      invoices_paid: Number(entry.invoices_paid ?? entry.paid ?? 0),
      invoices_defaulted: Number(entry.invoices_defaulted ?? entry.defaults ?? 0),
      total_volume: BigInt(entry.total_volume ?? entry.volume_paid ?? 0),
    }));
  } catch (error) {
    console.error('Failed to fetch top payers', error);
    return [];
  }
}

export async function getTopFreelancers(limit = 50): Promise<TopFreelancer[]> {
  try {
    const params = [nativeToScVal(limit, { type: 'u32' })];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_top_freelancers', params)
    );

    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      return [];
    }

    const native = scValToNative(callResult.result.retval);
    if (!Array.isArray(native)) {
      return [];
    }

    return native.map((entry) => ({
      address: String(entry.address ?? entry.freelancer ?? entry.account ?? ''),
      score: Number(entry.score ?? 0),
      invoices_submitted: Number(entry.invoices_submitted ?? entry.submitted ?? 0),
      invoices_funded: Number(entry.invoices_funded ?? entry.funded ?? 0),
      total_earned: BigInt(entry.total_earned ?? entry.earned ?? 0),
    }));
  } catch (error) {
    console.error('Failed to fetch top freelancers', error);
    return [];
  }
}

export async function getTopLPs(limit = 50): Promise<TopLP[]> {
  try {
    const params = [nativeToScVal(limit, { type: 'u32' })];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_top_lps', params)
    );

    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      return [];
    }

    const native = scValToNative(callResult.result.retval);
    if (!Array.isArray(native)) {
      return [];
    }

    return native.map((entry) => ({
      address: String(entry.address ?? entry.lp ?? entry.account ?? ''),
      liquidity_provided: BigInt(entry.liquidity_provided ?? entry.liquidity ?? 0),
      fees_earned: BigInt(entry.fees_earned ?? entry.fees ?? 0),
      total_funded: Number(entry.total_funded ?? entry.funded_count ?? 0),
      score: Number(entry.score ?? 0),
    }));
  } catch (error) {
    console.error('Failed to fetch top LPs', error);
    return [];
  }
}

// ─── Read: protocol status ───────────────────────────────────────────────────

export interface ProtocolStatus {
  paused: boolean;
  paused_at?: number;
  paused_by?: string;
  reason?: string;
}

export async function getProtocolStatus(): Promise<ProtocolStatus> {
  try {
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_protocol_status', [])
    );
    if (rpc.Api.isSimulationSuccess(callResult) && callResult.result?.retval) {
      const native = scValToNative(callResult.result.retval);
      return {
        paused: Boolean(native?.paused ?? native?.is_paused ?? false),
        paused_at: native?.paused_at ? Number(native.paused_at) : undefined,
        paused_by: native?.paused_by ? String(native.paused_by) : undefined,
        reason: native?.reason ? String(native.reason) : undefined,
      };
    }
  } catch {
    // Contract may not have get_protocol_status yet — fall back to unpaused.
  }
  return { paused: false };
}

// ─── Read: admin action history ──────────────────────────────────────────────

export interface AdminAction {
  id: string;
  action_type: string;
  actor: string;
  timestamp: number;
  details: string;
  tx_hash?: string;
}

export async function getAdminActions(limit: number = 50): Promise<AdminAction[]> {
  try {
    const params: xdr.ScVal[] = [nativeToScVal(limit, { type: 'u32' })];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_admin_actions', params)
    );
    if (rpc.Api.isSimulationSuccess(callResult) && callResult.result?.retval) {
      const native = scValToNative(callResult.result.retval);
      if (!Array.isArray(native)) return [];
      return native.map((entry) => ({
        id: String(entry.id ?? entry.action_id ?? ''),
        action_type: String(entry.action_type ?? entry.type ?? 'unknown'),
        actor: String(entry.actor ?? entry.admin ?? entry.address ?? ''),
        timestamp: Number(entry.timestamp ?? entry.ts ?? 0),
        details: String(entry.details ?? entry.description ?? ''),
        tx_hash: entry.tx_hash ? String(entry.tx_hash) : undefined,
      }));
    }
  } catch {
    // Contract may not have get_admin_actions yet — fall back to empty list.
  }
  return [];
}

// ─── Write: fund invoice ──────────────────────────────────────────────────────

/**
 * Builds a `fund_invoice` transaction.
 *
 * The deployed contract signature is
 * `fund_invoice(funder, invoice_id, fund_amount, require_oracle_verification: bool)`.
 * When `requireOracleVerification` is enabled the contract rejects funding if
 * the oracle feed is circuit-tripped from repeated staleness.
 */
export async function fundInvoice(
  funder: string,
  invoice_id: bigint,
  options: { requireOracleVerification?: boolean } = {}
) {
  const params: xdr.ScVal[] = [
    Address.fromString(funder).toScVal(),
    nativeToScVal(invoice_id, { type: 'u64' }),
    nativeToScVal(await getInvoiceRequiredFunding(invoice_id), { type: 'i128' }),
    nativeToScVal(options.requireOracleVerification ?? false),
  ];

  const account = await server.getAccount(funder);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'fund_invoice',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

// ─── Write: mark paid ─────────────────────────────────────────────────────────

export async function markPaid(payer: string, invoice_id: bigint, amount: bigint) {
  const params: xdr.ScVal[] = [
    nativeToScVal(invoice_id, { type: 'u64' }),
    nativeToScVal(amount, { type: 'i128' }),
  ];
  const account = await server.getAccount(payer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'mark_paid',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

export async function appealDefault(payer: string, invoice_id: bigint, evidence_hash: string) {
  const params: xdr.ScVal[] = [
    nativeToScVal(invoice_id, { type: 'u64' }),
    nativeToScVal(evidence_hash),
  ];
  const account = await server.getAccount(payer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'appeal_default',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

// ─── Write: dispute invoice ───────────────────────────────────────────────────

export async function disputeInvoice(payer: string, invoice_id: bigint, reason_hash: string) {
  const params: xdr.ScVal[] = [
    nativeToScVal(invoice_id, { type: 'u64' }),
    nativeToScVal(reason_hash),
  ];
  const account = await server.getAccount(payer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'dispute_invoice',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

/**
 * Whether the deployed contract exposes an `update_lp_whitelist` entry point.
 *
 * The current contract ABI does not include this instruction (tracked in
 * #783), so the feature is deferred: the LP whitelist UI should surface the
 * governance-proposal notice instead of attempting on-chain modifications.
 * Flip this to `true` (and replace the stub below) once the instruction
 * lands on-chain.
 */
export const UPDATE_LP_WHITELIST_SUPPORTED: boolean = false;

/**
 * Stub for updateLPWhitelist — some deployments may not support this
 * instruction; export a placeholder so consumers can safely call it
 * and bundlers don't fail on missing named exports.
 */
export async function updateLPWhitelist(_args: { invoiceId: bigint; whitelist: string[] }) {
  // In production this should build and return a transaction for signing.
  // For now, throw to indicate unsupported on-chain instruction.
  throw new Error('updateLPWhitelist is not supported by the deployed contract');
}

// ─── Write: claim default ─────────────────────────────────────────────────────

export async function claimDefault(funder: string, invoice_id: bigint) {
  const params: xdr.ScVal[] = [
    Address.fromString(funder).toScVal(),
    nativeToScVal(invoice_id, { type: 'u64' }),
  ];
  const account = await server.getAccount(funder);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'claim_default',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

// ─── Write: submit invoice (returns tx for external signing) ──────────────────
// Used by the freelancer dashboard (sign via WalletContext.signTx).

export interface SubmitInvoiceArgs {
  freelancer: string;
  payer: string;
  /** Amount in token base units (1 USDC = 1_000_000) */
  amount: bigint;
  /** Unix timestamp (seconds) */
  dueDate: number;
  /** Basis-points × 100 — e.g. 500 = 5.00% */
  discountRate: number;
  /** Token contract address (defaults to the configured USDC token). */
  token?: string;
  /** Referral code, when the invoice is submitted through a referral campaign. */
  referralCode?: string;
}

export async function submitInvoice(
  args: SubmitInvoiceArgs
): Promise<{ tx: Transaction; invoiceId: bigint }> {
  const params: xdr.ScVal[] = [
    Address.fromString(args.freelancer).toScVal(),
    Address.fromString(args.payer).toScVal(),
    nativeToScVal(args.amount, { type: 'i128' }),
    nativeToScVal(BigInt(args.dueDate), { type: 'u64' }),
    nativeToScVal(args.discountRate, { type: 'u32' }),
    Address.fromString(args.token ?? TESTNET_USDC_TOKEN_ID).toScVal(),
    encodeReferralCode(args.referralCode),
  ];

  const account = await server.getAccount(args.freelancer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'submit_invoice',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${'error' in sim ? sim.error : 'unknown error'}`);
  }

  // Extract the predicted invoice ID from simulation retval
  let invoiceId = BigInt(0);
  try {
    const raw = scValToNative(sim.result!.retval);
    // Contract returns Result<u64, Error> — unwrap Ok variant
    if (raw && typeof raw === 'object' && 'ok' in raw) {
      invoiceId = BigInt((raw as Record<string, unknown>).ok as string | number | bigint);
    } else if (raw && typeof raw === 'object' && 'Ok' in raw) {
      invoiceId = BigInt((raw as Record<string, unknown>).Ok as string | number | bigint);
    } else {
      invoiceId = BigInt(raw as string | number | bigint);
    }
  } catch {
    // If we can't parse it, proceed without the ID — it'll be shown after poll
  }

  const finalTx = rpc.assembleTransaction(tx, sim).build();
  return { tx: finalTx, invoiceId };
}

export interface UpdateInvoiceArgs {
  freelancer: string;
  invoiceId: bigint;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}

export async function updateInvoice(args: UpdateInvoiceArgs): Promise<{ tx: Transaction }> {
  const params: xdr.ScVal[] = [
    Address.fromString(args.freelancer).toScVal(),
    nativeToScVal(args.invoiceId, { type: 'u64' }),
    nativeToScVal(args.amount, { type: 'i128' }),
    nativeToScVal(BigInt(args.dueDate), { type: 'u64' }),
    nativeToScVal(args.discountRate, { type: 'u32' }),
  ];

  const account = await server.getAccount(args.freelancer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'update_invoice',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${'error' in sim ? sim.error : 'unknown error'}`);
  }

  const finalTx = rpc.assembleTransaction(tx, sim).build();
  return { tx: finalTx };
}

export async function cancelInvoice(
  freelancer: string,
  invoiceId: bigint
): Promise<{ tx: Transaction }> {
  // Use a default sequence number / account for preparing or real one if needed
  let account: Account;
  try {
    account = await server.getAccount(freelancer);
  } catch {
    account = new Account(freelancer, '1');
  }

  const contract = new Contract(CONTRACT_ID);

  const txUrl = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('cancel_invoice', nativeToScVal(invoiceId, { type: 'u64' })))
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(txUrl);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${'error' in sim ? sim.error : 'unknown error'}`);
  }

  const finalTx = rpc.assembleTransaction(txUrl, sim).build();
  return { tx: finalTx };
}

export interface ReferralStats {
  total_invoices: number;
  total_volume: bigint;
}

// ... existing code ...

export async function getReferralStats(code: string): Promise<ReferralStats> {
  try {
    const params: xdr.ScVal[] = [encodeReferralCodeBytes(code)];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_referral_stats', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      return { total_invoices: 0, total_volume: 0n };
    }
    const native = scValToNative(callResult.result.retval);
    if (
      native &&
      typeof native === 'object' &&
      !Array.isArray(native) &&
      ('total_invoices' in native || 'total_volume' in native)
    ) {
      const record = native as Record<string, unknown>;
      return {
        total_invoices: Number(record.total_invoices ?? 0),
        total_volume: BigInt((record.total_volume as string | number | bigint) ?? 0),
      };
    }
    // Some contract revisions return the raw referral invoice count (u64).
    const rawCount = typeof native === 'bigint' || typeof native === 'number' ? Number(native) : 0;
    return { total_invoices: rawCount, total_volume: 0n };
  } catch {
    return { total_invoices: 0, total_volume: 0n };
  }
}

export async function submitInvoiceTransaction({
  freelancer,
  payer,
  amount,
  dueDate,
  discountRate,
  signTx,
  token = TESTNET_USDC_TOKEN_ID,
  referralCode = '',
}: {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
  signTx: (txXdr: string) => Promise<string>;
  token?: string;
  referralCode?: string;
}): Promise<SubmittedInvoiceResult> {
  const sourceAccount = await server.getAccount(freelancer);
  // submit_invoice is token-aware and always carries a `ReferralCode` — the
  // union is emitted even when no referral code is supplied so the contract
  // does not read an out-of-bounds trailing argument.
  const args = [
    Address.fromString(freelancer).toScVal(),
    Address.fromString(payer).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(dueDate, { type: 'u64' }),
    nativeToScVal(discountRate, { type: 'u32' }),
    Address.fromString(token).toScVal(),
    encodeReferralCode(referralCode),
  ];

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: 'submit_invoice',
        args,
      })
    )
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulated) || !simulated.result?.retval) {
    const message =
      'error' in simulated ? simulated.error : 'Unable to simulate invoice submission.';
    throw new Error(`Simulation failed: ${message}`);
  }

  const simulatedInvoiceId = BigInt(scValToNative(simulated.result.retval));
  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await signTx(prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;
  const sent = await server.sendTransaction(signedTx);

  if (!sent.hash || !sent.status) {
    throw new Error('RPC server returned an invalid response for invoice submission.');
  }
  if (!ACCEPTED_SEND_STATUSES.has(sent.status)) {
    throw new Error(`Transaction submission failed with status ${sent.status}.`);
  }

  const finalResult = await server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
  if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed with status ${String(finalResult.status)}.`);
  }

  return {
    invoiceId: extractInvoiceIdFromTransaction(finalResult) ?? simulatedInvoiceId,
    txHash: sent.hash,
  };
}

// ─── Write: batch invoice submission ──────────────────────────────────────────

export async function submitInvoicesBatch(
  freelancer: string,
  invoices: Array<{
    payer: string;
    amount: string;
    dueDate: string;
    discountRate: string;
    tokenId: string;
  }>,
  signTx: (txXdr: string) => Promise<string>
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  // Process invoices in parallel batches of 5 to avoid overwhelming the network
  const batchSize = 5;
  for (let i = 0; i < invoices.length; i += batchSize) {
    const batch = invoices.slice(i, i + batchSize);

    const batchPromises = batch.map(async (invoice, batchIndex) => {
      const invoiceIndex = i + batchIndex;
      try {
        // Parse and validate invoice data
        const amount = parseAmountToUnits(invoice.amount, 7);
        const dueDate = toUnixTimestamp(invoice.dueDate);
        const discountRate = parseDiscountRateToBps(invoice.discountRate);

        if (!amount || !dueDate || !discountRate) {
          throw new Error('Invalid invoice data');
        }

        // Submit individual invoice
        const result = await submitInvoiceTransaction({
          freelancer,
          payer: invoice.payer,
          amount,
          dueDate,
          discountRate,
          signTx,
          token: invoice.tokenId,
        });

        return {
          id: `invoice-${invoiceIndex + 1}`,
          success: true,
          invoiceId: result.invoiceId,
          txHash: result.txHash,
        };
      } catch (error) {
        return {
          id: `invoice-${invoiceIndex + 1}`,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          id: `invoice-${results.length + 1}`,
          success: false,
          error: result.reason?.message || 'Batch processing failed',
        });
      }
    });

    // Add a small delay between batches to be respectful to the network
    if (i + batchSize < invoices.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}

// ─── Write: token approve ─────────────────────────────────────────────────────

export async function buildApproveTokenTransaction({
  owner,
  amount,
  spender = CONTRACT_ID,
  tokenId = TESTNET_USDC_TOKEN_ID,
}: {
  owner: string;
  amount: bigint;
  spender?: string;
  tokenId?: string;
}) {
  const account = await server.getAccount(owner);
  const latestLedger = await server.getLatestLedger();
  const expirationLedger = latestLedger.sequence + DEFAULT_TOKEN_ALLOWANCE_LEDGER_BUFFER;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: tokenId,
        function: 'approve',
        args: [
          Address.fromString(owner).toScVal(),
          Address.fromString(spender).toScVal(),
          nativeToScVal(amount, { type: 'i128' }),
          nativeToScVal(expirationLedger, { type: 'u32' }),
        ],
      })
    )
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulated)) {
    const message = 'error' in simulated ? simulated.error : 'Unable to simulate token approval.';
    throw new Error(`Simulation failed: ${message}`);
  }
  return rpc.assembleTransaction(tx, simulated).build();
}

export async function buildApproveUsdcTransaction(args: {
  owner: string;
  amount: bigint;
  spender?: string;
  tokenId?: string;
}) {
  return buildApproveTokenTransaction(args);
}

// ─── Write: generic signed transaction dispatcher ─────────────────────────────

export async function submitSignedTransaction({
  tx,
  signTx,
}: {
  tx: Transaction;
  signTx: (txXdr: string) => Promise<string>;
}): Promise<{ txHash: string }> {
  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await signTx(prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;
  const sent = await server.sendTransaction(signedTx);

  if (!sent.hash || !sent.status) {
    throw new Error('RPC server returned an invalid transaction response.');
  }
  if (!ACCEPTED_SEND_STATUSES.has(sent.status)) {
    throw new Error(`Transaction submission failed with status ${sent.status}.`);
  }

  const finalResult = await server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
  if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed with status ${String(finalResult.status)}.`);
  }
  return { txHash: sent.hash };
}

export async function convertInvoiceToken(
  freelancer: string,
  invoice_id: bigint,
  new_token: string
) {
  const params: xdr.ScVal[] = [
    nativeToScVal(invoice_id, { type: 'u64' }),
    Address.fromString(new_token).toScVal(),
  ];
  const account = await server.getAccount(freelancer);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'convert_invoice_token',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

// ─── Insurance Pool functions ───────────────────────────────────────────────

export async function getInsurancePoolInfo(): Promise<InsurancePoolInfo> {
  try {
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_insurance_info', [])
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      // Fallback for demo if contract method not yet deployed
      return {
        balance: BigInt(500000000000), // 50,000 USDC
        enrolled_count: 12,
        premium_rate: 50, // 0.5%
      };
    }
    const native = scValToNative(callResult.result.retval);
    return {
      balance: BigInt(native.balance ?? 0),
      enrolled_count: Number(native.enrolled_count ?? 0),
      premium_rate: Number(native.premium_rate ?? 0),
    };
  } catch {
    return {
      balance: BigInt(500000000000),
      enrolled_count: 12,
      premium_rate: 50,
    };
  }
}

export async function getLPInsuranceStatus(lpAddress: string): Promise<boolean> {
  try {
    const params: xdr.ScVal[] = [Address.fromString(lpAddress).toScVal()];
    const callResult = await server.simulateTransaction(
      buildReadTransaction(CONTRACT_ID, 'get_enrollment_status', params)
    );
    if (!rpc.Api.isSimulationSuccess(callResult) || !callResult.result?.retval) {
      return false;
    }
    return scValToNative(callResult.result.retval) === true;
  } catch {
    return false;
  }
}

export async function depositPremium(lpAddress: string, amount: bigint) {
  const params: xdr.ScVal[] = [
    Address.fromString(lpAddress).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  ];
  const account = await server.getAccount(lpAddress);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'deposit_premium',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

export async function claimInsurance(lpAddress: string, invoiceId: bigint) {
  const params: xdr.ScVal[] = [
    Address.fromString(lpAddress).toScVal(),
    nativeToScVal(invoiceId, { type: 'u64' }),
  ];
  const account = await server.getAccount(lpAddress);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'claim',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

// ─── Admin: token management ──────────────────────────────────────────────────

/**
 * Builds a transaction that calls `add_token(token, decimals)` on the ILN
 * contract. The contract requires the token's decimal precision to be stored.
 */
export async function adminApproveToken(
  adminAddress: string,
  tokenId: string,
  decimals?: number
): Promise<Transaction> {
  const tokenDecimals = decimals ?? KNOWN_TOKEN_METADATA[tokenId]?.decimals ?? 7;
  const params: xdr.ScVal[] = [
    Address.fromString(tokenId).toScVal(),
    nativeToScVal(tokenDecimals, { type: 'u32' }),
  ];
  const account = await server.getAccount(adminAddress);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'add_token',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

/**
 * Builds a transaction that calls `remove_token(token_id)` on the ILN contract.
 * Must be signed by the admin address and submitted via `signTx`.
 */
export async function adminRemoveToken(
  adminAddress: string,
  tokenId: string
): Promise<Transaction> {
  const params: xdr.ScVal[] = [Address.fromString(tokenId).toScVal()];
  const account = await server.getAccount(adminAddress);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: 'remove_token',
            args: params,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(60 * 5)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}
