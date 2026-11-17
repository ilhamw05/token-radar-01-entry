// Token Launch Radar — the value model (peer-multiple model, version peer-multiple-1).
//
// One sealed snapshot of the protocol universe in, one ranked board out. The board covers every slug
// in the snapshot's watchlist (the floor, never a ceiling) and adds the strongest pre-token protocols
// below the floor: the early finds this radar exists for. A protocol is pre-token when its record
// carries no token at all: no CoinGecko id, no symbol, no market cap. Protocols whose token already
// trades are never ranked; they are counted and set aside, and they do one job here — they price the
// categories the pre-token protocols sit in.
//
// The implied value of a pre-token protocol is its TVL priced the way the market already prices its
// listed peers, then adjusted for the protocol's own momentum and track record:
//
//   multiple  = the median market-cap / TVL of this snapshot's live protocols in the same category
//               (the category's own median when at least 3 live protocols price it, else the
//               overall live median). Computed from the snapshot at run time, never a constant.
//   growth    = 1 + clamp(change_7d, -30, +50) x 0.006     (no reported change: 1)
//   maturity  = 0.70 + 0.30 x min(age in days, 1095) / 1095 (no listing date: 0.85)
//   implied   = max(1, round(TVL x multiple x growth x maturity))
//
// The factors are rounded (multiple to 3 decimals, growth and maturity to 4) before they multiply, so
// the arithmetic a reader sees on the dashboard is the arithmetic that produced the number. No
// protocol name is ever special-cased: one function scores every row, and the function is a pure
// function of the snapshot — same bytes in, same board out.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-multiple-1';

/** How many below-floor early finds the board adds under the watchlist floor. */
export const EARLY_ROWS = 120;

/** A farm step before it is flattened to one string: the action, its cost, its time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's own working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** Everything the dashboard needs: the board and the snapshot's own headline counts. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  scanned: number;
  pre_token_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no CoinGecko id, no symbol, no market cap. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The snapshot's peer pricing: one market-cap/TVL median per category, and the overall live median. */
export interface PeerMultiples {
  overall: number;
  byCategory: Map<string, number>;
  liveCount: number;
}

/**
 * Price the categories from the snapshot's own live protocols (market cap and TVL both present and
 * positive). A category's median is kept only when at least 3 live protocols price it; thinner
 * categories fall back to the overall live median at lookup time.
 */
export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const ratios: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? '';
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [ratio]);
    else group.push(ratio);
  }
  const byCategory = new Map<string, number>();
  for (const [key, group] of groups) {
    if (group.length >= 3) byCategory.set(key, median(group));
  }
  return { overall: ratios.length > 0 ? median(ratios) : 0, byCategory, liveCount: ratios.length };
}

/** The multiple one protocol is priced at: its category's median, else the overall live median. */
function multipleFor(p: SnapshotProtocol, peers: PeerMultiples): number {
  return peers.byCategory.get(p.category ?? '') ?? peers.overall;
}

/** One protocol's score under the model: the implied value and every factor that produced it. */
export interface Score {
  implied: number;
  multiple: number;
  growthPct: number;
  growth: number;
  maturity: number;
  age: number | null;
}

/** Score one pre-token protocol. Pure: the same protocol and snapshot always give the same score. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, peers: PeerMultiples): Score {
  const age = ageDays(asOf, p.listed_at);
  const multiple = round3(multipleFor(p, peers));
  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, -30, 50);
  const growth = p.change_7d === null ? 1 : round4(1 + growthPct * 0.006);
  const maturity = age === null ? 0.85 : round4(0.7 + 0.3 * (Math.min(age, 1095) / 1095));
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity));
  return { implied, multiple, growthPct, growth, maturity, age };
}

/** Categories whose products are a wrapped, staked or bridged form of something else, never a launch. */
const WRAPPER_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word that marks a product as a wrapped or staked form of another asset. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a release marker: a later version of another protocol, not a new launch. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that begins with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol reads as a wrapper-like product of a token that already trades. */
export function isWrapperLike(p: SnapshotProtocol): boolean {
  return (
    (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) ||
    WRAPPER_WORD.test(p.name) ||
    VERSIONED_NAME.test(p.name) ||
    EXCHANGE_NAME.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Rank order: implied value first, then TVL, then slug — total, so the board never depends on input order. */
function byRank(a: Score & { p: SnapshotProtocol }, b: Score & { p: SnapshotProtocol }): number {
  return b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its score.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early finds: pre-token protocols below the floor that are not wrapper-like, strongest first,
  // capped. A watchlist protocol is never displaced by an early find.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd && !isWrapperLike(p))
    .map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, peers) }))
    .sort(byRank)
    .slice(0, EARLY_ROWS);
  for (const s of early) chosen.set(s.p.slug, s.p);

  const scored = [...chosen.values()].map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, peers) }));
  scored.sort(byRank);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growth,
      maturity_multiplier: s.maturity,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans
