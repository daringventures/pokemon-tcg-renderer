// Render a single Pokemon card by ID
// Usage: node render-single.js <card-id>
// Outputs half-block framed card to stdout

import { renderCard } from "./card-render.js";

const cardId = process.argv[2];
if (!cardId) {
  console.error("Usage: node render-single.js <card-id>");
  process.exit(1);
}

const res = await fetch(`https://api.pokemontcg.io/v2/cards/${cardId}`);
const { data: card } = await res.json();

process.stdout.write(await renderCard(card));
process.stdout.write("\n");
