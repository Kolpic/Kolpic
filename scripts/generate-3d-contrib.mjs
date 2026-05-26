/**
 * Generates a single 3D isometric contribution SVG spanning multiple years.
 * Fetches GitHub contribution data via GraphQL API and renders all weeks.
 *
 * Usage: node generate-3d-contrib.mjs <username> <token> <start_year> <end_year>
 * Output: profile-3d-contrib/profile-alltime.svg
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const [,, USERNAME, TOKEN, START_YEAR_STR, END_YEAR_STR] = process.argv;
const START_YEAR = parseInt(START_YEAR_STR || '2022');
const END_YEAR = parseInt(END_YEAR_STR || new Date().getFullYear().toString());

// ── GraphQL fetch ────────────────────────────────────────────────────────────

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'contrib-graph-generator'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchYear(year) {
  const from = `${year}-01-01T00:00:00Z`;
  const to   = `${year}-12-31T23:59:59Z`;
  const res = await gql(`{
    user(login: "${USERNAME}") {
      contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }`);
  return res.data.user.contributionsCollection.contributionCalendar.weeks;
}

// ── Data collection ──────────────────────────────────────────────────────────

console.log(`Fetching contributions for ${USERNAME} from ${START_YEAR} to ${END_YEAR}...`);
const allWeeks = [];
for (let y = START_YEAR; y <= END_YEAR; y++) {
  console.log(`  Fetching ${y}...`);
  const weeks = await fetchYear(y);
  allWeeks.push(...weeks);
}

// Flatten to days with counts
const days = allWeeks.flatMap(w => w.contributionDays);
const maxCount = Math.max(...days.map(d => d.contributionCount), 1);

// ── SVG isometric renderer ───────────────────────────────────────────────────

const CELL  = 11;   // base cell size
const GAP   = 1;    // gap between cells
const STEP  = CELL + GAP;
const ISO_X = STEP * Math.cos(Math.PI / 6);   // ~9.5
const ISO_Y = STEP * Math.sin(Math.PI / 6);   // ~5.5
const MAX_H = 40;   // max bar height in px

const BG        = '#0d1117';
const FLOOR     = '#161b22';
const FLOOR_L   = '#21262d';
const FLOOR_R   = '#161b22';
const EMPTY_TOP = '#1a1f29';
const EMPTY_L   = '#12161e';
const EMPTY_R   = '#0f131a';

function lerp(a, b, t) { return a + (b - a) * t; }

// Rainbow colour for a contribution bar (hue shifts across weeks)
function barColor(weekIdx, totalWeeks, intensity) {
  const hue = Math.round((weekIdx / totalWeeks) * 300); // 0→300 deg
  const l = Math.round(lerp(25, 55, intensity));
  return `hsl(${hue},70%,${l}%)`;
}
function darken(weekIdx, totalWeeks, intensity, factor) {
  const hue = Math.round((weekIdx / totalWeeks) * 300);
  const l = Math.round(lerp(25, 55, intensity) * factor);
  return `hsl(${hue},65%,${l}%)`;
}

// Weeks → columns; days → rows (0=Sun…6=Sat)
const totalWeeks = allWeeks.length;
const ROWS = 7;

// Canvas size
const W = Math.ceil(totalWeeks * ISO_X + ROWS * ISO_X + MAX_H + 60);
const H = Math.ceil(totalWeeks * ISO_Y + ROWS * ISO_Y + MAX_H + 80);

// Origin (top-left of the isometric grid, offset so nothing clips)
const OX = MAX_H + 20;
const OY = MAX_H + 30;

function isoProject(col, row) {
  // col = week index (left→right), row = day-of-week (top→bottom in iso)
  const x = OX + col * ISO_X - row * ISO_X;
  const y = OY + col * ISO_Y + row * ISO_Y;
  return { x, y };
}

const shapes = [];

allWeeks.forEach((week, wi) => {
  week.contributionDays.forEach((day, di) => {
    const count = day.contributionCount;
    const intensity = count === 0 ? 0 : Math.pow(count / maxCount, 0.5);
    const barH = count === 0 ? 0 : Math.max(3, Math.round(intensity * MAX_H));

    const { x, y } = isoProject(wi, di);

    if (count === 0) {
      // Flat empty cell
      shapes.push(`
        <polygon points="${x},${y} ${x+ISO_X},${y-ISO_Y} ${x+ISO_X*2},${y} ${x+ISO_X},${y+ISO_Y}"
          fill="${EMPTY_TOP}" stroke="${BG}" stroke-width="0.3"/>
        <polygon points="${x},${y} ${x+ISO_X},${y+ISO_Y} ${x+ISO_X},${y+ISO_Y+2} ${x},${y+2}"
          fill="${EMPTY_L}" stroke="${BG}" stroke-width="0.3"/>
        <polygon points="${x+ISO_X*2},${y} ${x+ISO_X},${y+ISO_Y} ${x+ISO_X},${y+ISO_Y+2} ${x+ISO_X*2},${y+2}"
          fill="${EMPTY_R}" stroke="${BG}" stroke-width="0.3"/>
      `);
    } else {
      const top  = barColor(wi, totalWeeks, intensity);
      const left = darken(wi, totalWeeks, intensity, 0.65);
      const right= darken(wi, totalWeeks, intensity, 0.45);
      const ty = y - barH;
      shapes.push(`
        <polygon points="${x},${ty} ${x+ISO_X},${ty-ISO_Y} ${x+ISO_X*2},${ty} ${x+ISO_X},${ty+ISO_Y}"
          fill="${top}" stroke="${BG}" stroke-width="0.3"/>
        <polygon points="${x},${ty} ${x+ISO_X},${ty+ISO_Y} ${x+ISO_X},${y+ISO_Y} ${x},${y}"
          fill="${left}" stroke="${BG}" stroke-width="0.3"/>
        <polygon points="${x+ISO_X*2},${ty} ${x+ISO_X},${ty+ISO_Y} ${x+ISO_X},${y+ISO_Y} ${x+ISO_X*2},${y}"
          fill="${right}" stroke="${BG}" stroke-width="0.3"/>
      `);
    }
  });
});

// Total contributions label
const total = days.reduce((s, d) => s + d.contributionCount, 0);
const labelX = OX;
const labelY = H - 10;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BG}" rx="8"/>
  ${shapes.join('\n')}
  <text x="${labelX}" y="${labelY}" fill="#8b949e" font-family="monospace" font-size="11">
    ${total.toLocaleString()} contributions · ${START_YEAR}–${END_YEAR}
  </text>
</svg>`;

const outDir = 'profile-3d-contrib';
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'profile-alltime.svg');
fs.writeFileSync(outPath, svg);
console.log(`Written ${outPath} (${W}×${H}px, ${allWeeks.length} weeks)`);
