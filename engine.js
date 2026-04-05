// ============================================
// Pokemon TCG Status Line Game Engine
// Streak + variety rewards, 3-card packs
// ============================================

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getTrainerSeed, loadState, saveState } from "./state.js";
import { fetchSet, bucketCards, rollCardLive } from "./season.js";
import { RESET, BOLD, DIM, YELLOW, GREEN, CYAN, MAGENTA, RED, WHITE } from "./constants.js";
import { TYPE_COLOR, RARITY_ICON } from "./constants.js";

const PACK_COST = 1000;

// ============================================
// Points Engine — streak bonus only
// ============================================

function today() {
  return new Date().toISOString().slice(0, 10);
}

function updateStreak(state) {
  const d = today();
  if (state.lastActiveDate === d) return;
  if (state.lastActiveDate) {
    const diffDays = Math.round((new Date(d) - new Date(state.lastActiveDate)) / 86400000);
    state.streakDays = diffDays === 1 ? state.streakDays + 1 : 1;
  } else {
    state.streakDays = 1;
  }
  state.lastActiveDate = d;
  if (state.streakDays > (state.bestStreak || 0)) state.bestStreak = state.streakDays;
}

function streakMultiplier(days) {
  if (days <= 1) return 1.0;
  if (days <= 3) return 1.2;
  if (days <= 6) return 1.5;
  return 2.0;
}

function earnPoints(state, contextTokens, isToolUse) {
  updateStreak(state);

  const earned = Math.round(
    (isToolUse ? 5 : 10) *
    Math.max(1, contextTokens / 10000) *
    streakMultiplier(state.streakDays)
  );
  state.points += earned;
  state.totalPointsEarned += earned;

  while (state.points >= PACK_COST) { state.points -= PACK_COST; state.packsAvailable++; }
  if (isToolUse) state.toolCount++; else state.messageCount++;

  return earned;
}

// ============================================
// Helpers
// ============================================

function getLevel(state) {
  let owned = 0;
  for (const id of ["base1", "base2", "base3"]) {
    owned += state.setProgress[id]?.owned?.length || 0;
  }
  return Math.floor((owned / 228) * 100);
}

function renderStatusLine(state) {
  const pct = Math.floor((state.points / PACK_COST) * 100);
  const parts = [`🎴 ${DIM}Lv.${RESET}${BOLD}${getLevel(state)}${RESET}  ${DIM}${pct}%${RESET}`];
  if (state.streakDays > 1) parts.push(`${GREEN}🔥${state.streakDays}${RESET}`);
  if (state.packsAvailable > 0) parts.push(`${YELLOW}${BOLD}📦 ${state.packsAvailable}${RESET}`);
  return parts.join(`  ${DIM}┃${RESET}  `);
}

function addCardsToState(state, cards, setId, isHolo) {
  state.packsOpened++;
  if (isHolo) state.holosPulled++;
  if (!state.setProgress[setId]) {
    state.setProgress[setId] = { owned: [], total: { base1: 102, base2: 64, base3: 62 }[setId] || 100 };
  }
  if (!state.cardMeta) state.cardMeta = {};
  if (!state.recentCards) state.recentCards = [];

  for (const card of cards) {
    state.cards[card.id] = (state.cards[card.id] || 0) + 1;
    if (!state.cardMeta[card.id]) {
      state.cardMeta[card.id] = { name: card.name, rarity: card.rarity, supertype: card.supertype, types: card.types, hp: card.hp };
    }
    if (!state.setProgress[setId].owned.includes(card.id)) state.setProgress[setId].owned.push(card.id);
    state.recentCards.push(card.id);
    if (state.recentCards.length > 10) state.recentCards.shift();
  }
}

const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, len) => s + " ".repeat(Math.max(0, len - stripAnsi(s).length));

// ============================================
// CLI
// ============================================

const command = process.argv[2];
const seed = getTrainerSeed();

if (command === "status") {
  console.log(renderStatusLine(loadState(seed)));
}

else if (command === "tick") {
  const contextTokens = parseInt(process.argv[3] || "10000", 10);
  const isToolUse = process.argv[4] === "tool";
  const state = loadState(seed);
  earnPoints(state, contextTokens, isToolUse);
  saveState(state, seed);
  console.log(renderStatusLine(state));
}

