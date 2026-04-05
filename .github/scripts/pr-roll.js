// ============================================
// PR Roll — Central Game Engine
// Receives dispatch events from participating repos.
// Scores work, rolls cards, appends to ledger, derives leaderboard.
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  trainerSeed, ticketId, ticketCount,
  rollPack, ticketEarnsPack, ticketSet, rollSeed,
  ledgerRecord, SCORE_WEIGHTS, TIER_TO_RARITY,
} from "../../season.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LEDGER_DIR = resolve(ROOT, "ledger");
const LEADERBOARD_FILE = resolve(ROOT, "leaderboard.json");

// ============================================
// Card pools — accurate to WotC-era sets
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

// Rarity map from card pools (not from card number heuristics)
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
// Additions/deletions come from the PR event payload — works for private repos
const prAdditions = parseInt(process.env.PR_ADDITIONS || "0", 10);
const prDeletions = parseInt(process.env.PR_DELETIONS || "0", 10);

if (!seasonSecretHex || !seasonSecret) {
  console.log("SEASON_SECRET not set — skipping roll");
  process.exit(0);
}

if (!mergeCommitSha || !authorUserId || !prNumber) {
  console.error("Missing PR metadata");
  process.exit(1);
}

// ============================================
// Season + substance
// ============================================

const manifestPath = resolve(ROOT, "season-manifest.json");
let manifest = { season_id: "2026-q2" };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const seasonId = manifest.season_id;

console.log(`${repoName}#${prNumber} by ${authorLogin} (${authorUserId})`);
console.log(`Merge: ${mergeCommitSha}`);
console.log(`Season: ${seasonId}`);

// Substance from PR-level stats (no private repo API access needed)
const netLoc = prAdditions + prDeletions;
const numTickets = ticketCount({ netReviewedLoc: netLoc });

console.log(`Substance: ${netLoc} LOC → ${numTickets} ticket(s)`);

if (!existsSync(LEDGER_DIR)) mkdirSync(LEDGER_DIR, { recursive: true });
const ledgerFile = resolve(LEDGER_DIR, `${seasonId}.ndjson`);

if (numTickets === 0) {
  console.log("No substance — no tickets");
  appendFileSync(ledgerFile, JSON.stringify(ledgerRecord({
    seasonId, ticketId: "none", repoId, prNumber, mergeCommitSha,
    authorUserId, authorLogin, eligible: false,
    ticketIndex: 0, ticketTotal: 0, cards: [], setId: null, rollCommitment: null,
  })) + "\n");
  process.exit(0);
}

// ============================================
// Mint tickets and roll cards
// ============================================

const trSeed = trainerSeed(seasonId, authorUserId);

for (let i = 0; i < numTickets; i++) {
  const tId = ticketId({ seasonId, repoId, prNumber, mergeCommitSha, authorUserId, ticketIndex: i });
  const earnsPack = ticketEarnsPack(seasonSecret, tId);

  if (!earnsPack) {
    console.log(`  Ticket ${i + 1}/${numTickets}: no pack`);
    appendFileSync(ledgerFile, JSON.stringify(ledgerRecord({
      seasonId, ticketId: tId, repoId, prNumber, mergeCommitSha,
      authorUserId, authorLogin, eligible: true,
      ticketIndex: i, ticketTotal: numTickets, cards: [], setId: null, rollCommitment: null,
    })) + "\n");
    continue;
  }

  const setId = ticketSet(seasonSecret, tId, SETS);
  const cards = rollPack(seasonSecret, tId, CARD_POOLS[setId], trSeed, setId);

  console.log(`  Ticket ${i + 1}/${numTickets}: 📦 ${setId}`);
  for (const c of cards) console.log(`    ${c.isHolo ? "★" : "·"} ${c.cardId} (${c.tier})`);

  appendFileSync(ledgerFile, JSON.stringify(ledgerRecord({
    seasonId, ticketId: tId, repoId, prNumber, mergeCommitSha,
    authorUserId, authorLogin, eligible: true,
    ticketIndex: i, ticketTotal: numTickets,
    cards: cards.map(c => ({ id: c.cardId, tier: c.tier, isHolo: c.isHolo })),
    setId, rollCommitment: rollSeed(seasonSecret, tId).toString("hex").slice(0, 16),
  })) + "\n");
}

// ============================================
// Derive leaderboard from full ledger
// ============================================

console.log("\nRebuilding leaderboard...");

const ledgerLines = existsSync(ledgerFile)
  ? readFileSync(ledgerFile, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l))
  : [];

const trainers = {};
for (const entry of ledgerLines) {
  if (!entry.author_login) continue;
  const t = trainers[entry.author_login] ||= {
    user_id: entry.author_user_id, cards: {},
    packs_opened: 0, holos_pulled: 0,
    prs_merged: new Set(), tickets_earned: 0,
    last_repo: null, last_roll: null,
  };
  t.prs_merged.add(`${entry.repo_id}:${entry.pr_number}`);
  t.last_repo = entry.repo_id;
  t.last_roll = entry.created_at;

  if (entry.eligible && entry.cards?.length > 0) {
    t.tickets_earned++;
    t.packs_opened++;
    for (const c of entry.cards) {
      t.cards[c.id] = (t.cards[c.id] || 0) + 1;
      if (c.isHolo) t.holos_pulled++;
    }
  }
}

const leaderboard = Object.entries(trainers).map(([login, t]) => {
  let score = 0;
  for (const cardId of Object.keys(t.cards)) {
    score += SCORE_WEIGHTS[cardRarityMap[cardId] || "Common"] || 1;
  }
  return {
    login, user_id: t.user_id, score,
    unique_cards: Object.keys(t.cards).length,
    total_cards: Object.values(t.cards).reduce((a, b) => a + b, 0),
    packs_opened: t.packs_opened, holos_pulled: t.holos_pulled,
    prs_merged: t.prs_merged.size, tickets_earned: t.tickets_earned,
    last_roll: t.last_roll,
  };
}).sort((a, b) => b.score - a.score || b.unique_cards - a.unique_cards);

writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2) + "\n");

for (let i = 0; i < leaderboard.length; i++) {
  const e = leaderboard[i];
  const medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`;
  console.log(`  ${medal} ${e.login}: score=${e.score}, ${e.unique_cards} unique, ${e.holos_pulled} holos`);
}
