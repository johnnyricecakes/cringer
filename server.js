const express = require('express');
const path = require('path');
const { scrape } = require('./lib/scrape');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let cache = { events: null, venues: null, dateRange: null, timestamp: 0 };
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 1 week

// Returns the timestamp of the most recent Monday at midnight (local time).
// Cache is valid only if it was fetched after this point.
function getMostRecentMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - daysBack);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

async function getEvents() {
  const now = Date.now();
  const weekStart = getMostRecentMonday();
  if (cache.events && cache.timestamp >= weekStart && (now - cache.timestamp) < CACHE_MAX_AGE) {
    return cache;
  }
  const { events, venues, dateRange } = await scrape();
  cache = { events, venues, dateRange, timestamp: now };
  return cache;
}

app.get('/api/events', async (req, res) => {
  try {
    const { events, venues, dateRange } = await getEvents();
    res.json({ events, venues, dateRange, fetchedAt: cache.timestamp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
