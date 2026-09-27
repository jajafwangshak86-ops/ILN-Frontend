import {
  scValToNative,
  xdr,
  rpc,
  nativeToScVal,
  TransactionBuilder,
  Operation,
  Account,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { dedupedFetch, TTL } from '@/lib/horizonClient';
import { getHorizonBaseUrl } from '@/lib/horizon';
import {
  NFT_CONTRACT_ID,
  NFT_EVENT_HINTS,
  NFT_METADATA_METHOD,
  RPC_URL,
  NETWORK_PASSPHRASE,
} from '@/constants';

export interface InvoiceNftTransfer {
  txHash: string;
  timestamp?: number;
  ledger?: number;
  from?: string;
  to?: string;
}

export interface InvoiceNftMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
  raw?: unknown;
}

export type InvoiceNftStatus = 'none' | 'minted' | 'burned' | 'error';

export interface InvoiceNftState {
  status: InvoiceNftStatus;
  tokenId: bigint;
  currentHolder?: string;
  mintDate?: number;
  mintTxHash?: string;
  burnTxHash?: string;
  transfers: InvoiceNftTransfer[];
  metadata?: InvoiceNftMetadata;
  error?: string;
}

type HintType = 'mint' | 'transfer' | 'burn';

function parseEventHints(raw: string): Record<HintType, string[]> {
  const out: Record<HintType, string[]> = { mint: [], transfer: [], burn: [] };
  if (!raw.trim()) return out;

  for (const part of raw.split(';')) {
    const [keyRaw, valuesRaw] = part.split(':');
    const key = (keyRaw ?? '').trim().toLowerCase() as HintType;
    if (!['mint', 'transfer', 'burn'].includes(key)) continue;
    const values = (valuesRaw ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    out[key] = values;
  }

  return out;
}

const G_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function isGAddress(value: unknown): value is string {
  return typeof value === 'string' && G_ADDRESS_RE.test(value);
}

function safeToNumberMs(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function tryDecodeScValBase64(input: unknown): unknown | null {
  if (typeof input !== 'string') return null;
  try {
    const scv = xdr.ScVal.fromXDR(input, 'base64');
    return scValToNative(scv);
  } catch {
    return null;
  }
}

function collectValuesDeep(
  value: unknown,
  out: unknown[] = [],
  seen = new Set<unknown>()
): unknown[] {
  if (value === null || value === undefined) return out;
  if (seen.has(value)) return out;
  seen.add(value);

  out.push(value);

  if (Array.isArray(value)) {
    value.forEach((v) => collectValuesDeep(v, out, seen));
    return out;
  }

  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectValuesDeep(v, out, seen);
    }
  }

  return out;
}

function findTokenIdCandidate(value: unknown, tokenId: bigint): boolean {
  const values = collectValuesDeep(value);
  for (const v of values) {
    if (typeof v === 'bigint' && v === tokenId) return true;
    if (typeof v === 'number' && Number.isSafeInteger(v) && BigInt(v) === tokenId) return true;
    if (typeof v === 'string' && /^\d+$/.test(v)) {
      try {
        if (BigInt(v) === tokenId) return true;
      } catch {
        // ignore
      }
    }
  }
  return false;
}

function findFirstUri(value: unknown): string | undefined {
  const values = collectValuesDeep(value);
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^ipfs:\/\//i.test(s)) return s;
  }
  return undefined;
}

function findAddressPair(value: unknown): { from?: string; to?: string } {
  if (!value || typeof value !== 'object') return {};
  const obj = value as Record<string, unknown>;
  const directFrom = obj.from ?? obj.sender ?? obj.src ?? obj.owner_from;
  const directTo = obj.to ?? obj.receiver ?? obj.dst ?? obj.owner_to ?? obj.owner;

  const from = isGAddress(directFrom) ? directFrom : undefined;
  const to = isGAddress(directTo) ? directTo : undefined;
  if (from || to) return { from, to };

  const values = collectValuesDeep(value);
  const addrs = values.filter(isGAddress) as string[];
  if (addrs.length >= 2) return { from: addrs[0], to: addrs[1] };
  if (addrs.length === 1) return { to: addrs[0] };
  return {};
}

