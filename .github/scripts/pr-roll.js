// ============================================
// PR Roll — Central Game Engine
// Every ticket earns a pack. Day-key-based rolls.
// Idempotent — re-running same event does not duplicate.
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  trainerSeed, ticketId, ticketCount, dayKey,
  rollPack, ticketSet, rollSeed,
  ledgerRecord, binderScore, SCORE_WEIGHTS, TIER_TO_RARITY,
} from "../../season.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LEDGER_DIR = resolve(ROOT, "ledger");
const LEADERBOARD_FILE = resolve(ROOT, "leaderboard.json");

// ============================================
// Card pools — WotC-era sets, mutually exclusive tiers
// ============================================

const CARD_POOLS = {
  base1: {
    common: Array.from({ length: 27 }, (_, i) => `base1-${43 + i}`),
    uncommon: Array.from({ length: 20 }, (_, i) => `base1-${23 + i}`),
    rare: ["base1-17", "base1-18", "base1-19", "base1-20", "base1-21", "base1-22"],
    holoRare: Array.from({ length: 16 }, (_, i) => `base1-${1 + i}`),
  },
  base2: {
    common: Array.from({ length: 16 }, (_, i) => `base2-${49 + i}`),
    uncommon: Array.from({ length: 16 }, (_, i) => `base2-${33 + i}`),
    rare: Array.from({ length: 16 }, (_, i) => `base2-${17 + i}`),
    holoRare: Array.from({ length: 16 }, (_, i) => `base2-${1 + i}`),
  },
  base3: {
    common: Array.from({ length: 17 }, (_, i) => `base3-${46 + i}`),
    uncommon: Array.from({ length: 16 }, (_, i) => `base3-${30 + i}`),
    rare: Array.from({ length: 16 }, (_, i) => `base3-${14 + i}`),
    holoRare: Array.from({ length: 13 }, (_, i) => `base3-${1 + i}`),
  },
};

const SETS = ["base1", "base2", "base3"];

// Rarity map from card pools
const cardRarityMap = {};
for (const [sid, tiers] of Object.entries(CARD_POOLS)) {
  for (const [tier, ids] of Object.entries(tiers)) {
    const rarity = TIER_TO_RARITY[tier] || "Common";
    for (const id of ids) cardRarityMap[id] = rarity;
  }
}

// ============================================
// Read env
// ============================================

const seasonSecretHex = process.env.SEASON_SECRET;
const seasonSecret = seasonSecretHex ? Buffer.from(seasonSecretHex, "hex") : null;
const prNumber = parseInt(process.env.PR_NUMBER, 10);
const authorUserId = process.env.PR_AUTHOR_ID;
const authorLogin = process.env.PR_AUTHOR_LOGIN;
const mergeCommitSha = process.env.MERGE_COMMIT_SHA;
const repoId = process.env.REPO_ID;
const repoName = process.env.REPO_NAME;
const prAdditions = parseInt(process.env.PR_ADDITIONS || "0", 10);
const prDeletions = parseInt(process.env.PR_DELETIONS || "0", 10);

if (!seasonSecretHex || !seasonSecret) { console.log("SEASON_SECRET not set — skipping"); process.exit(0); }
if (!mergeCommitSha || !authorUserId || !prNumber) { console.error("Missing PR metadata"); process.exit(1); }

// ============================================
// Season config
// ============================================

const manifestPath = resolve(ROOT, "season-manifest.json");
let manifest = { season_id: "2026-q2", rules_version: "1.0" };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const seasonId = manifest.season_id;
const rulesVersion = manifest.rules_version || "1.0";
const eventDate = new Date().toISOString().slice(0, 10);

console.log(`${repoName}#${prNumber} by ${authorLogin} | ${eventDate} | season: ${seasonId}`);

// ============================================
// Idempotency — check if this PR was already scored
// ============================================

if (!existsSync(LEDGER_DIR)) mkdirSync(LEDGER_DIR, { recursive: true });
const ledgerFile = resolve(LEDGER_DIR, `${seasonId}.ndjson`);

const prKey = `${repoId}:${prNumber}:${mergeCommitSha}`;
if (existsSync(ledgerFile)) {
  const existing = readFileSync(ledgerFile, "utf8");
  if (existing.includes(mergeCommitSha)) {
    console.log("Already scored — skipping (idempotent)");
    process.exit(0);
  }
}

// ============================================
// Substance + tickets
// ============================================

const netLoc = prAdditions + prDeletions;
const numTickets = ticketCount({ netReviewedLoc: netLoc });

console.log(`Substance: ${netLoc} LOC → ${numTickets} ticket(s)`);

