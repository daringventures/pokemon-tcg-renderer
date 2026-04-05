// ============================================
// Pack Rip — the trap door
// ============================================

import { renderCard } from "./card-render.js";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import sharp from "sharp";

import { getTrainerSeed, loadStateOrNull, saveState } from "./state.js";
import { fetchSet, bucketCards, rollCardLive } from "./season.js";
import { RESET, BOLD, DIM, YELLOW, CYAN, MAGENTA } from "./constants.js";
import { TYPE_ICON } from "./constants.js";

const ART_CROP = {
  Pokemon:  { left: 0.07, top: 0.12, width: 0.86, height: 0.42 },
  Trainer:  { left: 0.10, top: 0.233, width: 0.805, height: 0.322 },
  Energy:   { left: 0.037, top: 0.147, width: 0.925, height: 0.799 },
};

const EVO_BOX = { left: 0.107, top: 0.116, width: 0.133, height: 0.053 };

// ============================================
// Terminal control — plain stdio
// Launcher uses cmd.exe < CON to give us a real console
// ============================================

const write = (s) => process.stdout.write(s);
const enterAltScreen = () => write("\x1b[?1049h");
const exitAltScreen = () => write("\x1b[?1049l");
const hideCursor = () => write("\x1b[?25l");
const showCursor = () => write("\x1b[?25h");
const clearScreen = () => write("\x1b[2J\x1b[H");
const clearLine = () => write("\x1b[2K\r");
const moveTo = (row, col) => write(`\x1b[${row};${col}H`);
const bell = () => write("\x07");

const fullTTY = process.stdout.isTTY && process.stdin.isTTY && typeof process.stdin.setRawMode === "function";

function typeIcon(types) {
  if (!types || !types.length) return "\u2B50";
  return types.map(t => TYPE_ICON[t] || "\u2B50").join("");
}

// ============================================
// Input
// ============================================

function waitForKey() {
  return new Promise((resolve) => {
    if (!fullTTY) { resolve("next"); return; }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (data[0] === 27 || data[0] === 3) resolve("escape");
      else resolve("next");
    });
  });
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================
// Quantized art renderer — compact enough for Claude Code
// ============================================

function buildPalette(rgbBuf, numPixels, maxColors) {
  const step = Math.max(1, Math.floor(numPixels / 10000));
  const samples = [];
  for (let i = 0; i < numPixels; i += step) {
    const off = i * 3;
    samples.push([rgbBuf[off], rgbBuf[off + 1], rgbBuf[off + 2]]);
  }
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let bestIdx = -1, bestSpan = 0, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const px of boxes[i]) { if (px[ch] < lo) lo = px[ch]; if (px[ch] > hi) hi = px[ch]; }
        if (hi - lo > bestSpan) { bestSpan = hi - lo; bestIdx = i; bestCh = ch; }
      }
    }
    if (bestIdx < 0) break;
    const box = boxes[bestIdx];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bestIdx, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0;
    for (const [pr, pg, pb] of box) { r += pr; g += pg; b += pb; }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function nearestColor(r, g, b, pal) {
  let best = Infinity, idx = 0;
  for (let j = 0; j < pal.length; j++) {
    const d = (r - pal[j][0]) ** 2 + (g - pal[j][1]) ** 2 + (b - pal[j][2]) ** 2;
    if (d < best) { best = d; idx = j; }
  }
  return idx;
}