function normalizeEventNameFromTopic(topic: unknown): string | undefined {
  if (typeof topic === 'string') return topic;
  if (topic && typeof topic === 'object') {
    // Common `scValToNative` output for symbols can be a string already, but keep this for safety.
    const record = topic as Record<string, unknown>;
    const maybe = record.sym ?? record.symbol ?? record.name;
    if (typeof maybe === 'string') return maybe;
  }
  return undefined;
}

function classifyEvent(
  eventName: string | undefined,
  decodedValue: unknown,
  hints: Record<HintType, string[]>
): HintType | 'unknown' {
  const name = (eventName ?? '').toLowerCase();
  const matchesHint = (kind: HintType) =>
    hints[kind].some((h) => h.toLowerCase() === name || name.includes(h.toLowerCase()));

  if (matchesHint('burn') || name.includes('burn')) return 'burn';
  if (matchesHint('mint') || name.includes('mint')) return 'mint';
  if (matchesHint('transfer') || name.includes('transfer')) return 'transfer';

  // Heuristic based on fields present.
  const { from, to } = findAddressPair(decodedValue);
  if (from && to) return 'transfer';
  if (!from && to) return 'mint';
  return 'unknown';
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Metadata fetch failed: ${res.status}`);
  return (await res.json()) as T;
}

async function resolveMetadataFromUri(uri: string): Promise<InvoiceNftMetadata | undefined> {
  const normalized = uri.startsWith('ipfs://')
    ? `https://ipfs.io/ipfs/${uri.replace(/^ipfs:\/\//i, '')}`
    : uri;
  try {
    const json = await fetchJson<Record<string, unknown>>(normalized);
    const attributes = Array.isArray(json.attributes)
      ? (json.attributes as Array<{ trait_type?: string; value?: unknown }>)
      : undefined;
    return {
      name: typeof json.name === 'string' ? json.name : undefined,
      description: typeof json.description === 'string' ? json.description : undefined,
      image: typeof json.image === 'string' ? json.image : undefined,
      attributes,
      raw: json,
    };
  } catch {
    return undefined;
  }
}

