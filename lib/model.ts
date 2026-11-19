// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board answers one question for every protocol that records no token: if this protocol issued a
// token tomorrow, what would that token be worth? Nothing here is a list of names. The multiples come
// from the snapshot's own live-token protocols: for every category, the median market cap per dollar of
// TVL that the tokens which already trade in that category earn. A pre-token protocol is priced at its
// TVL times its category's median multiple, then adjusted three ways:
//
//   comparable = median(mcap_usd / tvl_usd) over live-token protocols of the same category
//   discount   = 0.60   (a protocol with no token yet, no float and thin liquidity, prices under one that trades)
//   growth     = 1 + clamp(change_7d, -50, 100) / 100 * 0.35
//   maturity   = 0.75 + min(age_days, 1460) / 1460 * 0.35   (older with no token: a longer, more credible record)
//   implied    = round(tvl_usd * comparable * discount * growth * maturity)
//
// The watchlist is the floor of the radar, never its ceiling: the board carries every watchlist protocol
// and the pre-token protocols below the floor, which are the early ones a radar exists to find.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  discount: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  early_rows: number;
  live_rows: number;
}

export const MODEL: ModelConstants = {
  discount: 0.6,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.75,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  early_rows: 260,
  live_rows: 30,
};

export const MODEL_VERSION = 'radar-2';

export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comparable_multiple: number;
    discount: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    category_samples: number;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  implied_value_usd: number;
  comparable_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  plan: FarmStep[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  stats: {
    protocols: number;
    pre_token: number;
    live: number;
    watchlist: number;
    board: number;
    early: number;
    board_tvl_usd: number;
    watchlist_tvl_usd: number;
    median_implied_multiple: number;
    global_multiple: number;
  };
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's release marker: a pool of another protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that says wrapped, staked or bridged: a receipt of a token that already trades. */
const DERIVATIVE = /\b(wrapped|staked|staking|bridged)\b/i;

const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories whose protocols are receipts of an asset that already trades, not subjects of their own. */
const RECEIPT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol may stand on the board: it records no token, and is not a receipt of one. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !(p.category !== null && RECEIPT_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !DERIVATIVE.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * What the market pays per dollar of TVL, by category: the median market cap over TVL of the snapshot's
 * own protocols whose token already trades. A category with fewer than three such protocols borrows the
 * whole snapshot's median, so no multiple is ever a guess made of one comparison.
 */
export function comparableMultiples(snapshot: Snapshot): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0.005 || r > 60) continue;
    all.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of ratios) {
    byCategory.set(category, { category, multiple: round4(median(list)), samples: list.length });
  }
  for (const [category, list] of ratios) {
    if (list.length < 3) byCategory.set(category, { category, multiple: round4(global), samples: list.length });
  }
  return { byCategory, global: round4(global) };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The three multipliers and the implied value one pre-token protocol gets under `model`. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  comparable: CategoryMultiple | undefined,
  global: number,
  model: ModelConstants,
): { implied: number; comparable: number; growth: number; maturity: number; age: number | null; samples: number } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = comparable !== undefined ? comparable.multiple : global;
  const samples = comparable !== undefined ? comparable.samples : 0;
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * model.discount * growth * maturity));
  return { implied, comparable: multiple, growth: round4(growth), maturity: round4(maturity), age, samples };
}

/** Gas for one transaction on a protocol's first chain, in whole cents, from the chain's own price level. */
function gasCents(chain: string): number {
  const cheap = ['solana', 'sui', 'aptos', 'base', 'arbitrum', 'optimism', 'polygon', 'blast', 'linea', 'scroll', 'mantle', 'avalanche', 'bnb', 'bsc', 'tron', 'ton', 'near', 'starknet', 'zksync'];
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 900;
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos')) return 2;
  if (cheap.some((k) => c.includes(k))) return 40;
  return 150;
}

