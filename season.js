// ============================================
// Season Infrastructure
// Identity, tickets, rolls, commitments
// Everything public except the live season secret
// ============================================

import { createHash, createHmac, randomBytes } from "node:crypto";

// ============================================
// Constants
// ============================================

export const RARITY_THRESHOLDS = { common: 0.55, uncommon: 0.85, rare: 0.97 };

export const TIER_TO_RARITY = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", holoRare: "Rare Holo",
};

export const SCORE_WEIGHTS = { Common: 1, Uncommon: 3, Rare: 8, "Rare Holo": 20 };

const IGNORE_PATTERNS = [
  /package-lock\.json$/, /pnpm-lock\.yaml$/, /yarn\.lock$/, /\.snap$/,
  /\.min\.(js|css)$/, /vendor\//, /node_modules\//, /generated\//,
  /\.gen\./, /dist\//, /build\//,
];

// ============================================
// Fair Permutation Model
// Same probability distribution for everyone.
// Trainer seed only changes which card sits at which position.
// ============================================

export function positionWeights(poolSize) {
  if (poolSize <= 1) return [1];
  const weights = new Float64Array(poolSize);
  for (let i = 0; i < poolSize; i++) {
    weights[i] = 0.75 + (i / (poolSize - 1)) * 0.6; // 0.75 to 1.35
  }
  return weights;
}

export function seededShuffle(arr, seed) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const h = createHmac("sha256", seed).update(`shuffle:${i}`).digest();
    const j = h.readUInt32BE(0) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const permCache = new Map();

export function trainerPermutation(pool, trSeed, poolId) {
  const cacheKey = `${trSeed.toString("hex").slice(0, 16)}:${poolId}:${pool.length}`;
  if (permCache.has(cacheKey)) return permCache.get(cacheKey);
  const permSeed = createHmac("sha256", trSeed).update(poolId).digest();
  const permuted = seededShuffle(pool, permSeed);
  permCache.set(cacheKey, permuted);
  return permuted;
}

export function fairPick(pool, trSeed, poolId) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const permuted = trainerPermutation(pool, trSeed, poolId);
  const weights = positionWeights(pool.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return permuted[i];
  }
  return permuted[permuted.length - 1];
}

export function fairPickSeeded(pool, trSeed, poolId, rngVal) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const permuted = trainerPermutation(pool, trSeed, poolId);
  const weights = positionWeights(pool.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rngVal * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return permuted[i];
  }
  return permuted[permuted.length - 1];
}

// ============================================
// Card pool utilities
// ============================================

const API_BASE = "https://api.pokemontcg.io/v2";

export async function fetchSet(setId) {
  const cards = [];
  let page = 1, hasMore = true;
  while (hasMore) {
    const res = await fetch(`${API_BASE}/cards?q=set.id:${setId}&pageSize=250&page=${page}`);
    const data = await res.json();
    cards.push(...data.data);
    hasMore = cards.length < data.totalCount;
    page++;
  }
  return cards;
}

export function bucketCards(cards) {
  const b = { holoRare: [], rare: [], uncommon: [], common: [], energy: [] };
  for (const c of cards) {
    const r = (c.rarity || "").toLowerCase();
    const st = (c.supertype || "").toLowerCase();
    if (st === "energy") b.energy.push(c);
    else if (r === "rare holo") b.holoRare.push(c);
    else if (r === "rare") b.rare.push(c);
    else if (r === "uncommon") b.uncommon.push(c);
    else if (r === "common") b.common.push(c);
  }
  return b;
}

export function rollCardLive(pool, trainerSeed, setId) {
  const roll = Math.random();
  let tier, tierPool;
  if (roll < RARITY_THRESHOLDS.common) { tier = "common"; tierPool = pool.common; }
  else if (roll < RARITY_THRESHOLDS.uncommon) { tier = "uncommon"; tierPool = pool.uncommon; }
  else if (roll < RARITY_THRESHOLDS.rare) { tier = "rare"; tierPool = pool.rare.length > 0 ? pool.rare : pool.uncommon; }
  else { tier = "holoRare"; tierPool = pool.holoRare.length > 0 ? pool.holoRare : pool.rare; }
  return { card: fairPick(tierPool, trainerSeed, `${setId}:${tier}`), isHolo: tier === "holoRare" };
}

// ============================================
// Identity
// ============================================

export function trainerId(githubUserId) {
  return String(githubUserId);
}

export function trainerSeed(seasonId, githubUserId) {
  return createHash("sha256").update(`trainer:v1||${seasonId}||${githubUserId}`).digest();
}

// ============================================
// Season lifecycle
// ============================================

export function generateSeasonSecret() { return randomBytes(32); }
export function seasonCommitment(secret) { return createHash("sha256").update(secret).digest("hex"); }
export function dayKey(secret, dateStr) { return createHmac("sha256", secret).update(dateStr).digest(); }
export function dayCommitment(secret, dateStr) { return createHash("sha256").update(dayKey(secret, dateStr)).digest("hex"); }

// ============================================
// Tickets
// ============================================

