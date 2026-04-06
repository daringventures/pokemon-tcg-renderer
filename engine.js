// ============================================
// Pokemon TCG — CLI
// Reads from the public ledger. Ranked game only.
// ============================================

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { RESET, BOLD, DIM, YELLOW, GREEN, CYAN, RED, WHITE } from "./constants.js";
import { TYPE_COLOR, RARITY_ICON } from "./constants.js";
import { SCORE_WEIGHTS, SET_BONUS_THRESHOLDS, TIER_TO_RARITY } from "./season.js";

const ROOT = process.cwd();
const LEDGER_DIR = join(ROOT, "ledger");

// ============================================
// Read ledger for a player
// ============================================

function getGitLogin() {
  try { return execSync("gh api user -q .login", { encoding: "utf8" }).trim(); } catch {}
  try { return execSync("git config user.name", { encoding: "utf8" }).trim(); } catch {}
  return null;
}

function loadLedger(seasonId) {
  const f = join(LEDGER_DIR, `${seasonId}.ndjson`);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

function loadLeaderboard() {
  const f = join(ROOT, "leaderboard.json");
  if (!existsSync(f)) return [];
  const lb = JSON.parse(readFileSync(f, "utf8"));
  return Array.isArray(lb) ? lb : [];
}

function playerCards(ledger, login) {
  const cards = {};
  for (const entry of ledger) {
    if (entry.author_login !== login) continue;
    if (!entry.eligible || !entry.cards?.length) continue;
    for (const c of entry.cards) cards[c.id] = (cards[c.id] || 0) + 1;
  }
  return cards;
}

function playerStats(ledger, login) {
  const cards = {};
  let packs = 0, holos = 0, tickets = 0;
  for (const entry of ledger) {
    if (entry.author_login !== login) continue;
    if (!entry.eligible || !entry.cards?.length) continue;
    tickets++;
    packs++;
    for (const c of entry.cards) {
      cards[c.id] = (cards[c.id] || 0) + 1;
      if (c.isHolo) holos++;
    }
  }
  return { cards, packs, holos, tickets, unique: Object.keys(cards).length };
}

function getLevel(unique) {
  return Math.floor((unique / 228) * 100);
}

// ============================================
// Helpers
// ============================================

const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, len) => s + " ".repeat(Math.max(0, len - stripAnsi(s).length));

function cardRarity(cardId) {
  const num = parseInt(cardId.split("-").pop(), 10);
  const set = cardId.replace(/-\d+$/, "");
  // Approximate from set structure
  const holoMax = { base1: 16, base2: 16, base3: 13 }[set] || 16;
  const rareMax = { base1: 22, base2: 32, base3: 29 }[set] || 32;
  const uncommonMax = { base1: 42, base2: 48, base3: 45 }[set] || 48;
  if (num <= holoMax) return "Rare Holo";
  if (num <= rareMax) return "Rare";
  if (num <= uncommonMax) return "Uncommon";
  return "Common";
}

// ============================================
// CLI
// ============================================

const command = process.argv[2];
const seasonId = "2026-q2";

if (command === "status") {
  const login = getGitLogin();
  const lb = loadLeaderboard();
  const me = lb.find(e => e.login === login);

  if (!me) {
    console.log(`🎴 ${DIM}not ranked${RESET}`);
  } else {
    const rank = lb.indexOf(me) + 1;
    const parts = [`🎴 ${DIM}Lv.${RESET}${BOLD}${getLevel(me.unique_cards)}${RESET}  ${DIM}#${rank}${RESET}`];
    if (me.unique_cards > 0) parts.push(`${DIM}${me.unique_cards}/${RESET}228`);
    if (me.holos_pulled > 0) parts.push(`${YELLOW}★${me.holos_pulled}${RESET}`);
    console.log(parts.join(`  ${DIM}┃${RESET}  `));
  }
}

else if (command === "binder") {
  const login = process.argv[3] || getGitLogin();
  if (!login) { console.log(`${DIM}Could not determine login. Pass it as an argument.${RESET}`); process.exit(1); }

  const ledger = loadLedger(seasonId);
  const { cards, packs, holos, unique } = playerStats(ledger, login);
  const level = getLevel(unique);
  const totalCards = Object.values(cards).reduce((a, b) => a + b, 0);

  const SET_INFO = { base1: { name: "Base Set", total: 102 }, base2: { name: "Jungle", total: 64 }, base3: { name: "Fossil", total: 62 } };

  const W = 52;
  const boxRow = s => `│ ${s}${" ".repeat(Math.max(0, W - stripAnsi(s).length - 2))} │`;

  console.log(`╭${"─".repeat(W)}╮`);
  console.log(boxRow(`${BOLD}📖 ${login}${RESET}${" ".repeat(Math.max(1, W - login.length - 22))}${DIM}Lv.${RESET}${BOLD}${level}${RESET}`));
  console.log(boxRow(`${DIM}${unique} unique · ${totalCards} total · ${packs} packs · ${holos} holos${RESET}`));
  console.log(`╰${"─".repeat(W)}╯`);

  const cardsBySet = {};
  for (const id of Object.keys(cards)) { const s = id.replace(/-\d+$/, ""); (cardsBySet[s] ||= []).push(id); }

  for (const [setId, info] of Object.entries(SET_INFO)) {
    const owned = cardsBySet[setId] || [];
    const pct = ((owned.length / info.total) * 100).toFixed(1);

    console.log("");
    console.log(`  ${BOLD}${info.name.toUpperCase()}${RESET}  ${DIM}${"━".repeat(30)}${RESET}  ${owned.length}/${info.total}  ${pct}%`);
    const filled = Math.round((owned.length / info.total) * 40);
    console.log(`  ${GREEN}${"█".repeat(filled)}${RESET}${DIM}${"░".repeat(40 - filled)}${RESET}`);

    if (!owned.length) { console.log(`  ${DIM}  No cards yet${RESET}`); continue; }
    owned.sort((a, b) => parseInt(a.split("-").pop()) - parseInt(b.split("-").pop()));

    for (const cardId of owned) {
      const count = cards[cardId];
      const rarity = cardRarity(cardId);
      const numStr = `#${cardId.split("-").pop()}`.padStart(4);
      const cnt = count > 1 ? `${YELLOW}×${count}${RESET}` : `${DIM}×1${RESET}`;
      const icon = RARITY_ICON[rarity] || `${DIM}·${RESET}`;
      console.log(`  ${icon} ${DIM}${numStr}${RESET}  ${pad(`${cardId}`, 20)} ${pad(`${DIM}${rarity}${RESET}`, 18)} ${cnt}`);
    }
  }
  console.log("");
}

else if (command === "leaderboard") {
  const lb = loadLeaderboard();
  if (!lb.length) { console.log(`${DIM}No leaderboard yet.${RESET}`); process.exit(0); }

  console.log(`╭${"─".repeat(56)}╮`);
  console.log(`│ ${BOLD}🏆 LEADERBOARD${RESET}${" ".repeat(40)} │`);
  console.log(`╰${"─".repeat(56)}╯\n`);

  lb.forEach((e, i) => {
    const medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : `${DIM}${String(i + 1).padStart(2)}${RESET}`;
    console.log(`  ${medal}  ${BOLD}${e.login}${RESET}  ${DIM}score:${RESET}${e.score}  ${DIM}${e.unique_cards}/${RESET}228  ${YELLOW}★${e.holos_pulled}${RESET}`);
  });
  console.log("");
}

else {
  console.log("Usage: engine.js <status|binder [login]|leaderboard>");
}