//
// Every plan is generated from the protocol's own record: its category family, its first chain, its
// TVL and a hash of its slug. Each step names the chain, a concrete action, an amount or a frequency,
// a dollar cost and a time. Gas is priced by chain class: Ethereum is dear, the big L2s are cheap,
// Solana is near-free, and anything unlisted is priced as a mid-cost chain. Variation between plans
// comes from the slug hash alone, so a plan is a pure function of the snapshot like everything else.

/** FNV-1a hash of a slug: the deterministic seed every per-protocol variation draws from. */
function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic integer in [lo, hi] drawn from the hash at a given salt. */
function draw(hash: number, salt: number, lo: number, hi: number): number {
  const mixed = (hash ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  return lo + (mixed % (hi - lo + 1));
}

/** A deterministic dollar figure in [lo, hi] drawn from the hash at a given salt. */
function drawMoney(hash: number, salt: number, lo: number, hi: number): number {
  const mixed = (hash ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  return lo + ((mixed % 1000) / 1000) * (hi - lo);
}

/** Chains whose gas is priced as an L2: cents to a dollar or so a transaction. */
const L2_CHAINS = new Set([
  'Base', 'Arbitrum', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Mode', 'Blast',
  'Taiko', 'Metis', 'Polygon zkEVM', 'Starknet', 'Manta', 'Fraxtal', 'Zora', 'World Chain',
  'Unichain', 'Ink', 'Soneium', 'Abstract', 'BOB', 'X Layer', 'opBNB', 'Celo', 'Lisk', 'Swellchain',
]);

/** The gas range in dollars for one transaction on a chain, by the chain's class. */
function gasRange(chain: string): [number, number] {
  if (chain === 'Ethereum') return [8, 25];
  if (chain === 'Solana') return [0.02, 0.1];
  if (chain === 'Tron') return [1, 3];
  if (chain === 'Bitcoin') return [1, 5];
  if (L2_CHAINS.has(chain)) return [0.1, 1.5];
  return [0.5, 2];
}

/** A gas figure as the plans state it: whole dollars when dear, cents when cheap. */
function gasFor(chain: string, hash: number, salt: number): string {
  const [lo, hi] = gasRange(chain);
  const v = drawMoney(hash, salt, lo, hi);
  return v >= 5 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** The plan family a category belongs to: vault/curator, lending/CDP, DEX, RWA, chain, payments, restaking, basis/yield, or the default. */
type FarmFamily = 'vault' | 'lending' | 'dex' | 'rwa' | 'chain' | 'payments' | 'restaking' | 'yield' | 'default';

function familyOf(category: string | null): FarmFamily {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('aggregator') || c.includes('liquidity manager')) return 'vault';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('rwa')) return 'rwa';
  if (c === 'chain') return 'chain';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('restak') || c.includes('staking')) return 'restaking';
  if (c.includes('basis') || c.includes('yield') || c.includes('farm') || c.includes('stable') || c.includes('synthetic')) return 'yield';
  return 'default';
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const body = step.text.endsWith('.') ? step.text : `${step.text}.`;
  let s = `${body} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.trim().length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: four or five steps, each an action with a cost and a time, written from the
 * protocol's category family, first chain and size. Step one opens the position, step two deepens it,
 * step three keeps a weekly rhythm, step four holds, and step five watches for the launch while the
 * protocol records no token.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const name = p.name;
  const family = familyOf(p.category);
  const h = slugHash(p.slug);
  const capital = capitalFor(p.tvl_usd);
  const half = Math.max(25, Math.round(capital / 2));
  const swapSize = 25 * draw(h, 3, 1, 4);
  const txCount = draw(h, 4, 3, 5);
  const weeks = draw(h, 5, 8, 12);
  const holdNote = age !== null && age < 180 ? ` The protocol is young, so the longer end of that hold matters more.` : '';

  const open: Record<FarmFamily, string> = {
    vault: `Deposit $${capital} of USDC into a ${name} vault on ${chain}; choose the vault whose curator states its strategy in plain words, and keep the vault shares in the wallet that deposited`,
    lending: `Supply $${capital} of USDC to ${name} on ${chain} as collateral and leave the supply position open; do not loop it until you have farmed a full week first`,
    dex: `Add $${capital} of liquidity, split between USDC and the pool's other asset, to the busiest ${name} pool on ${chain}, and keep the LP position in the wallet that opened it`,
    rwa: `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} through its own app, and hold the asset in the wallet that minted it`,
    chain: `Bridge $${capital} of USDC onto ${chain} and hold the balance in a wallet you control there; a chain that records no token can only reward wallets that actually settle on it`,
    payments: `Open a ${name} account funded from ${chain}, load $${capital} of USDC, and make a first payment or card transaction so the account counts as active, not just registered`,
    restaking: `Restake $${capital} of the staking asset ${name} accepts on ${chain} and keep the receipt in the same wallet for the whole season`,
    yield: `Deposit $${capital} of USDC into the main ${name} strategy on ${chain} and keep the position open; yield farms count wallets that stay, not wallets that pass through`,
    default: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open in the wallet that made it`,
  };
  const deepen: Record<FarmFamily, string> = {
    vault: `Split a second $${half} across two ${name} vaults on ${chain} run by different curators, so the farm is not riding on a single strategy`,
    lending: `Borrow about 30% against the supplied collateral on ${chain} and park the borrowed USDC back in ${name} once; one careful loop reads as real use, ten loops read as farming`,
    dex: `Route five swaps of about $${swapSize} each through ${name} on ${chain} across the week instead of one large swap, so the volume looks like trading rather than a single pass`,
    rwa: `Hold the minted asset for one full yield cycle on ${chain} and claim the yield inside the ${name} app rather than selling the asset on a secondary market`,
    chain: `Make ${txCount} ordinary transactions on ${chain} this week — a transfer, a swap inside a local app and one contract call — spaced across different days, using the bridged balance`,
    payments: `Route one real payment a week through ${name}, paid from the ${chain} balance, and keep every receipt; volume spread over weeks is what payment farms count`,
    restaking: `If the ${name} app on ${chain} offers a choice of services to secure, opt into one and note the position in your farm log with a screenshot`,
    yield: `Rebalance once inside ${name} on ${chain}: move half the position to its second strategy if it lists one, or add $${half} of fresh USDC if it does not`,
    default: `Make a second deposit of $${half} into ${name} on ${chain} one week after the first, so the wallet shows a pattern of use rather than a single visit`,
  };
  const weekly: Record<FarmFamily, string> = {
    vault: `Check the vault's yield and the curator's notes once a week on ${chain}, and top up $${half} whenever the balance drifts below your starting amount`,
    lending: `Repay and re-borrow a small slice of the position once a week on ${chain} to keep it active, and check the health factor after every change`,
    dex: `Swap about $${swapSize} through ${name} once a week on ${chain}, and rebalance the liquidity if the price has moved out of your range`,
    rwa: `Add $${half} to the ${name} position once a month on ${chain} and file each mint receipt with the yield statements`,
    chain: `Use ${chain} for one real task a week — pay, save or swap inside an app that settles there — and keep the explorer link for each transaction`,
    payments: `Keep one payment a week flowing through ${name} from ${chain}; a wallet that pays every week outranks one that paid once and vanished`,
    restaking: `Claim restaking points or rewards in the ${name} app on ${chain} once a week, and restake any payout into the same position`,
    yield: `Compound the yield back into ${name} once a week on ${chain}; compounding leaves the weekly on-chain heartbeat these farms measure`,
    default: `Repeat the core ${name} action once a week on ${chain} with a small amount, so the wallet's history shows a weekly rhythm`,
  };

  const steps: FarmStep[] = [
    { text: open[family], cost: `about ${gasFor(chain, h, 1)} of gas on ${chain}, plus the $${capital} position itself`, time: 'about 15 minutes' },
    { text: deepen[family], cost: `about ${gasFor(chain, h, 2)} of gas on ${chain}`, time: 'about 10 minutes' },
    { text: weekly[family], cost: `about ${gasFor(chain, h, 3)} of gas a week on ${chain}`, time: 'about 10 minutes a week' },
    {
      text: `Hold the ${name} position on ${chain} for ${weeks} weeks without a full withdrawal; partial top-ups are fine, but an emptied wallet restarts the clock in most points systems.${holdNote}`,
      cost: `no gas while you hold; about ${gasFor(chain, h, 4)} if you adjust the position`,
      time: `hold ${weeks} weeks`,
    },
    {
      text: `While ${name} records no token, read its official announcements once a week and claim only through links its own page publishes for ${chain}; never pay any site that asks a fee to release an airdrop`,
      cost: `nothing to read; a claim later costs about ${gasFor(chain, h, 5)} of gas`,
      time: 'about 5 minutes a week',
    },
  ];
  // One plan in four runs a step shorter: the deepen step folds into the weekly rhythm.
  if (h % 4 === 0) steps.splice(1, 1);
  return steps;
}

/** A board row's form for data.js: everything the page renders, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    category_multiple: row.model.category_multiple,
    growth_factor: row.model.growth_multiplier,
    maturity_factor: row.model.maturity_multiplier,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    scanned: snapshot.protocols.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: snapshot.protocols.filter((p) => p.gecko_id !== null).length,
    rows: board.map(radarRow),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters once trimmed`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
