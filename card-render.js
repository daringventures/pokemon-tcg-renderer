// ============================================
// Pokemon TCG Card Renderer
// Sixel (primary) + half-block (fallback) rendering
// Requires: sharp
// ============================================

import sharp from "sharp";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const INNER_W = 48;
const ART_W = 44;
const ART_H = 18;

const ART_CROP = {
  Pokemon:  { left: 0.07, top: 0.12, width: 0.86, height: 0.42 },
  Trainer:  { left: 0.10, top: 0.233, width: 0.805, height: 0.322 },
  Energy:   { left: 0.037, top: 0.147, width: 0.925, height: 0.799 },
};

// Evolution thumbnail box (relative to full card image)
const EVO_BOX = { left: 0.107, top: 0.116, width: 0.133, height: 0.053 };

const TYPE_ICON = {
  Fire: "\u{1F525}",
  Water: "\u{1F4A7}",
  Grass: "\u{1F33F}",
  Lightning: "\u26A1",
  Psychic: "\u{1F52E}",
  Fighting: "\u{1F44A}",
  Colorless: "\u2B50",
  Darkness: "\u{1F311}",
  Metal: "\u2699\uFE0F",
  Dragon: "\u{1F409}",
};

// ============================================
// Image fetch
// ============================================

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ============================================
// Color Quantization (Median Cut)
// ============================================

function buildPalette(rgbBuf, numPixels, maxColors = 256) {
  // Sample up to 10000 pixels for speed
  const step = Math.max(1, Math.floor(numPixels / 10000));
  const samples = [];
  for (let i = 0; i < numPixels; i += step) {
    const off = i * 3;
    samples.push([rgbBuf[off], rgbBuf[off + 1], rgbBuf[off + 2]]);
  }

  // Median cut: repeatedly split the widest box on its widest channel
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let bestIdx = -1, bestSpan = 0, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const px of boxes[i]) {
          if (px[ch] < lo) lo = px[ch];
          if (px[ch] > hi) hi = px[ch];
        }
        if (hi - lo > bestSpan) {
          bestSpan = hi - lo;
          bestIdx = i;
          bestCh = ch;
        }
      }
    }
    if (bestIdx < 0) break;
    const box = boxes[bestIdx];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bestIdx, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const [pr, pg, pb] of box) { r += pr; g += pg; b += pb; }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function mapPixels(rgbBuf, numPixels, palette) {
  const indexed = new Uint16Array(numPixels);
  const cache = new Map();
  for (let i = 0; i < numPixels; i++) {
    const off = i * 3;
    const r = rgbBuf[off], g = rgbBuf[off + 1], b = rgbBuf[off + 2];
    const key = (r << 16) | (g << 8) | b;
    if (cache.has(key)) {
      indexed[i] = cache.get(key);
      continue;
    }
    let bestDist = Infinity, bestIdx = 0;
    for (let j = 0; j < palette.length; j++) {
      const dr = r - palette[j][0], dg = g - palette[j][1], db = b - palette[j][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    cache.set(key, bestIdx);
    indexed[i] = bestIdx;
  }
  return indexed;
}

// ============================================
// Sixel Encoder
// ============================================

function encodeSixel(indexed, w, h, palette) {
  const parts = [];

  // DCS + raster attributes
  parts.push(`\x1bPq"1;1;${w};${h}`);

  // Define palette
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i];
    parts.push(
      `#${i};2;${Math.round(r * 100 / 255)};${Math.round(g * 100 / 255)};${Math.round(b * 100 / 255)}`
    );
  }

  const numBands = Math.ceil(h / 6);
  for (let band = 0; band < numBands; band++) {
    const y0 = band * 6;

    // Collect colors used in this band
    const used = new Set();
    for (let dy = 0; dy < 6 && y0 + dy < h; dy++) {
      const row = (y0 + dy) * w;
      for (let x = 0; x < w; x++) used.add(indexed[row + x]);
    }

    let isFirst = true;
    for (const c of used) {
      if (!isFirst) parts.push("$"); // CR — revisit this band from the left
      isFirst = false;
      parts.push(`#${c}`);

      // Emit run-length encoded sixel data for this color
      let prevMask = -1, runLen = 0;
      const flush = () => {
        if (prevMask < 0) return;
        const ch = String.fromCharCode(63 + prevMask);
        parts.push(runLen >= 4 ? `!${runLen}${ch}` : ch.repeat(runLen));
      };

      for (let x = 0; x < w; x++) {
        let mask = 0;
        for (let dy = 0; dy < 6; dy++) {
          const y = y0 + dy;
          if (y < h && indexed[y * w + x] === c) mask |= 1 << dy;
        }
        if (mask === prevMask) {
          runLen++;
        } else {
          flush();
          prevMask = mask;
          runLen = 1;
        }
      }
      flush();
    }

    if (band < numBands - 1) parts.push("-"); // LF — next band
  }

  parts.push("\x1b\\"); // ST
  return parts.join("");
}

