// Shared constants — ANSI codes, type maps, rarity icons

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const MAGENTA = "\x1b[35m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[97m";

export const TYPE_ICON = {
  Fire: "\u{1F525}", Water: "\u{1F4A7}", Grass: "\u{1F33F}",
  Lightning: "\u26A1", Psychic: "\u{1F52E}", Fighting: "\u{1F44A}",
  Colorless: "\u2B50", Darkness: "\u{1F311}", Metal: "\u2699\uFE0F",
  Dragon: "\u{1F409}",
};

export const TYPE_COLOR = {
  Fire: RED, Water: CYAN, Grass: GREEN, Lightning: YELLOW,
  Psychic: MAGENTA, Fighting: "\x1b[38;2;180;100;40m",
  Colorless: WHITE, Darkness: DIM, Metal: "\x1b[38;2;160;170;180m",
  Dragon: "\x1b[38;2;120;80;40m",
};

export const RARITY_ICON = {
  "Rare Holo": `${YELLOW}\u2605${RESET}`,
  "Rare": `${WHITE}\u2605${RESET}`,
  "Uncommon": `${CYAN}\u25C6${RESET}`,
  "Common": `${DIM}\u25CF${RESET}`,
};