else if (command === "tick-status") {
  let contextTokens = 10000;
  try { const s = JSON.parse(readFileSync(0, "utf8")); contextTokens = s.token_count || s.context_tokens || s.totalTokens || 10000; } catch {}
  const state = loadState(seed);
  earnPoints(state, contextTokens, false);
  saveState(state, seed);
  console.log(renderStatusLine(state));
}

else if (command === "packs") {
  console.log(loadState(seed).packsAvailable);
}

else if (command === "use-pack") {
  const state = loadState(seed);
  if (state.packsAvailable > 0) { state.packsAvailable--; saveState(state, seed); console.log("OK"); }
  else console.log("NO_PACKS");
}

else if (command === "add-cards") {
  const { cards: newCards, setId, isHolo } = JSON.parse(readFileSync(0, "utf8"));
  const state = loadState(seed);
  addCardsToState(state, newCards, setId, isHolo);
  saveState(state, seed);
  console.log("OK");
}

else if (command === "open-pack") {
  const setIds = ["base1", "base2", "base3"];
  const setId = setIds[Math.floor(Math.random() * setIds.length)];
  const setNames = { base1: "Base Set", base2: "Jungle", base3: "Fossil" };
  const pool = bucketCards(await fetchSet(setId));

  const rolls = [rollCardLive(pool, seed, setId), rollCardLive(pool, seed, setId), rollCardLive(pool, seed, setId)];
  const isHolo = rolls.some(r => r.isHolo);
  const best = rolls.findLast(r => r.isHolo) || rolls.findLast(r => ["rare", "rare holo"].includes((r.card?.rarity || "").toLowerCase())) || rolls[2];

  console.log(JSON.stringify({
    setId, setName: setNames[setId],
    cards: rolls.map(r => r.card).map(c => ({ id: c.id, name: c.name, rarity: c.rarity, supertype: c.supertype, types: c.types, hp: c.hp })),
    rare: { id: best.card.id, name: best.card.name, rarity: best.card.rarity, types: best.card.types, hp: best.card.hp },
    isHolo,
  }));
}