// ============================================
// Sixel image render (high quality)
// ============================================

async function imageToSixel(imageBuffer, targetWidth = 400) {
  const meta = await sharp(imageBuffer).metadata();
  const targetHeight = Math.round((targetWidth * meta.height) / meta.width);

  const { data } = await sharp(imageBuffer)
    .resize(targetWidth, targetHeight)
    .flatten({ background: { r: 230, g: 230, b: 230 } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const numPixels = targetWidth * targetHeight;
  const palette = buildPalette(data, numPixels, 256);
  const indexed = mapPixels(data, numPixels, palette);
  return encodeSixel(indexed, targetWidth, targetHeight, palette);
}

// ============================================
// Half-block pixel renderer (fallback)
// State-cached: only emits escape sequences when color changes
// ============================================

function rgbToAnsi256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  return 16 + 36 * Math.round((r / 255) * 5)
    + 6 * Math.round((g / 255) * 5)
    + Math.round((b / 255) * 5);
}

function colorSgr(data, i, isFg, colorMode, cache) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];

  if (colorMode === "ansi256") {
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = rgbToAnsi256(r, g, b);
      cache.set(key, idx);
    }
    return `${isFg ? 38 : 48};5;${idx}`;
  }

  return `${isFg ? 38 : 48};2;${r};${g};${b}`;
}

