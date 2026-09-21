// Scrapes cringe.com and writes public/data.json — the static equivalent of
// the /api/events endpoint. Run by CI (and available locally via `npm run build`).
const fs = require('fs');
const path = require('path');
const { scrape } = require('../lib/scrape');

async function main() {
  const { events, venues, dateRange } = await scrape();
  const payload = { events, venues, dateRange, fetchedAt: Date.now() };

  const outPath = path.join(__dirname, '..', 'public', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${outPath}: ${events.length} events, ${venues.length} venues (${dateRange.label || 'no date range'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