export function ticketId({ seasonId, repoId, prNumber, mergeCommitSha, authorUserId, ticketIndex = 0 }) {
  return createHash("sha256")
    .update(`season:v1||${seasonId}||${repoId}||${prNumber}||${mergeCommitSha}||${authorUserId}||${ticketIndex}`)
    .digest("hex");
}

export function ticketCount(diffStats) {
  const { netReviewedLoc } = diffStats;
  if (netReviewedLoc < 1) return 0;
  if (netReviewedLoc < 150) return 1;
  if (netReviewedLoc < 600) return 2;
  return 3;
}

export function computeDiffStats(files) {
  let netReviewedLoc = 0, totalFiles = 0;
  for (const f of files) {
    if (IGNORE_PATTERNS.some(p => p.test(f.filename))) continue;
    if (/\.md$/i.test(f.filename)) continue;
    totalFiles++;
    netReviewedLoc += (f.additions || 0) + (f.deletions || 0);
  }
  return { netReviewedLoc, totalFiles };
}

// ============================================
// Rolls — deterministic from secret + ticket
// ============================================

export function rollSeed(secret, ticket) {
  return createHmac("sha256", secret).update(ticket).digest();
}

export function seededFloat(seed, nonce) {
  return createHmac("sha256", seed).update(nonce).digest().readUInt32BE(0) / 0x100000000;
}

export function ticketEarnsPack(secret, ticket) {
  return rollSeed(secret, ticket)[0] < 102;
}

export function ticketSet(secret, ticket, sets) {
  return sets[rollSeed(secret, ticket)[1] % sets.length];
}

export function rollPack(secret, ticket, pool, trSeed, setId = "unknown") {
  const rs = rollSeed(secret, ticket);
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const rarityRoll = seededFloat(rs, `rarity:${i}`);
    const cardRoll = seededFloat(rs, `card:${i}`);
    let tier;
    if (rarityRoll < 0.55) tier = "common";
    else if (rarityRoll < 0.85) tier = "uncommon";
    else if (rarityRoll < 0.97) tier = "rare";
    else tier = "holoRare";
    const tierPool = pool[tier]?.length > 0 ? pool[tier]
      : pool.rare?.length > 0 ? pool.rare
      : pool.uncommon?.length > 0 ? pool.uncommon
      : pool.common;
    if (!tierPool || tierPool.length === 0) throw new Error(`rollPack: empty pool for ${tier} in ${setId}`);
    cards.push({ cardId: fairPickSeeded(tierPool, trSeed, `${setId}:${tier}`, cardRoll), tier, isHolo: tier === "holoRare" });
  }
  return cards;
}

// ============================================
// Scoring
// ============================================

export function binderScore(cards, cardMeta) {
  let score = 0;
  const seen = new Set();
  for (const [cardId, count] of Object.entries(cards)) {
    if (count < 1) continue;
    seen.add(cardId);
    score += SCORE_WEIGHTS[cardMeta[cardId]?.rarity] || SCORE_WEIGHTS.Common;
  }
  const setTotals = { base1: 102, base2: 64, base3: 62 };
  for (const [setId, total] of Object.entries(setTotals)) {
    const pct = [...seen].filter(id => id.startsWith(setId + "-")).length / total;
    if (pct >= 1.0) score += 100;
    else if (pct >= 0.75) score += 50;
    else if (pct >= 0.50) score += 20;
    else if (pct >= 0.25) score += 5;
  }
  return score;
}

// ============================================
// Ledger + manifest formats
// ============================================

export function ledgerRecord({
  seasonId, ticketId, repoId, prNumber, mergeCommitSha,
  authorUserId, authorLogin, eligible, ticketIndex, ticketTotal,
  cards, setId, rollCommitment,
}) {
  return {
    v: 1, season_id: seasonId, ticket_id: ticketId,
    repo_id: repoId, pr_number: prNumber, merge_commit_sha: mergeCommitSha,
    author_user_id: authorUserId, author_login: authorLogin,
    eligible, ticket_index: ticketIndex, ticket_total: ticketTotal,
    set_id: setId || null, cards: cards || [],
    roll_commitment: rollCommitment || null,
    created_at: new Date().toISOString(),
  };
}

export function createSeasonManifest({
  seasonId, name, startDate, endDate, rulesVersion,
  seasonCommitment: commitment, repoAllowlist, scoring,
}) {
  return {
    season_id: seasonId, name, start_date: startDate, end_date: endDate,
    rules_version: rulesVersion || "1.0", season_commitment: commitment,
    repo_allowlist: repoAllowlist || [],
    pack_odds: { common: 0.55, uncommon: 0.30, rare: 0.12, holo_rare: 0.03 },
    ticket_rules: {
      source: "merged_pr",
      substance_thresholds: [
        { min_loc: 1, max_loc: 149, tickets: 1 },
        { min_loc: 150, max_loc: 599, tickets: 2 },
        { min_loc: 600, max_loc: null, tickets: 3 },
      ],
      ignored_patterns: IGNORE_PATTERNS.map(p => p.source),
    },
    score_weights: SCORE_WEIGHTS,
    scoring: scoring || { primary: "binder_score", tiebreaker: "unique_cards" },
  };
}