async function renderCompactCard(card, imageBuffer) {
  const ART_COLS = 44;
  const ART_ROWS = 14;
  const PAL_SIZE = 48;

  // Crop art section from card image (per-type)
  const meta = await sharp(imageBuffer).metadata();
  const crop = ART_CROP[card.supertype] || ART_CROP.Pokemon;

  let srcBuf = imageBuffer;
  const isEvolved = card.subtypes?.includes("Stage 1") || card.subtypes?.includes("Stage 2");
  if (isEvolved) {
    const bx = Math.round(meta.width * EVO_BOX.left);
    const by = Math.round(meta.height * EVO_BOX.top);
    const bw = Math.round(meta.width * EVO_BOX.width);
    const bh = Math.round(meta.height * EVO_BOX.height);
    const stage = card.subtypes.includes("Stage 2") ? "Stage 2" : "Stage 1";
    const overlay = Buffer.from(
      `<svg width="${bw}" height="${bh}">
        <rect width="100%" height="100%" fill="black"/>
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle"
              fill="white" font-family="sans-serif" font-size="${Math.round(bh * 0.5)}px"
              font-weight="bold">${stage}</text>
      </svg>`
    );
    srcBuf = await sharp(imageBuffer)
      .composite([{ input: overlay, left: bx, top: by }])
      .toBuffer();
  }

  const artBuf = await sharp(srcBuf)
    .extract({
      left: Math.round(meta.width * crop.left),
      top: Math.round(meta.height * crop.top),
      width: Math.round(meta.width * crop.width),
      height: Math.round(meta.height * crop.height),
    })
    .toBuffer();

  const pixelH = ART_ROWS * 2;
  const { data } = await sharp(artBuf)
    .resize(ART_COLS, pixelH, { fit: "fill" })
    .flatten({ background: { r: 230, g: 230, b: 230 } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Quantize
  const numPx = ART_COLS * pixelH;
  const pal = buildPalette(data, numPx, PAL_SIZE);
  const lookup = new Map();
  const mapped = new Uint8Array(numPx * 3);
  for (let i = 0; i < numPx; i++) {
    const off = i * 3;
    const key = (data[off] << 16) | (data[off + 1] << 8) | data[off + 2];
    let idx = lookup.get(key);
    if (idx === undefined) { idx = nearestColor(data[off], data[off + 1], data[off + 2], pal); lookup.set(key, idx); }
    mapped[off] = pal[idx][0]; mapped[off + 1] = pal[idx][1]; mapped[off + 2] = pal[idx][2];
  }

  // Render half-block art with state caching
  const artLines = [];
  for (let y = 0; y < pixelH; y += 2) {
    const parts = [];
    let cF = "", cB = "";
    for (let x = 0; x < ART_COLS; x++) {
      const ti = (y * ART_COLS + x) * 3, bi = ((y + 1) * ART_COLS + x) * 3;
      const fg = `38;2;${mapped[ti]};${mapped[ti + 1]};${mapped[ti + 2]}`;
      const bg = `48;2;${mapped[bi]};${mapped[bi + 1]};${mapped[bi + 2]}`;
      if (fg !== cF && bg !== cB) parts.push(`\x1b[${fg};${bg}m`);
      else if (fg !== cF) parts.push(`\x1b[${fg}m`);
      else if (bg !== cB) parts.push(`\x1b[${bg}m`);
      cF = fg; cB = bg;
      parts.push("\u2580");
    }
    parts.push(RESET);
    artLines.push(parts.join(""));
  }

  // Plain text card info
  const types = (card.types || []).map(t => TYPE_ICON[t] || t).join("");
  const hp = card.hp ? `${card.hp} HP` : "";
  const textLines = [];
  textLines.push(`${BOLD}${card.name}${RESET}  ${hp}  ${types}`);
  if (card.evolvesFrom) {
    const stage = card.subtypes?.includes("Stage 2") ? "Stage 2" : card.subtypes?.includes("Stage 1") ? "Stage 1" : "Basic";
    textLines.push(`${DIM}${stage} \u2014 Evolves from ${card.evolvesFrom}${RESET}`);
  }
  for (const atk of card.attacks || []) {
    const cost = (atk.cost || []).map(t => TYPE_ICON[t] || "\u00B7").join("");
    textLines.push(`  ${cost} ${BOLD}${atk.name}${RESET}${atk.damage ? "  " + atk.damage : ""}`);
  }
  const footer = [];
  if (card.weaknesses?.length) footer.push(`weak: ${TYPE_ICON[card.weaknesses[0].type] || card.weaknesses[0].type}${card.weaknesses[0].value}`);
  if (card.resistances?.length) footer.push(`resist: ${TYPE_ICON[card.resistances[0].type] || card.resistances[0].type}${card.resistances[0].value}`);
  if (card.retreatCost?.length) footer.push(`retreat: ${card.retreatCost.length}`);
  if (footer.length) textLines.push(`${DIM}${footer.join("  ")}${RESET}`);
  textLines.push(`${DIM}${card.rarity || ""}  ${card.set?.name || ""}  ${card.number || ""}/${card.set?.printedTotal || ""}${RESET}`);

  return [...artLines, ...textLines].join("\n");
}

// ============================================
// Holo flash
// ============================================

async function flashHolo() {
  for (let i = 0; i < 5; i++) {
    clearLine();
    write(`  \u2728 \x1b[43m\x1b[30m HOLO HIT \x1b[0m \u2728`);
    await sleep(100);
    clearLine();
    write(`  \u2728 \x1b[45m\x1b[97m HOLO HIT \x1b[0m \u2728`);
    await sleep(100);
    clearLine();
    write(`  \u2728 \x1b[46m\x1b[30m HOLO HIT \x1b[0m \u2728`);
    await sleep(100);
  }
  clearLine();
}

// ============================================
// The show
// ============================================

async function rip() {
  const seed = getTrainerSeed();
  const state = loadStateOrNull(seed);

  if (!state || state.packsAvailable < 1) {
    console.log(`\n${DIM}  No packs. Keep coding.${RESET}\n`);
    process.exit(0);
  }

  state.packsAvailable--;

  const setId = pick(["base1", "base2", "base3"]);
  const setNames = { base1: "Base Set", base2: "Jungle", base3: "Fossil" };
  const setName = setNames[setId];

  write(`\n${DIM}  Loading ${setName}...${RESET}`);

  const allCards = await fetchSet(setId);
  const pool = bucketCards(allCards);

  const rolls = [rollCardLive(pool, seed, setId), rollCardLive(pool, seed, setId), rollCardLive(pool, seed, setId)];

  const isHolo = rolls.some(r => r.isHolo);
  const best = rolls.findLast(r => r.isHolo) || rolls.findLast(r => {
    const rar = (r.card.rarity || "").toLowerCase();
    return rar === "rare" || rar === "rare holo";
  }) || rolls[2];
  const rare = best.card;
  const bulk = rolls.slice(0, 2).map(r => r.card);
  const allPulled = rolls.map(r => r.card);

  const rareRes = await fetch(`https://api.pokemontcg.io/v2/cards/${rare.id}`);
  const { data: fullRare } = await rareRes.json();

  // Fetch card image for rendering
  const imgUrl = fullRare.images?.large || fullRare.images?.small;
  const imgRes2 = await fetch(imgUrl);
  const imgBuf = Buffer.from(await imgRes2.arrayBuffer());

  if (fullTTY) {
    const cardFrame = await renderCard(fullRare);
    // === INTERACTIVE — alt-screen, keypresses ===
    enterAltScreen();
    hideCursor();

    try {
      clearScreen();
      moveTo(2, 3);
      write(`${YELLOW}${BOLD}\u{1F4E6}  ${setName}${RESET}`);
      moveTo(4, 3);
      write(`${DIM}press any key${RESET}`);

      await waitForKey();

      clearScreen();
      moveTo(2, 3);
      write(`${YELLOW}${BOLD}\u{1F4E6}  ${setName}${RESET}`);

      let row = 4;
      for (const card of bulk) {
        moveTo(row, 3);
        write(`${DIM}\u{1F4A8} ${card.name}${RESET}`);
        await sleep(140 + Math.random() * 80);
        row++;
      }

      moveTo(row + 1, 3);
      write(`${DIM}press any key for the rare...${RESET}`);

      await waitForKey();

      clearScreen();

      if (isHolo) {
        bell();
        moveTo(2, 1);
        await flashHolo();
        await sleep(300);
        clearScreen();
      }

      moveTo(1, 1);
      write(cardFrame);

      const cardRows = cardFrame.split("\n").length;
      moveTo(cardRows + 2, 3);
      if (isHolo) {
        write(`${MAGENTA}${BOLD}\u{1F48E} ${fullRare.name}${RESET}`);
      } else if (Number(fullRare.hp || 0) <= 60) {
        write(`\u{1F5D1}\uFE0F  ${fullRare.name}`);
      } else {
        write(`${CYAN}\u{1F52E} ${fullRare.name}${RESET}`);
      }

      moveTo(cardRows + 4, 3);
      write(`${DIM}press any key${RESET}`);

      await waitForKey();

    } finally {
      showCursor();
      exitAltScreen();
    }
  } else {
    // === STATIC FALLBACK — full ASCII card frame with braille art box ===
    const INNER_W = 48;
    const ART_W = 44;

    // Type-colored card border
    const TYPE_COLOR = {
      Fire: "\x1b[38;2;230;60;20m",
      Water: "\x1b[38;2;40;120;220m",
      Grass: "\x1b[38;2;50;160;50m",
      Lightning: "\x1b[38;2;240;200;0m",
      Psychic: "\x1b[38;2;160;60;180m",
      Fighting: "\x1b[38;2;180;100;40m",
      Colorless: "\x1b[38;2;180;180;180m",
      Darkness: "\x1b[38;2;80;60;100m",
      Metal: "\x1b[38;2;140;150;160m",
      Dragon: "\x1b[38;2;120;80;40m",
    };
    const cardType = (fullRare.types || ["Colorless"])[0];
    const borderColor = TYPE_COLOR[cardType] || TYPE_COLOR.Colorless;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    // Count visible width accounting for double-width emoji
    const visWidth = (s) => {
      const plain = stripAnsi(s);
      let w = 0;
      for (const ch of plain) {
        const cp = ch.codePointAt(0);
        // Only actual emoji that render double-width (supplementary plane)
        // 🔥💧🌿👊🔮🌑🐉 etc are all > 0x1F000
        if (cp > 0x1F000) {
          w += 2;
        } else {
          w += 1;
        }
      }
      return w;
    };
    const truncate = (s, n) => s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
    const BC = borderColor; // shorthand
    const COL = INNER_W + 4; // right border column (│ + space + 48 inner + space + │)
    const cardLine = (content) => {
      return `${BC}\u2502${RESET} ${content}\x1b[${COL}G${BC}\u2502${RESET}`;
    };
    const topBorder = () => `${BC}\u256D${"\u2500".repeat(INNER_W + 2)}\u256E${RESET}`;
    const bottomBorder = () => `${BC}\u2570${"\u2500".repeat(INNER_W + 2)}\u256F${RESET}`;
    const dividerLine = () => `${BC}\u251C${"\u2500".repeat(INNER_W + 2)}\u2524${RESET}`;
    const side = Math.floor((INNER_W - ART_W) / 2);
    const artTop = () => `${BC}\u2502${" ".repeat(side)}\u256D${"\u2500".repeat(ART_W)}\u256E${" ".repeat(INNER_W - ART_W - side)}\u2502${RESET}`;
    const artBot = () => `${BC}\u2502${" ".repeat(side)}\u2570${"\u2500".repeat(ART_W)}\u256F${" ".repeat(INNER_W - ART_W - side)}\u2502${RESET}`;
    const artLine = (text) => {
      const padR = INNER_W - ART_W - side;
      return `${BC}\u2502${" ".repeat(side)}\u2502${RESET}${text}${RESET}${BC}\u2502${" ".repeat(padR)}\u2502${RESET}`;
    };

    // Header
    const name = truncate(fullRare.name, 28);
    const hp = fullRare.hp ? `${fullRare.hp} HP` : "";
    const type = (fullRare.types || []).map(t => TYPE_ICON[t] || t).join("");
    const right = `${hp} ${type}`.trim();
    const gap = INNER_W - name.length - visWidth(right);
    const header = `${BOLD}${name}${RESET}${" ".repeat(Math.max(1, gap))}${right}`;

    // Subline
    const isTrainer = fullRare.supertype === "Trainer";
    const isEnergy = fullRare.supertype === "Energy";
    let subline;
    if (isTrainer) {
      subline = `${DIM}Trainer${RESET}`;
    } else if (isEnergy) {
      subline = `${DIM}Energy${RESET}`;
    } else if (fullRare.evolvesFrom) {
      const stage = fullRare.subtypes?.includes("Stage 2") ? "Stage 2" : fullRare.subtypes?.includes("Stage 1") ? "Stage 1" : "Basic";
      subline = `${DIM}${stage} \u2014 Evolves from ${fullRare.evolvesFrom}${RESET}`;
    } else {
      subline = `${DIM}${fullRare.subtypes?.join(" ") || "Basic"}${RESET}`;
    }

    // Crop art + render braille (per-type, evo box overlay)
    const imgMeta = await sharp(imgBuf).metadata();
    const artCrop = ART_CROP[fullRare.supertype] || ART_CROP.Pokemon;
    let artSrc = imgBuf;
    const isEvo = fullRare.subtypes?.includes("Stage 1") || fullRare.subtypes?.includes("Stage 2");
    if (isEvo) {
      const bx = Math.round(imgMeta.width * EVO_BOX.left);
      const by = Math.round(imgMeta.height * EVO_BOX.top);
      const bw = Math.round(imgMeta.width * EVO_BOX.width);
      const bh = Math.round(imgMeta.height * EVO_BOX.height);
      const stage = fullRare.subtypes.includes("Stage 2") ? "Stage 2" : "Stage 1";
      const overlay = Buffer.from(
        `<svg width="${bw}" height="${bh}">
          <rect width="100%" height="100%" fill="black"/>
          <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle"
                fill="white" font-family="sans-serif" font-size="${Math.round(bh * 0.5)}px"
                font-weight="bold">${stage}</text>
        </svg>`
      );
      artSrc = await sharp(imgBuf)
        .composite([{ input: overlay, left: bx, top: by }])
        .toBuffer();
    }
    const artTmpPath = join(process.env.HOME || process.env.USERPROFILE, ".claude", "pokemon-art-tmp.png");
    try { writeFileSync(artTmpPath, ""); } catch {} // clear stale file
    await sharp(artSrc)
      .extract({
        left: Math.round(imgMeta.width * artCrop.left),
        top: Math.round(imgMeta.height * artCrop.top),
        width: Math.round(imgMeta.width * artCrop.width),
        height: Math.round(imgMeta.height * artCrop.height),
      })
      .sharpen({ sigma: 1.2 })
      .modulate({ saturation: 1.3, brightness: 1.1 })
      .toFile(artTmpPath);

    const aicPath = join(process.env.HOME || process.env.USERPROFILE, "Downloads", "ascii-image-converter", "ascii-image-converter_Windows_amd64_64bit", "ascii-image-converter.exe");
    let brailleLines = [];
    try {
      const out = execSync(`"${aicPath}" "${artTmpPath}" -C -d ${ART_W},15 --braille`, { encoding: "utf8" });
      brailleLines = out.split("\n").filter(l => l.length > 0);
    } catch {}

    // Word wrap helper
    const wordWrap = (text, maxLen) => {
      const words = text.split(/\s+/);
      const lines = [];
      let cur = "";
      for (const w of words) {
        if (cur.length + w.length + 1 > maxLen) { lines.push(cur); cur = w; }
        else { cur = cur ? cur + " " + w : w; }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    // Abilities / Pokemon Powers
    const abilityLines = [];
    for (const ab of fullRare.abilities || []) {
      abilityLines.push(`${MAGENTA}${BOLD}${ab.type || "Ability"}: ${ab.name}${RESET}`);
      if (ab.text) {
        for (const wl of wordWrap(ab.text, INNER_W - 2)) {
          abilityLines.push(`${DIM}  ${wl}${RESET}`);
        }
      }
    }

    // Attacks with descriptions
    const atkLines = [];
    for (const atk of fullRare.attacks || []) {
      const cost = (atk.cost || []).map(t => TYPE_ICON[t] || "\u00B7").join("");
      const dmg = atk.damage || "";
      const costW = visWidth(cost);
      const atkName = truncate(atk.name, INNER_W - costW - dmg.length - 4);
      const atkGap = INNER_W - costW - atkName.length - dmg.length - 2;
      atkLines.push(`${cost} ${atkName}${" ".repeat(Math.max(1, atkGap))}${dmg}`);
      if (atk.text) {
        for (const wl of wordWrap(atk.text, INNER_W - 2)) {
          atkLines.push(`${DIM}  ${wl}${RESET}`);
        }
      }
    }

    // Weakness / Resistance / Retreat
    const footerParts = [];
    if (fullRare.weaknesses?.length) { const w = fullRare.weaknesses[0]; footerParts.push(`weak: ${TYPE_ICON[w.type] || w.type}${w.value}`); }
    if (fullRare.resistances?.length) { const r = fullRare.resistances[0]; footerParts.push(`resist: ${TYPE_ICON[r.type] || r.type}${r.value}`); }
    if (fullRare.retreatCost?.length) footerParts.push(`retreat: ${fullRare.retreatCost.length}`);

    // Rarity icon
    const rarityStr = fullRare.rarity || "";
    const rarityIcon = rarityStr === "Rare Holo" ? "\u2605 Rare Holo" : rarityStr === "Rare" ? "\u2605 Rare" : rarityStr === "Uncommon" ? "\u25C6 Uncommon" : rarityStr === "Common" ? "\u25CF Common" : rarityStr;

    // Holo banner
    if (isHolo) {
      write(`\n\u2728 \x1b[45m\x1b[97m HOLO \x1b[0m \u2728\n`);
    }

    // === RENDER THE CARD ===
    write(`\n`);
    write(topBorder() + "\n");
    write(cardLine(header) + "\n");
    write(cardLine(subline) + "\n");
    write(artTop() + "\n");
    for (const bl of brailleLines) {
      write(artLine(bl) + "\n");
    }
    write(artBot() + "\n");
    if (abilityLines.length) {
      write(dividerLine() + "\n");
      for (const al of abilityLines) write(cardLine(al) + "\n");
    }
    if (atkLines.length) {
      write(dividerLine() + "\n");
      for (const al of atkLines) write(cardLine(al) + "\n");
    }
    // Trainer/Energy card rules
    if (fullRare.rules?.length) {
      write(dividerLine() + "\n");
      for (const rule of fullRare.rules) {
        for (const wl of wordWrap(rule, INNER_W - 2)) {
          write(cardLine(`${DIM}${wl}${RESET}`) + "\n");
        }
      }
    }
    if (fullRare.flavorText) {
      write(cardLine("") + "\n");
      for (const wl of wordWrap(fullRare.flavorText, INNER_W - 4)) {
        write(cardLine(`${DIM}"${wl}"${RESET}`) + "\n");
      }
    }
    write(dividerLine() + "\n");
    if (footerParts.length) write(cardLine(footerParts.join("  ")) + "\n");
    write(cardLine(`${DIM}${rarityIcon}  ${fullRare.set?.name || ""}  ${fullRare.number || ""}/${fullRare.set?.printedTotal || ""}${RESET}`) + "\n");
    if (fullRare.artist) {
      write(cardLine(`${DIM}Illus. ${fullRare.artist}${RESET}`) + "\n");
    }
    write(bottomBorder() + "\n");
  }

  // === UPDATE COLLECTION ===
  const totals = { base1: 102, base2: 64, base3: 62 };
  state.packsOpened++;
  if (isHolo) state.holosPulled++;

  if (!state.setProgress[setId]) {
    state.setProgress[setId] = { owned: [], total: totals[setId] || 100 };
  }

  if (!state.cardMeta) state.cardMeta = {};
  if (!state.recentCards) state.recentCards = [];
  for (const card of allPulled) {
    state.cards[card.id] = (state.cards[card.id] || 0) + 1;
    if (!state.cardMeta[card.id]) {
      state.cardMeta[card.id] = { name: card.name, rarity: card.rarity, supertype: card.supertype, types: card.types, hp: card.hp };
    }
    if (!state.setProgress[setId].owned.includes(card.id)) state.setProgress[setId].owned.push(card.id);
    state.recentCards.push(card.id);
    if (state.recentCards.length > 10) state.recentCards.shift();
  }

  saveState(state, seed);
}

function cleanup() {
  try { if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
  showCursor();
  exitAltScreen();
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("uncaughtException", (e) => { cleanup(); console.error(e); process.exit(1); });

rip();
