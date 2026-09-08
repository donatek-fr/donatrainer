/* ============================================================================
   DonaTrainer — route data generator (maintenance tool, not shipped in public/)

   The original worlddata.json routes were near-fully-connected: on average
   every airport flew nonstop to ~79% of every other airport in the file,
   which is why AN/SN never showed a connecting flight. This script replaces
   routes[] with a real hub-and-spoke network built from the existing
   airports[]/airlines[]/countries[] (all left untouched) and each airport's
   own lat/lon, verifies one-stop reachability for every airport pair before
   writing anything, and prints before/after connectivity stats.

   Run with: node scripts/generate-routes.js
============================================================================ */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "public", "assets", "data", "worlddata.json");
const wd = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const { airports, airlines } = wd;

const airportByCode = {};
airports.forEach((a) => (airportByCode[a.code] = a));

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function dist(codeA, codeB) {
  const a = airportByCode[codeA], b = airportByCode[codeB];
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

// --- Before stats (on the routes we're about to replace) ---
function connectivityStats(routes) {
  const byOrigin = {};
  routes.forEach(([f, t]) => { (byOrigin[f] = byOrigin[f] || new Set()).add(t); });
  const total = airports.length - 1;
  const pcts = Object.keys(byOrigin).map((o) => byOrigin[o].size / total);
  const avg = pcts.reduce((a, b) => a + b, 0) / (pcts.length || 1);
  return { count: routes.length, avgPct: avg * 100 };
}
const before = connectivityStats(wd.routes);
console.log(`BEFORE: ${before.count} routes, avg ${before.avgPct.toFixed(1)}% direct connectivity`);

// --- Tier structure ---
const SUPER_HUBS = ["LHR", "DXB", "SIN", "JFK", "GRU", "JNB", "SYD"];
const MAJOR_HUBS = [
  ...SUPER_HUBS,
  "CDG", "FRA", "AMS", "IST", "MAD", "FCO", "DOH", "AUH", "HKG", "BKK",
  "NRT", "ICN", "PEK", "DEL", "BOM", "ORD", "LAX", "ATL", "YYZ", "MEX", "MEL",
];
const superHubSet = new Set(SUPER_HUBS);
const majorHubSet = new Set(MAJOR_HUBS);
const regionals = airports.map((a) => a.code).filter((c) => !majorHubSet.has(c));

// --- Airline home country + continent fallback pools ---
const AIRLINE_HOME = {
  AF: "FR", KL: "NL", LH: "DE", BA: "GB", IB: "ES", LX: "CH", OS: "AT", SN: "BE",
  TP: "PT", SK: "SE", AY: "FI", AZ: "IT", TK: "TR", DL: "US", AA: "US", UA: "US",
  AC: "CA", AM: "MX", EK: "AE", QR: "QA", EY: "AE", SV: "SA", MS: "EG", ET: "ET",
  KQ: "KE", SA: "ZA", AI: "IN", UK: "IN", "6E": "IN", BG: "BD", PK: "PK", UL: "LK",
  SQ: "SG", TG: "TH", MH: "MY", CX: "HK", CI: "TW", BR: "TW", CA: "CN", MU: "CN",
  CZ: "CN", JL: "JP", NH: "JP", KE: "KR", QF: "AU", NZ: "NZ", LA: "CL", AV: "CO",
  U2: "GB", B6: "US", AS: "US", WN: "US", F9: "US", NK: "US", FR: "IE", VY: "ES",
  W6: "HU", KU: "KW", WY: "OM", GF: "BH",
};
const CONTINENT = {
  GB: "EU", FR: "EU", NL: "EU", DE: "EU", ES: "EU", CH: "EU", IT: "EU", AT: "EU",
  BE: "EU", PT: "EU", DK: "EU", SE: "EU", NO: "EU", FI: "EU", GR: "EU", TR: "EU",
  IE: "EU", HU: "EU",
  US: "NA", CA: "NA", MX: "NA",
  BR: "SA", AR: "SA", CL: "SA", CO: "SA", PE: "SA",
  AE: "ME", QA: "ME", SA: "ME", KW: "ME", OM: "ME", BH: "ME",
  EG: "AF", ET: "AF", KE: "AF", NG: "AF", ZA: "AF",
  IN: "SASIA", BD: "SASIA", PK: "SASIA", LK: "SASIA", NP: "SASIA",
  TH: "ASIA", SG: "ASIA", MY: "ASIA", HK: "ASIA", JP: "ASIA", KR: "ASIA",
  CN: "ASIA", TW: "ASIA", PH: "ASIA", ID: "ASIA",
  AU: "OC", NZ: "OC",
};
const FALLBACK_POOL = {
  EU: ["LH", "AF", "BA", "KL", "IB"],
  ME: ["QR", "EK", "EY", "SV", "GF", "WY", "KU"],
  AF: ["ET", "KQ", "SA", "MS"],
  SASIA: ["AI", "UK", "BG", "UL", "PK"],
  ASIA: ["SQ", "CX", "TG", "CI", "CA", "JL", "NH", "KE"],
  NA: ["AA", "UA", "DL", "AC"],
  SA: ["LA", "AV", "AM"],
  OC: ["QF", "NZ"],
};

const airlinesByCountry = {};
Object.entries(AIRLINE_HOME).forEach(([code, country]) => {
  (airlinesByCountry[country] = airlinesByCountry[country] || []).push(code);
});

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pickCarriers(fromCode, toCode, count) {
  const fromCountry = airportByCode[fromCode].country;
  const toCountry = airportByCode[toCode].country;
  let pool = [...new Set([...(airlinesByCountry[fromCountry] || []), ...(airlinesByCountry[toCountry] || [])])];
  if (!pool.length) {
    const c1 = CONTINENT[fromCountry], c2 = CONTINENT[toCountry];
    pool = [...new Set([...(FALLBACK_POOL[c1] || []), ...(FALLBACK_POOL[c2] || [])])];
  }
  if (!pool.length) pool = ["BA", "AF", "LH"];
  const seed = hashStr(`${fromCode}|${toCode}`);
  const picked = [];
  for (let i = 0; i < count && i < pool.length; i++) picked.push(pool[(seed + i * 7) % pool.length]);
  return [...new Set(picked)];
}

// --- Build routes ---
const routeSet = new Set();
const routes = [];
function addRoute(from, to, carrier) {
  if (from === to) return;
  const key = `${from}|${to}|${carrier}`;
  if (routeSet.has(key)) return;
  routeSet.add(key);
  routes.push([from, to, carrier]);
}
function addBidirectional(from, to, carriers) {
  carriers.forEach((c) => { addRoute(from, to, c); addRoute(to, from, c); });
}

// 1. every airport <-> every super-hub (guarantees 1-stop global reachability)
airports.forEach((a) => {
  SUPER_HUBS.forEach((h) => {
    if (a.code === h) return;
    const count = superHubSet.has(a.code) ? 3 : majorHubSet.has(a.code) ? 2 : 1;
    addBidirectional(a.code, h, pickCarriers(a.code, h, count));
  });
});

// 2. major-hub mesh (dense hub-to-hub network, includes the super-hubs)
MAJOR_HUBS.forEach((h1) => {
  MAJOR_HUBS.forEach((h2) => {
    if (h1 >= h2) return;
    addBidirectional(h1, h2, pickCarriers(h1, h2, 3));
  });
});

// 3. each major hub reaches its nearest regionals directly (typical hub spread)
MAJOR_HUBS.forEach((h) => {
  regionals
    .map((r) => ({ r, d: dist(h, r) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .forEach(({ r }) => addBidirectional(h, r, pickCarriers(h, r, 2)));
});

// 4. every regional explicitly reaches its 2 nearest major hubs (safety net)
regionals.forEach((r) => {
  MAJOR_HUBS
    .map((h) => ({ h, d: dist(r, h) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .forEach(({ h }) => addBidirectional(r, h, pickCarriers(r, h, 1)));
});

// 5. short regional-to-regional hops (domestic/nearby, no hub needed)
regionals.forEach((r1) => {
  regionals
    .filter((r2) => r2 !== r1)
    .map((r2) => ({ r2, d: dist(r1, r2) }))
    .filter((o) => o.d < 1200)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .forEach(({ r2 }) => addBidirectional(r1, r2, pickCarriers(r1, r2, 1)));
});

// --- Reachability check: every ordered pair must resolve direct or via one shared hub ---
const routesByFrom = {};
routes.forEach(([f, t]) => { (routesByFrom[f] = routesByFrom[f] || new Set()).add(t); });
const codes = airports.map((a) => a.code);
const failures = [];
codes.forEach((a) => {
  codes.forEach((b) => {
    if (a === b) return;
    if (routesByFrom[a] && routesByFrom[a].has(b)) return;
    const hubs = routesByFrom[a];
    let found = false;
    if (hubs) {
      for (const h of hubs) {
        if (h === b) continue;
        if (routesByFrom[h] && routesByFrom[h].has(b)) { found = true; break; }
      }
    }
    if (!found) failures.push(`${a}->${b}`);
  });
});

if (failures.length) {
  console.error(`UNREACHABLE PAIRS: ${failures.length} (showing first 20)`);
  console.error(failures.slice(0, 20));
  console.error("Aborting - worlddata.json NOT written.");
  process.exit(1);
}

const after = connectivityStats(routes);
console.log(`AFTER:  ${after.count} routes, avg ${after.avgPct.toFixed(1)}% direct connectivity`);
console.log(`Reachability check passed for all ${codes.length * (codes.length - 1)} ordered airport pairs.`);

wd.routes = routes;
fs.writeFileSync(DATA_PATH, JSON.stringify(wd, null, 2) + "\n");
console.log(`Wrote ${DATA_PATH}`);