else if (command === "backfill-meta") {
  const state = loadState(seed);
  if (!state.cardMeta) state.cardMeta = {};
  const missing = Object.keys(state.cards).filter(id => !state.cardMeta[id]);
  if (!missing.length) { console.log("All cards already have metadata."); process.exit(0); }
  console.log(`Fetching metadata for ${missing.length} cards...`);
  const bySet = {};
  for (const id of missing) { const s = id.replace(/-\d+$/, ""); (bySet[s] ||= []).push(id); }
  for (const [setId, ids] of Object.entries(bySet)) {
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${setId}&pageSize=250&select=id,name,rarity,supertype,types,hp`);
    const data = await res.json();
    for (const c of data.data) if (ids.includes(c.id)) state.cardMeta[c.id] = { name: c.name, rarity: c.rarity, supertype: c.supertype, types: c.types, hp: c.hp };
    console.log(`  ${setId}: ${ids.length} cards`);
  }
  saveState(state, seed);
  console.log("Done.");
}

else if (command === "binder") {
  const state = loadState(seed);
  const meta = state.cardMeta || {};
  const SET_INFO = { base1: { name: "Base Set", total: 102 }, base2: { name: "Jungle", total: 64 }, base3: { name: "Fossil", total: 62 } };

  const totalUnique = Object.keys(state.cards).length;
  const totalCards = Object.values(state.cards).reduce((a, b) => a + b, 0);
  const level = getLevel(state);

  const W = 52;
  const boxRow = s => `│ ${s}${" ".repeat(Math.max(0, W - stripAnsi(s).length - 2))} │`;

  console.log(`╭${"─".repeat(W)}╮`);
  console.log(boxRow(`${BOLD}📖 CARD BINDER${RESET}${" ".repeat(W - 28)}${DIM}Lv.${RESET}${BOLD}${level}${RESET}`));
  console.log(boxRow(`${DIM}${totalUnique} unique · ${totalCards} total · ${state.packsOpened} packs · ${state.holosPulled} holos${RESET}`));
  console.log(`╰${"─".repeat(W)}╯`);

  // Group cards by set
  const cardsBySet = {};
  for (const id of Object.keys(state.cards)) { const s = id.replace(/-\d+$/, ""); (cardsBySet[s] ||= []).push(id); }

  for (const [setId, info] of Object.entries(SET_INFO)) {
    const owned = cardsBySet[setId] || [];
    const ownedCount = state.setProgress[setId]?.owned?.length || owned.length;
    const pct = ((ownedCount / info.total) * 100).toFixed(1);

    console.log("");
    console.log(`  ${BOLD}${info.name.toUpperCase()}${RESET}  ${DIM}${"━".repeat(30)}${RESET}  ${ownedCount}/${info.total}  ${pct}%`);
    const filled = Math.round((ownedCount / info.total) * 40);
    console.log(`  ${GREEN}${"█".repeat(filled)}${RESET}${DIM}${"░".repeat(40 - filled)}${RESET}`);

    if (!owned.length) { console.log(`  ${DIM}  No cards yet${RESET}`); continue; }
    owned.sort((a, b) => parseInt(a.split("-").pop()) - parseInt(b.split("-").pop()));

    for (const cardId of owned) {
      const count = state.cards[cardId];
      const m = meta[cardId];
      const numStr = `#${cardId.split("-").pop()}`.padStart(4);
      const cnt = count > 1 ? `${YELLOW}×${count}${RESET}` : `${DIM}×1${RESET}`;
      if (m) {
        const icon = RARITY_ICON[m.rarity] || `${DIM}·${RESET}`;
        const clr = TYPE_COLOR[(m.types || [])[0]] || "";
        console.log(`  ${icon} ${DIM}${numStr}${RESET}  ${pad(`${clr}${m.name}${RESET}`, 28)} ${pad(`${DIM}${m.rarity || ""}${RESET}`, 18)} ${cnt}`);
      } else {
        console.log(`  ${DIM}· ${numStr}  ${cardId}${"".padEnd(30 - cardId.length)}${RESET} ${cnt}`);
      }
    }
  }

  // Special cards
  const specialCards = Object.keys(cardsBySet).filter(s => !SET_INFO[s]).flatMap(s => cardsBySet[s]);
  if (specialCards.length) {
    specialCards.sort((a, b) => (meta[a]?.name || a).localeCompare(meta[b]?.name || b));
    console.log("");
    console.log(`  ${BOLD}${YELLOW}✨ SPECIAL${RESET}  ${DIM}${"━".repeat(30)}${RESET}  ${specialCards.length} card${specialCards.length === 1 ? "" : "s"}`);
    for (const cardId of specialCards) {
      const count = state.cards[cardId];
      const m = meta[cardId];
      const cnt = count > 1 ? `${YELLOW}×${count}${RESET}` : `${DIM}×1${RESET}`;
      const icon = m ? (RARITY_ICON[m.rarity] || `${YELLOW}✦${RESET}`) : `${YELLOW}✦${RESET}`;
      const name = m ? pad(`${TYPE_COLOR[(m.types || [])[0]] || ""}${m.name}${RESET}`, 28) : cardId.padEnd(28);
      console.log(`  ${icon}  ${name} ${cnt}`);
    }
  }
  console.log("");
}

else if (command === "leaderboard") {
  const lbPath = join(process.cwd(), "leaderboard.json");
  if (!existsSync(lbPath)) { console.log(`${DIM}No leaderboard.json found.${RESET}`); process.exit(0); }

  const lb = JSON.parse(readFileSync(lbPath, "utf8"));
  const entries = Array.isArray(lb) ? lb : Object.entries(lb).map(([k, v]) => ({ login: k, ...v }));
  entries.sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`╭${"─".repeat(56)}╮`);
  console.log(`│ ${BOLD}🏆 LEADERBOARD${RESET}${" ".repeat(40)} │`);
  console.log(`╰${"─".repeat(56)}╯\n`);

  entries.forEach((e, i) => {
    const medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : `${DIM}${String(i + 1).padStart(2)}${RESET}`;
    console.log(`  ${medal}  ${BOLD}${e.login}${RESET}`);
    console.log(`      ${e.unique_cards || 0} unique  ${DIM}·${RESET}  ${e.packs_opened || 0} packs  ${DIM}·${RESET}  ${YELLOW}${e.holos_pulled || 0}${RESET} holos`);
    console.log("");
  });
}

else if (command === "state-dump") {
  console.log(JSON.stringify(loadState(seed), null, 2));
}

else {
  console.log("Usage: engine.js <status|tick|binder|leaderboard|packs|use-pack|add-cards|open-pack|backfill-meta|state-dump>");
}