/** The capital one position needs, from the protocol's own TVL: deep protocols take more to move the needle. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 300_000_000) return 200;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  return 50;
}

/** How long to keep the position: a young protocol needs a longer record to count. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core position, the one action a farmer has to take, in the protocol's own words. */
export function coreAction(p: SnapshotProtocol, chain: string, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) {
    return `Mint ${name}'s vault shares with $${capital} of USDC on ${chain} and leave the shares in the vault, not in a lending market.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $${Math.round(capital / 4)} of the protocol's own stable asset against it and keep both positions open.`;
  }
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) {
    return `Stake ${capital >= 200 ? '2' : '1'} ${chain === 'Ethereum' ? 'ETH' : 'of the chain\u2019s staking asset'} through ${name} on ${chain} and hold the receipt token it gives back.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in a two-sided range, and keep the LP position open rather than farming and exiting.`;
  }
  if (c.includes('bridge')) {
    return `Move $${capital} of USDC to ${chain} through ${name} and deploy the bridged funds inside the app it fronts, so the volume counts on both sides.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} and hold one small hedged position open for the whole window instead of trading in and out.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and keep two open positions on markets that resolve after the qualifying window closes.`;
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet you farm with.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of ${name}'s stable asset on ${chain} against collateral you already hold, and keep the debt open.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} on a pool you also use, and keep the policy active.`;
  }
  if (c.includes('index') || c.includes('etf')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it without withdrawing for the window.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the window.`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes. Every
 * figure follows from the protocol's own record (category, first chain, TVL, age), never from a list of
 * names, so two protocols of one category with the same TVL get the same plan.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasCents(chain);
  const hold = holdDays(age);
  const usd = (cents: number): string => (cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents}\u00a2`);
  const score = Math.max(1, Math.round(p.tvl_usd / 1_000_000));
  return [
    {
      action: `Create a wallet used for nothing but this farm on ${chain}, fund it with $${capital + 20} and keep the seed phrase off the machine you farm from.`,
      cost: `${usd(gas)} of gas for the first transaction, $20 held back for the rest`,
      time: '10 minutes, once',
    },
    {
      action: coreAction(p, chain, capital),
      cost: `$${capital} of capital plus about ${usd(gas * 2)} of gas for the two transactions`,
      time: '20 minutes to open, then leave it',
    },
    {
      action: `Return once a week and make one qualifying call \u2014 a deposit, a borrow, a claim or a vote \u2014 so the wallet shows activity in more than one week.`,
      cost: `about ${usd(gas)} of gas a week, nothing else`,
      time: '10 minutes a week',
    },
    {
      action: `Keep the position open for at least ${hold} days. A protocol with $${score}M of TVL is tracked daily, so a ${hold}-day record outlasts any single snapshot.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      action: `Before any launch, check ${p.name}'s own site and its official channels for a points page, and never connect the farming wallet to a link you were sent.`,
      cost: 'free; a real claim never asks for a payment',
      time: '15 minutes, once a month',
    },
    {
      action: `When you unwind, withdraw in the same order you opened, record every transaction hash and the dates in a log, and keep the log with the wallet's history for tax.`,
      cost: `about ${usd(gas * 2)} of gas to exit`,
      time: '30 minutes',
    },
  ];
}

/** A step as the one string board.json carries: action, cost, time. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you start.`;
  return s;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The rows the board ranks: every watchlist protocol, then the pre-token protocols under the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const { byCategory, global } = comparableMultiples(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not name, by TVL, capped. A
  // protocol above the floor that the house rule left out (a receipt, a versioned pool) is left out here
  // too; one below the floor is exactly what a radar is for.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, model.early_rows);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, byCategory.get(p.category ?? 'Uncategorised'), global, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((row, i) => ({
    rank: i + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl_usd: row.p.tvl_usd,
    change_7d: row.p.change_7d,
    mcap_usd: row.p.mcap_usd,
    listed_at: row.p.listed_at,
    gecko_id: row.p.gecko_id,
    symbol: row.p.symbol,
    token_status: 'pre-token',
    age_days: row.s.age,
    implied_value_usd: row.s.implied,
    model: {
      comparable_multiple: row.s.comparable,
      discount: model.discount,
      growth_multiplier: row.s.growth,
      maturity_multiplier: row.s.maturity,
      age_days: row.s.age,
      category_samples: row.s.samples,
    },
    farm_steps: farmPlan(row.p, row.s.age).map(stepText),
  }));
}

/** The protocols whose token already trades, by market cap: the market's own values, kept off the board. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && (p.mcap_usd ?? 0) > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, model.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      multiple: round4((p.mcap_usd as number) / Math.max(1, p.tvl_usd)),
    }));
}

/** Everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const { byCategory, global } = comparableMultiples(snapshot);
  const live = liveRows(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const index = bySlug(snapshot.protocols);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    listed_at: r.listed_at,
    implied_value_usd: r.implied_value_usd,
    comparable_multiple: r.model.comparable_multiple,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    watchlist: watchlist.has(r.slug),
    plan: farmPlan(index.get(r.slug)!, r.age_days),
  }));
  const multiples: CategoryMultiple[] = [...byCategory.values()]
    .filter((m) => m.samples >= 3)
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const ratios = board.map((r) => r.implied_value_usd / Math.max(1, r.tvl_usd));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !watchlist.has(r.slug)).length,
      board_tvl_usd: board.reduce((s, r) => s + r.tvl_usd, 0),
      watchlist_tvl_usd: board.filter((r) => watchlist.has(r.slug)).reduce((s, r) => s + r.tvl_usd, 0),
      median_implied_multiple: round4(median(ratios)),
      global_multiple: global,
    },
    multiples,
    rows,
    live,
  };
  return { board, radar };
}

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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
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
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
