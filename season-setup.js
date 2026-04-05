// Generate season secret, commitment, and day commitments.
// Run once at season start. Store the secret as SEASON_SECRET in GitHub.
// Commit the updated season-manifest.json with commitments.

import { readFileSync, writeFileSync } from "node:fs";
import { generateSeasonSecret, seasonCommitment, generateDayCommitments } from "./season.js";

const manifest = JSON.parse(readFileSync("season-manifest.json", "utf8"));

const secret = generateSeasonSecret();
const commitment = seasonCommitment(secret);
const dayCommitments = generateDayCommitments(secret, manifest.start_date, manifest.end_date);

manifest.season_commitment = commitment;
manifest.day_commitments = dayCommitments;

writeFileSync("season-manifest.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(`Season: ${manifest.season_id}`);
console.log(`Secret (store as SEASON_SECRET): ${secret.toString("hex")}`);
console.log(`Commitment: ${commitment}`);
console.log(`Day commitments: ${Object.keys(dayCommitments).length} days`);
console.log("\nseason-manifest.json updated. Commit it. Store the secret in GitHub Actions secrets.");
