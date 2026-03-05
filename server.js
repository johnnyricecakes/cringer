const express = require('express');
const https = require('https');
const cheerio = require('cheerio');
const path = require('path');

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

function fetchPage() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'cringe.com',
      path: '/all4weeks.php',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CringeCalendar/1.0)' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const MONTH_MAP = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11
};

function parseDateRange(html) {
  const $ = cheerio.load(html);
  const h3 = $('h3').first().text().trim(); // e.g. "MARCH 2 - MARCH 29"
  const match = h3.match(/(\w+)\s+(\d+)\s*-\s*(\w+)\s+(\d+)/i);
  if (!match) return { year: new Date().getFullYear(), startMonth: null, endMonth: null };

  const now = new Date();
  const startMonthNum = MONTH_MAP[match[1].toUpperCase()];
  const endMonthNum = MONTH_MAP[match[3].toUpperCase()];
  // Determine year: if the start month is in the past by more than a few months, use next year
  let year = now.getFullYear();
  const startGuess = new Date(year, startMonthNum, parseInt(match[2]));
  if (startGuess < new Date(now - 60 * 24 * 60 * 60 * 1000)) year++;

  return {
    year,
    startMonth: startMonthNum,
    startDay: parseInt(match[2]),
    endMonth: endMonthNum,
    endDay: parseInt(match[4]),
    label: h3
  };
}

function parseEvents(html, dateRange) {
  const $ = cheerio.load(html);
  const events = [];
  const { year, startMonth } = dateRange;

  $('p').each((i, p) => {
    const pEl = $(p);
    const bTags = pEl.find('b');
    if (!bTags.length) return;

    const firstB = bTags.first();
    const firstLink = firstB.find('a');
    if (!firstLink.length) return; // Not a venue block

    const venueName = firstBText(firstB);
    const venueUrl = firstLink.attr('href') || '';

    // Parse phone from text after venue bold
    const pHtml = pEl.html() || '';
    const phoneMatch = pHtml.match(/\s*-\s*([\d\-()]+)<br>/);
    const phone = phoneMatch ? phoneMatch[1].trim() : '';

    bTags.each((j, b) => {
      if (j === 0) return; // skip venue header

      const bEl = $(b);
      const bText = bEl.text().trim().replace(/:$/, '');

      // Match "Day Date" like "Tue 3" or just "Day" like "Mon"
      const dateMatch = bText.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*(\d+)?$/i);
      if (!dateMatch) return;

      const dayOfWeek = capitalize(dateMatch[1].toLowerCase());
      const dateNum = dateMatch[2] ? parseInt(dateMatch[2]) : null;

      // Collect text nodes immediately after this <b>
      let eventText = '';
      let node = b.nextSibling;
      while (node) {
        if (node.type === 'text') {
          eventText += node.data;
        } else if (node.name === 'br') {
          break;
        } else if (node.name === 'b') {
          break;
        } else if (node.type === 'tag') {
          // e.g. <a> links in event text
          eventText += $(node).text();
        }
        node = node.nextSibling;
      }

      eventText = eventText.trim();
      if (!eventText) return;

      // Parse time, price from eventText
      // Format: "Event Name (price) time" or "Event Name time"
      const timeMatch = eventText.match(/(\d{1,2}(?::\d{2})?(?:-\d{1,2}(?::\d{2})?)?(?:am|pm))/i);
      const priceMatch = eventText.match(/\(([^)]+)\)/);
      const soldOut = eventText.includes('[SOLD OUT]');

      // Build a date if we have a specific date number
      let date = null;
      if (dateNum !== null) {
        // Figure out month - if dateNum < startDay of startMonth, it might roll to next month
        let month = startMonth;
        if (dateRange.endMonth !== startMonth && dateNum <= dateRange.endDay && dateNum < dateRange.startDay) {
          month = dateRange.endMonth;
        }
        date = new Date(year, month, dateNum);
        // ISO string for easy filtering: YYYY-MM-DD
        date = date.toISOString().split('T')[0];
      }

      // Clean event name: strip price, time, [SOLD OUT], and trailing whitespace
      let cleanName = eventText
        .replace(/\[SOLD OUT\]/gi, '')
        .replace(/\([^)]+\)/g, '')      // remove (price/details)
        .replace(/\s+\d{1,2}(?::\d{2})?(?:-\d{1,2}(?::\d{2})?)?(?:am|pm)\s*$/i, '') // strip trailing time
        .replace(/\s{2,}/g, ' ')
        .trim();

      events.push({
        venue: venueName,
        venueUrl,
        phone,
        dayOfWeek,
        dateNum,
        date,
        isRecurring: dateNum === null,
        eventText: cleanName,
        time: timeMatch ? timeMatch[1] : '',
        price: priceMatch ? priceMatch[1] : '',
        soldOut,
      });
    });
  });

  return events;
}

function firstBText(bEl) {
  const link = bEl.find('a');
  return link.length ? link.text().trim() : bEl.text().trim();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function getEvents() {
  const now = Date.now();
  const weekStart = getMostRecentMonday();
  if (cache.events && cache.timestamp >= weekStart && (now - cache.timestamp) < CACHE_MAX_AGE) {
    return cache;
  }
  const html = await fetchPage();
  const dateRange = parseDateRange(html);
  const events = parseEvents(html, dateRange);
  const venues = [...new Set(events.map(e => e.venue))].sort((a, b) => a.localeCompare(b));

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