async function renderPixels(imageBuffer, cols, rows, { colorMode = "truecolor" } = {}) {
  const pixelH = rows * 2;
  const { data } = await sharp(imageBuffer)
    .resize(cols, pixelH, { fit: "fill" })
    .flatten({ background: { r: 230, g: 230, b: 230 } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lines = [];
  const colorCache = new Map();

  for (let y = 0; y < pixelH; y += 2) {
    const parts = [];
    let currentFg = "";
    let currentBg = "";

    for (let x = 0; x < cols; x++) {
      const ti = (y * cols + x) * 3;
      const bi = ((y + 1) * cols + x) * 3;
      const nextFg = colorSgr(data, ti, true, colorMode, colorCache);
      const nextBg = colorSgr(data, bi, false, colorMode, colorCache);

      if (nextFg !== currentFg || nextBg !== currentBg) {
        if (nextFg !== currentFg && nextBg !== currentBg) {
          parts.push(`\x1b[${nextFg};${nextBg}m`);
        } else if (nextFg !== currentFg) {
          parts.push(`\x1b[${nextFg}m`);
        } else {
          parts.push(`\x1b[${nextBg}m`);
        }
        currentFg = nextFg;
        currentBg = nextBg;
      }

      parts.push("\u2580");
    }

    if (currentFg || currentBg) parts.push(RESET);
    lines.push(parts.join(""));
  }

  return lines;
}

// ============================================
// Helpers
// ============================================

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + "\u2026" : str;
}

function cardLine(content) {
  const visible = stripAnsi(content);
  const padding = INNER_W - visible.length;
  if (padding < 0) return `\u2502 ${content}${RESET} \u2502`;
  return `\u2502 ${content}${" ".repeat(padding)} \u2502`;
}

function emptyLine() {
  return `\u2502${" ".repeat(INNER_W + 2)}\u2502`;
}

function topBorder() {
  return `\u256D${"\u2500".repeat(INNER_W + 2)}\u256E`;
}

function bottomBorder() {
  return `\u2570${"\u2500".repeat(INNER_W + 2)}\u256F`;
}

function divider() {
  return `\u251C${"\u2500".repeat(INNER_W + 2)}\u2524`;
}

function artTopBorder() {
  const side = Math.floor((INNER_W - ART_W) / 2);
  return `\u2502${" ".repeat(side)}\u256D${"\u2500".repeat(ART_W)}\u256E${" ".repeat(INNER_W - ART_W - side)}\u2502`;
}

function artBottomBorder() {
  const side = Math.floor((INNER_W - ART_W) / 2);
  return `\u2502${" ".repeat(side)}\u2570${"\u2500".repeat(ART_W)}\u256F${" ".repeat(INNER_W - ART_W - side)}\u2502`;
}

function artLine(text) {
  const side = Math.floor((INNER_W - ART_W) / 2);
  const padR = INNER_W - ART_W - side;
  const visible = stripAnsi(text);
  let fitted = text;
  if (visible.length < ART_W) {
    fitted = text + " ".repeat(ART_W - visible.length);
  }
  return `\u2502${" ".repeat(side)}\u2502${fitted}${RESET}\u2502${" ".repeat(padR)}\u2502`;
}

// ============================================
// Card data formatting
// ============================================

function formatHeader(card) {
  const name = truncate(card.name, 28);
  const hp = card.hp ? `${card.hp} HP` : "";
  const type = (card.types || []).map((t) => TYPE_ICON[t] || t).join("");
  const right = `${hp} ${type}`.trim();
  const gap = INNER_W - name.length - right.length;
  return `${BOLD}${name}${RESET}${" ".repeat(Math.max(1, gap))}${right}`;
}

function formatSubline(card) {
  if (card.evolvesFrom) {
    const stage = card.subtypes?.includes("Stage 2")
      ? "Stage 2"
      : card.subtypes?.includes("Stage 1")
        ? "Stage 1"
        : "Basic";
    return `${DIM}${stage} \u2014 Evolves from ${card.evolvesFrom}${RESET}`;
  }
  return `${DIM}${card.subtypes?.join(" ") || "Basic"}${RESET}`;
}

function formatAttacks(card) {
  const lines = [];
  for (const atk of card.attacks || []) {
    const cost = (atk.cost || []).map((t) => TYPE_ICON[t] || "\u00B7").join("");
    const dmg = atk.damage || "";
    const name = truncate(atk.name, INNER_W - stripAnsi(cost).length - dmg.length - 4);
    const gap = INNER_W - stripAnsi(cost).length - name.length - dmg.length - 2;
    lines.push(`${cost} ${name}${" ".repeat(Math.max(1, gap))}${dmg}`);
    if (atk.text) {
      for (const wl of wordWrap(atk.text, INNER_W - 2)) {
        lines.push(`${DIM}  ${wl}${RESET}`);
      }
    }
  }
  return lines;
}

function formatFooter(card) {
  const parts = [];
  if (card.weaknesses?.length) {
    const w = card.weaknesses[0];
    parts.push(`weak: ${TYPE_ICON[w.type] || w.type}${w.value}`);
  }
  if (card.resistances?.length) {
    const r = card.resistances[0];
    parts.push(`resist: ${TYPE_ICON[r.type] || r.type}${r.value}`);
  }
  if (card.retreatCost?.length) {
    parts.push(`retreat: ${card.retreatCost.length}`);
  }
  return parts.join("  ");
}

function formatRarity(card) {
  const r = card.rarity || "";
  if (r === "Rare Holo") return "\u2605 Rare Holo";
  if (r === "Rare") return "\u2605 Rare";
  if (r === "Uncommon") return "\u25C6 Uncommon";
  if (r === "Common") return "\u25CF Common";
  return r;
}

function wordWrap(text, maxLen) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ============================================
// Public API
// ============================================

/**
 * Render the full card image.
 * mode: "sixel" (pixel-perfect, requires sixel terminal) or "halfblock" (fallback)
 * width: pixel width for sixel (default 400), column width for halfblock (default 50)
 */
async function renderCardImage(card, { width, mode = "sixel" } = {}) {
  const url = card.images.large || card.images.small;
  const buf = await fetchImageBuffer(url);

  if (mode === "sixel") {
    return imageToSixel(buf, width || 400);
  }

  // Half-block fallback
  const cols = width || 50;
  const meta = await sharp(buf).metadata();
  const rows = Math.round((cols * meta.height) / (meta.width * 2));
  const lines = await renderPixels(buf, cols, rows);
  return lines.join("\n");
}

/**
 * Render structured text card (frame + half-block art).
 */
async function renderCard(card) {
  const buf = await fetchImageBuffer(card.images.large || card.images.small);

  const meta = await sharp(buf).metadata();
  const crop = ART_CROP[card.supertype] || ART_CROP.Pokemon;

  // For evolved Pokemon, black out the evo thumbnail in the upper-left
  let srcBuf = buf;
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
    srcBuf = await sharp(buf)
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
  const pixelArt = await renderPixels(artBuf, ART_W, ART_H);

  const output = [];
  output.push(topBorder());
  output.push(cardLine(formatHeader(card)));
  output.push(cardLine(formatSubline(card)));
  output.push(artTopBorder());
  for (const al of pixelArt) output.push(artLine(al));
  output.push(artBottomBorder());
  if (card.attacks?.length) {
    output.push(divider());
    for (const line of formatAttacks(card)) output.push(cardLine(line));
  }
  if (card.flavorText) {
    output.push(emptyLine());
    for (const wl of wordWrap(card.flavorText, INNER_W - 4)) {
      output.push(cardLine(`${DIM}"${wl}"${RESET}`));
    }
  }
  output.push(divider());
  output.push(cardLine(formatFooter(card)));
  output.push(
    cardLine(
      `${DIM}${formatRarity(card)}  ${card.set?.name || ""}  ${card.number || ""}/${card.set?.printedTotal || ""}${RESET}`
    )
  );
  output.push(bottomBorder());
  return output.join("\n");
}

export { renderCard, renderCardImage, imageToSixel, ART_W, INNER_W };