if (numTickets === 0) {
  appendFileSync(ledgerFile, JSON.stringify(ledgerRecord({
    seasonId, ticketId: "ineligible", repoId, prNumber, mergeCommitSha,
    authorUserId, authorLogin, eligible: false, ticketIndex: 0, ticketCount: 0,
    eventDate, setId: null, cards: [], binderScoreAfter: null,
    dayKeyRef: eventDate, rulesVersion,
  })) + "\n");
  console.log("No substance — logged as ineligible");
  process.exit(0);
}

// ============================================
// Derive day key and roll packs
// ============================================

const dk = dayKey(seasonSecret, eventDate);
const trSeed = trainerSeed(seasonId, authorUserId);

// Accumulate binder state for this trainer from existing ledger
const trainerCards = {};
if (existsSync(ledgerFile)) {
  for (const line of readFileSync(ledgerFile, "utf8").split("\n").filter(l => l.trim())) {
    const entry = JSON.parse(line);
    if (entry.author_user_id === authorUserId && entry.cards?.length > 0) {
      for (const c of entry.cards) trainerCards[c.id] = (trainerCards[c.id] || 0) + 1;
    }
  }
}

for (let i = 1; i <= numTickets; i++) {
  const tId = ticketId({ seasonId, repoId, prNumber, mergeCommitSha, authorUserId, ticketIndex: i });
  const setId = ticketSet(dk, tId, SETS);
  const cards = rollPack(dk, tId, CARD_POOLS[setId], trSeed, setId);

  // Update running binder
  for (const c of cards) trainerCards[c.id] = (trainerCards[c.id] || 0) + 1;
  const scoreAfter = binderScore(trainerCards, cardRarityMap);

  console.log(`  Ticket ${i}/${numTickets}: 📦 ${setId} (score: ${scoreAfter})`);
  for (const c of cards) console.log(`    ${c.isHolo ? "★" : "·"} ${c.cardId} (${TIER_TO_RARITY[c.tier]})`);

  appendFileSync(ledgerFile, JSON.stringify(ledgerRecord({
    seasonId, ticketId: tId, repoId, prNumber, mergeCommitSha,
    authorUserId, authorLogin, eligible: true, ticketIndex: i, ticketCount: numTickets,
    eventDate, setId,
    cards: cards.map(c => ({ id: c.cardId, tier: c.tier, rarity: TIER_TO_RARITY[c.tier], isHolo: c.isHolo })),
    binderScoreAfter: scoreAfter, dayKeyRef: eventDate, rulesVersion,
  })) + "\n");
}

// ============================================
// Derive leaderboard from full ledger
// ============================================

console.log("\nRebuilding leaderboard...");

const ledgerLines = readFileSync(ledgerFile, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));

const trainers = {};
for (const entry of ledgerLines) {
  if (!entry.author_login) continue;
  const t = trainers[entry.author_login] ||= {
    user_id: entry.author_user_id, cards: {},
    packs_opened: 0, holos_pulled: 0,
    prs_merged: new Set(), tickets_spent: 0,
    sets_completed: 0, last_roll: null, last_score_at: null,
  };
  t.prs_merged.add(`${entry.repo_id}:${entry.pr_number}`);
  t.last_roll = entry.created_at;

  if (entry.eligible && entry.cards?.length > 0) {
    t.tickets_spent++;
    t.packs_opened++;
    for (const c of entry.cards) {
      t.cards[c.id] = (t.cards[c.id] || 0) + 1;
      if (c.isHolo) t.holos_pulled++;
    }
    if (entry.binder_score_after != null) t.last_score_at = entry.created_at;
  }
}

const leaderboard = Object.entries(trainers).map(([login, t]) => {
  const score = binderScore(t.cards, cardRarityMap);

  // Count completed sets
  const setTotals = { base1: 102, base2: 64, base3: 62 };
  let setsCompleted = 0;
  for (const [sid, total] of Object.entries(setTotals)) {
    const owned = Object.keys(t.cards).filter(id => id.startsWith(sid + "-")).length;
    if (owned >= total) setsCompleted++;
  }

  return {
    login, user_id: t.user_id, score,
    unique_cards: Object.keys(t.cards).length,
    total_cards: Object.values(t.cards).reduce((a, b) => a + b, 0),
    packs_opened: t.packs_opened, holos_pulled: t.holos_pulled,
    sets_completed: setsCompleted, tickets_spent: t.tickets_spent,
    prs_merged: t.prs_merged.size, last_roll: t.last_roll,
  };
}).sort((a, b) =>
  // Tiebreakers per spec: score → sets → fewer tickets → earlier
  b.score - a.score
  || b.sets_completed - a.sets_completed
  || a.tickets_spent - b.tickets_spent
  || (a.last_roll || "").localeCompare(b.last_roll || "")
);

writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2) + "\n");

for (let i = 0; i < leaderboard.length; i++) {
  const e = leaderboard[i];
  const medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`;
  console.log(`  ${medal} ${e.login}: score=${e.score}, ${e.unique_cards} unique, ${e.holos_pulled} holos`);
}
