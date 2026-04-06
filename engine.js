// ============================================
// Pokemon TCG — CLI
// Works from any directory. Fetches from the game repo.
// The game is ripping packs. GitHub keeps it fair.
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { RESET, BOLD, DIM, YELLOW, GREEN, CYAN, RED, WHITE } from "./constants.js";
import { TYPE_COLOR, RARITY_ICON } from "./constants.js";

const GAME_REPO = "daringventures/pokemon-tcg-renderer";
const SEASON = "2026-q2";
const LOCAL_DIR = join(process.env.HOME || process.env.USERPROFILE, ".pokemon-tcg");
const RIPPED_FILE = join(LOCAL_DIR, "last-ripped");

// ============================================
// GitHub data fetching
// ============================================

function fetchRaw(path) {
  try {
    return execSync(
      `curl -sf "https://raw.githubusercontent.com/${GAME_REPO}/main/${path}"`,
      { encoding: "utf8" }
    );
  } catch { return null; }
}

function getLogin() {
  try { return execSync("gh api user -q .login", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch {}
  try { return execSync("git config user.name", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch {}
  return null;
}

function fetchLedger() {
  const raw = fetchRaw(`ledger/${SEASON}.ndjson`);
  if (!raw) return [];
  return raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

function fetchLeaderboard() {
  const raw = fetchRaw("leaderboard.json");
  if (!raw) return [];
  return JSON.parse(raw);
}

// ============================================
// Player state from ledger
// ============================================

function playerEntries(ledger, login) {
  return ledger.filter(e => e.author_login === login && e.eligible && e.cards?.length > 0);
}

function playerCards(entries) {
  const cards = {};
  let holos = 0;
  for (const entry of entries) {
    for (const c of entry.cards) {
      cards[c.id] = (cards[c.id] || 0) + 1;
      if (c.isHolo) holos++;
    }
  }
  return { cards, holos, unique: Object.keys(cards).length, packs: entries.length };
}

function unrippedEntries(entries) {
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
  const lastRipped = existsSync(RIPPED_FILE) ? readFileSync(RIPPED_FILE, "utf8").trim() : "";
  if (!lastRipped) return entries;
  return entries.filter(e => e.created_at > lastRipped);
}

function markRipped(entries) {
  if (!entries.length) return;
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
  const latest = entries.reduce((a, b) => a.created_at > b.created_at ? a : b);
  writeFileSync(RIPPED_FILE, latest.created_at);
}

function getLevel(unique) {
  return Math.floor((unique / 228) * 100);
}

function cardRarity(cardId) {
  const num = parseInt(cardId.split("-").pop(), 10);
  const set = cardId.replace(/-\d+$/, "");
  const holoMax = { base1: 16, base2: 16, base3: 13 }[set] || 16;
  const rareMax = { base1: 22, base2: 32, base3: 29 }[set] || 32;
  const uncommonMax = { base1: 42, base2: 48, base3: 45 }[set] || 48;
  if (num <= holoMax) return "Rare Holo";
  if (num <= rareMax) return "Rare";
  if (num <= uncommonMax) return "Uncommon";
  return "Common";
}

// ============================================
// Helpers
// ============================================

const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, len) => s + " ".repeat(Math.max(0, len - stripAnsi(s).length));

// ============================================
// CLI
// ============================================

const command = process.argv[2];

if (command === "status") {
  const login = getLogin();
  const lb = fetchLeaderboard();
  const me = lb.find(e => e.login === login);

  if (!me) {
    // Check for unripped packs even if not on leaderboard yet
    const ledger = fetchLedger();
    const entries = login ? playerEntries(ledger, login) : [];
    const unripped = unrippedEntries(entries);
    if (unripped.length > 0) {
      console.log(`🎴 ${YELLOW}${BOLD}📦 ${unripped.length} pack${unripped.length > 1 ? "s" : ""}${RESET}`);
    } else {
      console.log(`🎴 ${DIM}merge PRs to earn packs${RESET}`);
    }
  } else {
    const rank = lb.indexOf(me) + 1;
    const ledger = fetchLedger();
    const entries = playerEntries(ledger, login);
    const unripped = unrippedEntries(entries);

    const parts = [`🎴 ${DIM}Lv.${RESET}${BOLD}${getLevel(me.unique_cards)}${RESET}  ${DIM}#${rank}${RESET}`];
    if (unripped.length > 0) parts.push(`${YELLOW}${BOLD}📦 ${unripped.length}${RESET}`);
    if (me.holos_pulled > 0) parts.push(`${YELLOW}★${me.holos_pulled}${RESET}`);
    console.log(parts.join(`  ${DIM}┃${RESET}  `));
  }
}

else if (command === "rip") {
  const login = getLogin();
  if (!login) { console.error("Could not determine GitHub login"); process.exit(1); }

  const ledger = fetchLedger();
  const entries = playerEntries(ledger, login);
  const unripped = unrippedEntries(entries);

  if (unripped.length === 0) {
    console.log(`\n${DIM}  No packs to rip. Merge PRs to earn more.${RESET}\n`);
    process.exit(0);
  }

  console.log(`\n${BOLD}  ${unripped.length} pack${unripped.length > 1 ? "s" : ""} to rip!${RESET}\n`);

  for (const entry of unripped) {
    const setNames = { base1: "Base Set", base2: "Jungle", base3: "Fossil" };
    const setName = setNames[entry.set_id] || entry.set_id;

    console.log(`  ${DIM}${entry.repo_id}#${entry.pr_number}${RESET}  ${BOLD}${setName}${RESET}`);

    for (const c of entry.cards) {
      const rarity = c.rarity || cardRarity(c.id);
      const icon = RARITY_ICON[rarity] || `${DIM}·${RESET}`;
      const isHolo = c.isHolo ? ` ${YELLOW}${BOLD}HOLO${RESET}` : "";
      console.log(`    ${icon}  ${c.id}  ${DIM}${rarity}${RESET}${isHolo}`);
    }
    console.log("");
  }

  markRipped(unripped);
  console.log(`${DIM}  ${unripped.length} pack${unripped.length > 1 ? "s" : ""} ripped. Run 'binder' to see your collection.${RESET}\n`);
}

else if (command === "binder") {
  const login = process.argv[3] || getLogin();
  if (!login) { console.error("Pass a GitHub login as argument"); process.exit(1); }

  const ledger = fetchLedger();
  const entries = playerEntries(ledger, login);
  const { cards, holos, unique, packs } = playerCards(entries);
  const totalCards = Object.values(cards).reduce((a, b) => a + b, 0);
  const level = getLevel(unique);

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
      console.log(`  ${icon} ${DIM}${numStr}${RESET}  ${pad(cardId, 20)} ${pad(`${DIM}${rarity}${RESET}`, 18)} ${cnt}`);
    }
  }
  console.log("");
}

else if (command === "leaderboard") {
  const lb = fetchLeaderboard();
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
  console.log("Usage: engine.js <status|rip|binder [login]|leaderboard>");
}
