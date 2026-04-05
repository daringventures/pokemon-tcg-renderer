// Encrypted trainer state — AES-256-GCM
// Single source of truth for state crypto + trainer seed

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

export const STATE_FILE = join(process.env.HOME || process.env.USERPROFILE, ".claude", "pokemon.dat");

export function getTrainerSeed() {
  let gitUser = "unknown";
  let hostname = "localhost";
  try { gitUser = execSync("git config user.name", { encoding: "utf8" }).trim(); } catch {}
  try { hostname = execSync("hostname", { encoding: "utf8" }).trim(); } catch {}
  return createHash("sha256").update(`${gitUser}::${hostname}`).digest();
}

export function encryptState(state, seed) {
  const json = JSON.stringify(state);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", seed, iv);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptState(buf, seed) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", seed, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(json);
}

export function saveState(state, seed) {
  writeFileSync(STATE_FILE, encryptState(state, seed));
}

export function freshState() {
  return {
    cards: {},
    cardMeta: {},
    packsOpened: 0,
    holosPulled: 0,
    setProgress: {},
    points: 0,
    packsAvailable: 0,
    messageCount: 0,
    toolCount: 0,
    totalPointsEarned: 0,
    lastActiveDate: null,
    streakDays: 0,
    bestStreak: 0,
    recentCards: [],
  };
}

export function loadState(seed) {
  if (!existsSync(STATE_FILE)) return freshState();
  try {
    return decryptState(readFileSync(STATE_FILE), seed);
  } catch {
    return freshState();
  }
}

export function loadStateOrNull(seed) {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return decryptState(readFileSync(STATE_FILE), seed);
  } catch {
    return null;
  }
}
