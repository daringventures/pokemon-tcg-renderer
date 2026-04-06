# Pokemon TCG for GitHub

Merge pull requests. Open packs. Collect cards. Climb the ladder.

A multiplayer Pokemon card game where real engineering work earns you WotC-era booster packs. Every merged PR rolls cards. Every roll is verifiable from public data. No secrets, no trust required.

## Join

```bash
gh extension install daringventures/gh-pokemon-tcg
gh pokemon-tcg join
```

Or manually:

1. Copy [`participant.yml`](.github/workflows/participant.yml) into your repo at `.github/workflows/`
2. Create a [GitHub PAT](https://github.com/settings/tokens) with `repo` scope
3. Add it as a repo secret: `gh secret set TCG_DISPATCH_TOKEN`

Do this for every repo you want to earn cards from. Same PAT works everywhere.

## How it works

When you merge a PR, `participant.yml` dispatches the merge metadata to this repo. The game engine scores the PR, rolls your cards, and updates the public leaderboard.

**You earn tickets based on substance:**

| Reviewed LOC | Tickets | Packs |
|---|---|---|
| 1–149 | 1 | 1 |
| 150–599 | 2 | 2 |
| 600+ | 3 | 3 |

Lockfiles, generated code, vendored deps, and snapshots don't count.

**Every ticket earns exactly one 3-card pack.** Each card rolls independently:

| Rarity | Chance |
|---|---|
| Common | 55% |
| Uncommon | 30% |
| Rare | 12% |
| Holo Rare | 3% |

## Your pull personality

Your GitHub identity gives you a unique collection personality. Some cards run warm for you, others cold. This is flavor — every trainer gets the exact same probability distribution. Your identity changes which cards map to which positions, not the odds.

## Leaderboard

Ranked by **binder score**, not activity volume.

| Card type | Points |
|---|---|
| Unique common | 1 |
| Unique uncommon | 3 |
| Unique rare | 8 |
| Unique holo rare | 20 |

Set completion bonuses: +20 at 25%, +60 at 50%, +150 at 75%, +400 at 100%.

## Verification

Every roll is `SHA256(ticket_id + merge_commit_sha)`. Both inputs are public. Anyone can recompute any outcome at any time. The [ledger](ledger/) is the source of truth. The [leaderboard](leaderboard.json) is derived.

See [RULES.md](RULES.md) for the full spec.

## Season 1: Kanto Classics

Base Set, Jungle, Fossil. 228 cards across 3 sets. April–June 2026.

## Architecture

```
your repo                          game repo
─────────                          ─────────
merge PR                           
  → participant.yml fires          
  → dispatches metadata ────────→  pr-roll.yml receives
                                     → pr-roll.js scores
                                     → rolls cards (SHA256 entropy)
                                     → appends to ledger
                                     → rebuilds leaderboard
                                     → commits
```

No secrets flow. No code leaves your repo. Only metadata: author, PR number, merge SHA, line counts.

## Local play

The game also includes a local pack-opening experience for Claude Code:

- `engine.js` — points engine with streak bonus, status line
- `rip-pack.js` — interactive pack rip with terminal card art
- `card-render.js` — sixel, half-block, and braille card rendering

Local play is single-player and does not affect ranked standings.
