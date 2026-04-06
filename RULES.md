# Ranked GitHub TCG — Season Rules

## How it works

Merge real pull requests. Earn card packs. Build your collection. Climb the ladder.

## Qualifying work

A merged PR earns you tickets if **all** of the following are true:

- Repo is on the season allowlist
- PR merged into the protected default branch
- Required CI checks passed
- PR is not authored by a bot
- PR has not already been scored

### Substance

Not all lines count. The system ignores:
- Lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- Vendored code (`vendor/`, `node_modules/`)
- Generated files (`dist/`, `build/`, `generated/`, `*.gen.*`)
- Snapshots (`*.snap`)
- Minified files (`*.min.js`, `*.min.css`)
- Markdown-only changes (unless the season explicitly includes docs)

### Tickets per PR

| Reviewed LOC | Tickets |
|---|---|
| 1–149 | 1 |
| 150–599 | 2 |
| 600+ | 3 |

Step-based, not linear. More lines does not mean proportionally more tickets.

## Packs

Every ticket earns exactly one 3-card pack. No misses.

Each card rolls independently:

| Rarity | Chance |
|---|---|
| Common | 55% |
| Uncommon | 30% |
| Rare | 12% |
| Holo Rare | 3% |

## Your pull personality

Your GitHub identity determines which cards feel "warm" (show up slightly more) and which feel "cold" (show up slightly less). This is flavor only.

Every trainer gets the **exact same probability distribution**. Only the card-to-position mapping changes. Your identity cannot make ranked progress harder or easier.

Technical detail: a global position weight vector (0.75x to 1.35x) is shared by all trainers. Each trainer gets a deterministic permutation of the card pool seeded from their trainer identity. The expected value is identical for everyone.

## Duplicates

Extra copies of cards you already own are tracked in your binder. Duplicates don't score — only unique cards matter for the ladder.

## Scoring

The ladder ranks by **binder score**, not activity volume.

| Card type | Points |
|---|---|
| Unique common | 1 |
| Unique uncommon | 3 |
| Unique rare | 8 |
| Unique holo rare | 20 |

### Set completion bonuses

| Threshold | Bonus |
|---|---|
| 25% of a set | +20 |
| 50% of a set | +60 |
| 75% of a set | +150 |
| 100% of a set | +400 |

### Tiebreakers

1. Higher binder score
2. More full sets completed
3. Fewer tickets spent
4. Earlier timestamp reaching final score

## Randomness and verification

Outcomes are unpredictable before your PR merges. After merge, anyone can verify every roll immediately.

**How it works:**
- Your roll: `roll_seed = SHA256(ticket_id + merge_commit_sha)`
- The ticket ID is deterministic from public GitHub facts
- The merge commit SHA is the entropy — unpredictable before merge, immutable after
- No secrets. No reveal ceremonies. No trust required.

**What you can verify right now:**
1. Your PR was eligible under public rules
2. Your ticket IDs were constructed correctly from public inputs
3. Your roll seed is `SHA256(ticket_id + merge_commit_sha)`
4. Your pack outcome was derived deterministically from the roll seed
5. The ledger entry matches the computed outcome
6. The leaderboard is the correct reduction of the ledger

No waiting. No reveals. Anyone can recompute any roll from public data.

## Anti-abuse

- Merged PRs only (not pushes)
- Protected default branch only
- Allowlisted repos only
- Idempotent ticket IDs (same event cannot score twice)
- Append-only ledger
- Daily commitment reveals
- All rules public

## What's not ranked

Local streak bonuses, variety tracking, and the local pack-opening experience are single-player features. They do not affect ranked standings. Only public, auditable events through the GitHub pipeline affect the ladder.

## One-sentence summary

GitHub proves the work, public rules define the game, delayed-reveal crypto supplies fair suspense, trainer identity shapes collection flavor, and an append-only public ledger makes the ladder credible.