async function tryResolveMetadataFromRpc(tokenId: bigint): Promise<InvoiceNftMetadata | undefined> {
  // Best-effort: call a configurable contract method that returns a URI-like string.
  // If this fails (method missing / RPC not available), we silently fall back.
  try {
    const server = new rpc.Server(RPC_URL);
    const READ_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const tx = new TransactionBuilder(new Account(READ_ACCOUNT, '0'), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: NFT_CONTRACT_ID,
          function: NFT_METADATA_METHOD,
          args: [nativeToScVal(tokenId, { type: 'u64' })],
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return undefined;
    const native = scValToNative(sim.result.retval);

    const uri =
      typeof native === 'string'
        ? native
        : typeof (native as Record<string, unknown>)?.ok === 'string'
          ? ((native as Record<string, unknown>).ok as string)
          : typeof (native as Record<string, unknown>)?.Ok === 'string'
            ? ((native as Record<string, unknown>).Ok as string)
            : findFirstUri(native);

    if (!uri) return undefined;
    return await resolveMetadataFromUri(uri);
  } catch {
    return undefined;
  }
}

interface HorizonTxRecord {
  hash: string;
  created_at?: string;
  ledger?: number;
  successful?: boolean;
  events?: {
    contractEvents?: Array<{
      topics?: string[];
      value?: string;
      type?: string;
      id?: string;
    }>;
  };
}

interface HorizonTxResponse {
  _embedded?: { records?: HorizonTxRecord[] };
  _links?: { next?: { href?: string } };
}

async function fetchContractTransactionsPage(url: string): Promise<HorizonTxResponse> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Horizon tx fetch failed: ${res.status}`);
  return (await res.json()) as HorizonTxResponse;
}

async function scanTransactionsForToken(
  tokenId: bigint,
  maxPages = 3
): Promise<Omit<InvoiceNftState, 'metadata'>> {
  const hints = parseEventHints(NFT_EVENT_HINTS);
  const base = getHorizonBaseUrl();
  let url = `${base}/transactions?accounts=${encodeURIComponent(
    NFT_CONTRACT_ID
  )}&order=desc&limit=200`;

  const transfers: InvoiceNftTransfer[] = [];
  let mintTxHash: string | undefined;
  let mintDate: number | undefined;
  let currentHolder: string | undefined;
  let burnTxHash: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResp = await fetchContractTransactionsPage(url);
    const records = pageResp._embedded?.records ?? [];

    for (const tx of records) {
      if (tx.successful === false) continue;
      const ts = safeToNumberMs(tx.created_at);

      const contractEvents = tx.events?.contractEvents ?? [];
      for (const rawEvent of contractEvents) {
        const decodedTopics = rawEvent.topics?.map((t) => tryDecodeScValBase64(t) ?? t) ?? [];
        const eventName = normalizeEventNameFromTopic(decodedTopics[0]);
        const decodedValue = tryDecodeScValBase64(rawEvent.value) ?? rawEvent.value;

        if (!findTokenIdCandidate([decodedTopics, decodedValue], tokenId)) continue;

        const kind = classifyEvent(eventName, decodedValue, hints);
        const { from, to } = findAddressPair(decodedValue);

        if (kind === 'burn') {
          burnTxHash = tx.hash;
        } else if (kind === 'mint') {
          if (!mintTxHash) {
            mintTxHash = tx.hash;
            mintDate = ts;
          }
          if (to) currentHolder = to;
        } else if (kind === 'transfer') {
          transfers.push({
            txHash: tx.hash,
            timestamp: ts,
            ledger: tx.ledger,
            from,
            to,
          });
          if (to) currentHolder = to;
        } else {
          // Unknown but token-related: still include as a history line item.
          transfers.push({
            txHash: tx.hash,
            timestamp: ts,
            ledger: tx.ledger,
            from,
            to,
          });
          if (to) currentHolder = to;
        }
      }
    }

    const nextHref = pageResp._links?.next?.href;
    if (!nextHref) break;
    url = nextHref;
  }

  const status: InvoiceNftStatus = burnTxHash
    ? 'burned'
    : mintTxHash || transfers.length > 0
      ? 'minted'
      : 'none';

  // Sort transfers newest-first for UI.
  const sortedTransfers = [...transfers].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return {
    status,
    tokenId,
    currentHolder,
    mintDate,
    mintTxHash,
    burnTxHash,
    transfers: sortedTransfers,
  };
}

export async function fetchInvoiceNftState(invoiceId: bigint): Promise<InvoiceNftState> {
  const tokenId = invoiceId;
  const cacheKey = `invoiceNft:${NFT_CONTRACT_ID}:${tokenId.toString()}`;

  try {
    const state = await dedupedFetch(
      cacheKey,
      async () => scanTransactionsForToken(tokenId),
      TTL.EVENTS
    );

    // Metadata: try event-embedded URIs first (if present in transfer list later, we'd need raw events).
    // With the current Horizon transaction shape, we can only do best-effort via scanning again for a URI.
    // Keep it fast: only attempt RPC path if enabled by env and if NFT exists.
    let metadata: InvoiceNftMetadata | undefined;

    if (state.status !== 'none') {
      // Fetch a tiny sample page and scan for a URI-like string.
      try {
        const base = getHorizonBaseUrl();
        const url = `${base}/transactions?accounts=${encodeURIComponent(
          NFT_CONTRACT_ID
        )}&order=desc&limit=50`;
        const pageResp = await fetchContractTransactionsPage(url);
        const records = pageResp._embedded?.records ?? [];
        for (const tx of records) {
          const contractEvents = tx.events?.contractEvents ?? [];
          for (const rawEvent of contractEvents) {
            const decodedTopics = rawEvent.topics?.map((t) => tryDecodeScValBase64(t) ?? t) ?? [];
            const decodedValue = tryDecodeScValBase64(rawEvent.value) ?? rawEvent.value;
            if (!findTokenIdCandidate([decodedTopics, decodedValue], tokenId)) continue;
            const uri = findFirstUri([decodedTopics, decodedValue]);
            if (uri) {
              metadata = await resolveMetadataFromUri(uri);
              if (metadata) break;
            }
          }
          if (metadata) break;
        }
      } catch {
        // ignore
      }

      if (!metadata) {
        metadata = await tryResolveMetadataFromRpc(tokenId);
      }
    }

    return {
      ...state,
      metadata,
    };
  } catch (err) {
    return {
      status: 'error',
      tokenId,
      transfers: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
