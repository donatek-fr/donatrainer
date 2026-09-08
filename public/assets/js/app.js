/* ============================================================================
   DonaTrainer — App JS (v9.0 - Full-Feature GDS Pass)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Full command coverage from the Amadeus Basic training guide: pricing/TST,
     ticketing, queues, profiles, decode/encode, rebooking, name-search retrieval.
   - Realistic flight durations & class inventory driven by real airport coords.
   - v9.0 adds: NU, SP, FCM, SVC, waitlisting (HL), and IROPS schedule
     changes auto-queued to queue 5 - closing out the README's promised features.
   - v10.0 adds full coverage of "Amadeus Training Manual 190" Ch.1-13: sign-in,
     AIS reference (GG), date/time & math calculators (DD/DF), schedule display
     and direct access, open segments/ARNK/reconfirm, PNR security & copy
     variants, the Best Buy fare family, fare-quote follow-ups, central
     ticketing depth (TTK/FE/FT, real e-ticket status codes, TWX void, ETRV
     revalidation), ticket reissue, multi-step automated refunds, and queue
     categories.
============================================================================ */

const AMX = window.AMX || (window.AMX = {});

// --- STATE MANAGEMENT ---
AMX.state = {
  office: "STRASBOURG/FR",
  agent: "Donatek",
  world: { airports: [], airlines: [], routes: [], countries: [] },
  availability: { outbound: [], inbound: [] },
  pnr: null,
  commandHistory: [],
  historyIndex: -1,
  nameSearchResults: null,
  profiles: {},
  profileDraft: null,
  training: {
    active: false,
    scenario: null,
    step: 0,
  },
  queues: {
    "1": { name: "TICKET TO ISSUE", pnrs: [] },
    "5": { name: "SCHEDULE CHANGE", pnrs: [] },
  },
  queueBrowse: null,
  lastTicket: null,
  rebookOptions: null,
  signedIn: true,
  lastAvailQuery: null,
  bestBuyOptions: null,
  lastFareQuote: null,
  refundDraft: null,
};

const $ = (id) => document.getElementById(id);

// --- HELPERS ---
const fmt = {
  pad: (n, w = 2) => String(n).padStart(w, "0"),
  nowDate: () => {
    const now = new Date();
    const m = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
    return `${fmt.pad(now.getDate())}${m}${now.getFullYear()}`;
  },
  nowTime: () => {
    const now = new Date();
    return `${fmt.pad(now.getHours())}:${fmt.pad(now.getMinutes())}:${fmt.pad(now.getSeconds())}`;
  },
};

const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function parseDDMMM(str) {
  const m = String(str).trim().toUpperCase().match(/^(\d{1,2})([A-Z]{3})(\d{4})?$/);
  if (!m) return null;
  const y = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  return new Date(Date.UTC(y, MMM.indexOf(m[2]), parseInt(m[1], 10)));
}
function fmtDDMMM(dt) { return `${fmt.pad(dt.getUTCDate())}${MMM[dt.getUTCMonth()]}`; }

// --- UI & RENDERERS ---
function writeLine(text, css = "") {
  const out = $("output");
  if (!out) return;
  const line = document.createElement("div");
  line.className = css;
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function writeHTML(html) {
  const out = $("output");
  if (!out) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  out.appendChild(wrap);
  out.scrollTop = out.scrollHeight;
}

function renderItineraryHTML(pnr) {
  if (!pnr) return "";
  const paxList = pnr.passengers.map((p, i) => `<div class="mono">${i+1}. ${p.name} (${p.type}${p.infant ? " + INF " + p.infant.name : ""})</div>`).join("");
  const segs = pnr.segments.map((s, i) => `<div class="mono">${i+1}. ${s.date} ${s.from}-${s.to} ${s.carrier}${s.flight} ${s.dep}-${s.arr} ${s.status}${s.cabin ? " " + s.cabin : ""} Seats: ${(s.seats || []).filter(Boolean).join(", ") || "N/A"}</div>`).join("");
  const fare = pnr.fare ? `<div class="mono">BASE+TAX: ${pnr.fare.currency} ${pnr.fare.total.toFixed(2)}</div><div class="mono">TOTAL (WITH MARKUP/ANCILLARIES): ${pnr.fare.currency} ${displayTotal(pnr).toFixed(2)}</div>` : "";
  const ssrList = (pnr.ssrs || []).map(s => `<div class="mono">&bull; SSR ${s.type} ${s.text}</div>`).join("");
  const contacts = pnr.contacts || {};
  const contactList = Object.entries(contacts).filter(([, v]) => v).map(([k, v]) => `<div class="mono">&bull; ${k.toUpperCase()}: ${v}</div>`).join("");
  const ancillaryList = (pnr.ancillaries || []).map(a => `<div class="mono">&bull; ${a.type} ${a.text} - EUR ${a.price.toFixed(2)}</div>`).join("");
  const tickets = (pnr.tickets || []).map((t, i) => `<div class="mono">${i+1}. ${t.number} ${pnr.passengers[t.passengerIndex]?.name || ""} (${t.status || "O"} - ${ticketStatusLabel(t.status)})</div>`).join("");
  return `<div class="itinerary"><h2>Itinerary: ${pnr.recordLocator || "UNSAVED"}</h2><hr><strong>Passengers</strong>${paxList}<hr><strong>Flights</strong>${segs}<hr><strong>Contacts</strong>${contactList || '<div class="mono">NONE</div>'}<hr><strong>Fare</strong>${fare}<hr><strong>Services</strong>${ssrList}<hr><strong>Ancillaries</strong>${ancillaryList || '<div class="mono">NONE</div>'}<hr><strong>Tickets</strong>${tickets || '<div class="mono">NONE</div>'}</div>`;
}

// --- PNR & PROFILE MANAGEMENT ---
function createEmptyPNR() {
  return {
    recordLocator: "", passengers: [], segments: [], ssrs: [], remarks: [],
    confidentialRemarks: [], itineraryRemarks: [],
    history: [`CREATED BY M.A. KAHAR / DONABIL SAS`], status: "ACTIVE", ancillaries: [],
    contacts: {}, tst: [], tickets: [], markup: null,
    validatingCarrier: null, formOfPayment: null, commission: null,
    security: [], tourCode: null, endorsementOverride: null, ticketingArrangement: null,
  };
}
function newPNR() { AMX.state.pnr = createEmptyPNR(); return AMX.state.pnr; }
function copyPnrVariant(mode) {
  const pnr = ensurePNR();
  if (!pnr.recordLocator) return writeLine("CANNOT COPY AN UNSAVED PNR", "err");
  const newPnr = createEmptyPNR();
  if (mode === "FULL" || mode === "ITINERARY") {
    newPnr.segments = JSON.parse(JSON.stringify(pnr.segments));
    newPnr.contacts = { ...pnr.contacts };
  }
  if (mode === "FULL" || mode === "PASSENGERS") {
    newPnr.passengers = JSON.parse(JSON.stringify(pnr.passengers));
    newPnr.contacts = { ...pnr.contacts };
  }
  newPnr.history.push(`COPIED (${mode}) FROM PNR ${pnr.recordLocator}`);
  AMX.state.pnr = newPnr;
  addHistory(pnr, `COPIED PNR (${mode}) TO NEW BOOKING`);
  writeLine(`PNR COPIED (${mode}). SAVE THE NEW BOOKING WITH ER.`, "ok");
  writeHTML(renderItineraryHTML(newPnr));
}
function ensurePNR() { return AMX.state.pnr || newPNR(); }
function addHistory(pnr, text, code) { if (pnr) pnr.history.push(`${fmt.nowTime()} ${code ? "[" + code + "] " : ""}${text}`); }
function savePNR(pnr) { if (pnr?.recordLocator) localStorage.setItem(`pnr_${pnr.recordLocator}`, JSON.stringify(pnr)); }
function loadPNR(locator) { const data = localStorage.getItem(`pnr_${locator}`); return data ? JSON.parse(data) : null; }
function randomLocator() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function allStoredPNRs() {
  const list = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("pnr_")) {
      try { list.push(JSON.parse(localStorage.getItem(key))); } catch (e) { /* skip corrupt entry */ }
    }
  }
  return list;
}
function buildElementList(pnr) {
  const items = [];
  pnr.passengers.forEach((p, i) => items.push({ kind: "NM", idx: i, label: `NM ${p.name}` }));
  pnr.segments.forEach((s, i) => items.push({ kind: "SEG", idx: i, label: `${s.date} ${s.from}${s.to} ${s.carrier}${s.flight} ${s.status}` }));
  (pnr.ssrs || []).forEach((s, i) => items.push({ kind: "SSR", idx: i, label: `SSR ${s.type} ${s.text}` }));
  (pnr.remarks || []).forEach((r, i) => items.push({ kind: "RM", idx: i, label: r }));
  return items;
}
function pnrTstLatest(pnr) { return pnr.tst && pnr.tst.length ? pnr.tst[pnr.tst.length - 1] : null; }
function loadProgress() {
  try { return JSON.parse(localStorage.getItem("dtx_progress")) || { completed: [] }; } catch (e) { return { completed: [] }; }
}
function saveProgress(p) { localStorage.setItem("dtx_progress", JSON.stringify(p)); }
function markScenarioComplete(title) {
  const progress = loadProgress();
  if (!progress.completed.includes(title)) {
    progress.completed.push(title);
    saveProgress(progress);
  }
}
function baggageAllowanceFor(cabin) {
  return ["F", "J", "C", "D"].includes(cabin) ? "2PC (32KG EACH)" : "1PC (23KG)";
}
function generateSeatMap(cabin) {
  const business = ["F", "J", "C", "D"].includes(cabin);
  const letters = business ? ["A", "C", "D", "F"] : ["A", "B", "C", "D", "E", "F"];
  const startRow = business ? 1 + Math.floor(Math.random() * 2) : 10 + Math.floor(Math.random() * 8);
  const rowCount = business ? 4 : 7;
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const seats = {};
    letters.forEach(l => { seats[l] = Math.random() < 0.55 ? "X" : "O"; });
    rows.push({ row: startRow + r, seats });
  }
  return { letters, rows };
}
function buildTicketPrintHTML(pnr) {
  const airline = AMX.state.world.airlines.find(a => a.code === pnr.validatingCarrier);
  const carrierName = airline ? airline.name : (pnr.validatingCarrier || "VALIDATING CARRIER NOT SET");
  const tst = pnrTstLatest(pnr);
  const paxRows = pnr.passengers.map((p, i) => {
    const ticket = pnr.tickets.find(t => t.passengerIndex === i);
    const status = ticket ? ticketStatusLabel(ticket.status) : "NOT ISSUED";
    return `<tr><td>${p.name}</td><td>${p.type}</td><td>${ticket ? ticket.number : "&mdash;"}</td><td>${status}</td></tr>`;
  }).join("");
  const segRows = pnr.segments.map((s, i) => `
    <tr>
      <td>${i + 1}</td><td>${s.date}</td><td>${s.carrier}${s.flight}</td><td>${s.cabin || ""}</td>
      <td>${s.from} &rarr; ${s.to}</td><td>${s.dep}-${s.arr}</td><td>${s.status}</td>
      <td>${baggageAllowanceFor(s.cabin)}</td>
    </tr>`).join("");
  const fare = pnr.fare;
  const fareRows = fare ? `
    <tr><td>Fare (${tst?.fareBasis || ""})</td><td>${fare.currency} ${fare.base.toFixed(2)}</td></tr>
    ${(tst?.taxBreakdown || []).map(tb => `<tr><td>Tax ${tb.code}</td><td>${fare.currency} ${tb.amount.toFixed(2)}</td></tr>`).join("")}
    ${pnr.markup ? `<tr><td>Agency Service Fee</td><td>${fare.currency} ${markupAmount(pnr).toFixed(2)}</td></tr>` : ""}
    ${(pnr.ancillaries || []).map(a => `<tr><td>${a.text}</td><td>${fare.currency} ${a.price.toFixed(2)}</td></tr>`).join("")}
    <tr class="total"><td>Total</td><td>${fare.currency} ${displayTotal(pnr).toFixed(2)}</td></tr>
  ` : `<tr><td colspan="2">Not priced</td></tr>`;
  const fop = pnr.formOfPayment
    ? (pnr.formOfPayment.type === "CC" ? `${pnr.formOfPayment.card} ****${pnr.formOfPayment.number.slice(-4)}` : pnr.formOfPayment.type)
    : "NOT ON FILE";

  return `<!doctype html><html><head><meta charset="utf-8"><title>E-Ticket ${pnr.recordLocator || ""}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; background: #fff; color: #2B2620; margin: 0; padding: 32px; }
  .receipt { max-width: 760px; margin: 0 auto; border: 2px solid #2B2620; padding: 28px 32px; }
  .r-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px dashed #2B2620; padding-bottom: 16px; margin-bottom: 16px; }
  .r-head h1 { font-size: 1.15rem; letter-spacing: 0.06em; margin: 0 0 6px; text-transform: uppercase; }
  .r-head .sub { font-size: 0.75rem; color: #5b5346; }
  .r-locator { text-align: right; }
  .r-locator .code { font-size: 1.7rem; font-weight: bold; letter-spacing: 0.1em; }
  h2.r-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #5b5346; margin: 20px 0 8px; border-bottom: 1px solid #cfc6b3; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 6px; }
  table td, table th { padding: 6px 4px; text-align: left; border-bottom: 1px dotted #cfc6b3; }
  table.fare td:last-child { text-align: right; }
  table.fare tr.total td { border-top: 2px solid #2B2620; border-bottom: none; font-weight: bold; padding-top: 8px; }
  .fc-line { font-size: 0.78rem; background: #f3efe4; padding: 6px 8px; border: 1px solid #cfc6b3; letter-spacing: 0.02em; margin-bottom: 6px; }
  .endorsement { font-style: italic; margin-top: 2px; }
  .r-foot { margin-top: 24px; text-align: center; }
  .barcode { height: 34px; background: repeating-linear-gradient(90deg, #2B2620 0 2px, transparent 2px 5px); margin: 0 auto 10px; width: 80%; }
  .disclaimer { font-size: 0.68rem; color: #5b5346; line-height: 1.5; }
  @media print { body { padding: 0; } .receipt { border: none; max-width: none; } }
</style></head>
<body>
  <div class="receipt">
    <div class="r-head">
      <div>
        <h1>${carrierName}</h1>
        <div class="sub">Electronic Ticket / Itinerary Receipt</div>
        <div class="sub">Issued: ${fmt.nowDate()} &middot; Office: ${AMX.state.office} &middot; Agent: ${AMX.state.agent}</div>
      </div>
      <div class="r-locator">
        <div class="sub">Booking Reference</div>
        <div class="code">${pnr.recordLocator || "UNSAVED"}</div>
      </div>
    </div>

    <h2 class="r-title">Passengers &amp; Tickets</h2>
    <table><thead><tr><th>Name</th><th>Type</th><th>Ticket Number</th><th>Status</th></tr></thead><tbody>${paxRows || '<tr><td colspan="4">No passengers</td></tr>'}</tbody></table>

    <h2 class="r-title">Flight Itinerary</h2>
    <table><thead><tr><th>#</th><th>Date</th><th>Flight</th><th>Cl</th><th>Route</th><th>Time</th><th>Status</th><th>Baggage</th></tr></thead><tbody>${segRows || '<tr><td colspan="8">No segments</td></tr>'}</tbody></table>

    <h2 class="r-title">Fare Breakdown</h2>
    <table class="fare"><tbody>${fareRows}</tbody></table>
    <div class="sub">Form of Payment: ${fop}</div>

    ${tst ? `
    <h2 class="r-title">Fare Calculation</h2>
    <div class="fc-line">FC ${tst.fareCalc}</div>
    <div class="sub">Fare Basis ${tst.fareBasis} &middot; Not Valid Before ${tst.nvb} &middot; Not Valid After ${tst.nva}</div>
    <div class="sub endorsement">${pnr.endorsementOverride || tst.endorsement}</div>
    ${pnr.tourCode ? `<div class="sub">Tour Code: ${pnr.tourCode}</div>` : ""}
    ` : ""}

    <div class="r-foot">
      <div class="barcode"></div>
      <div class="disclaimer">This receipt is not a boarding pass. Please check in with your carrier and present valid identification.<br/>Generated by DonaTrainer &mdash; an educational Amadeus GDS simulator by Donabil SAS. Not affiliated with any GDS or airline.</div>
    </div>
  </div>
</body></html>`;
}
function markupAmount(pnr) {
  if (!pnr.markup || !pnr.fare) return 0;
  return pnr.markup.type === "A" ? pnr.markup.value : pnr.fare.total * (pnr.markup.value / 100);
}
function ancillaryTotal(pnr) { return (pnr.ancillaries || []).reduce((sum, a) => sum + (a.price || 0), 0); }
function displayTotal(pnr) { return pnr.fare ? pnr.fare.total + markupAmount(pnr) + ancillaryTotal(pnr) : 0; }
function maybeTriggerIROPS(pnr) {
  if (!pnr || !pnr.segments.length) return false;
  if (Math.random() >= 0.2) return false;
  const idx = Math.floor(Math.random() * pnr.segments.length);
  const seg = pnr.segments[idx];
  if (seg.status === "SC") return false;
  seg.status = "SC";
  addHistory(pnr, `SCHEDULE CHANGE ON SEGMENT ${idx + 1} (${seg.carrier}${seg.flight})`, "TC");
  if (pnr.recordLocator) placeOnQueue("5", pnr.recordLocator, "C1");
  if (pnr.recordLocator) savePNR(pnr);
  return true;
}
function maybeExpireXL(pnr) {
  if (!pnr || pnr.ticketingArrangement?.type !== "XL" || pnr.tickets?.length) return false;
  const limit = parseDDMMM(pnr.ticketingArrangement.date);
  if (!limit || new Date() <= limit) return false;
  pnr.segments = [];
  pnr.status = "CANCELLED";
  addHistory(pnr, `AUTO-CANCELLED - TKXL LIMIT ${pnr.ticketingArrangement.date} PASSED WITHOUT TICKETING`, "XS");
  if (pnr.recordLocator) savePNR(pnr);
  return true;
}

// --- DYNAMIC ENGINE ---
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function flightDurationMinutes(a, b) {
  const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
  return Math.max(35, Math.round((dist / 850 * 60 + 40) / 5) * 5);
}
function addMinutesToClock(hour, min, durationMin) {
  const total = hour * 60 + min + durationMin;
  const dayOffset = Math.floor(total / 1440);
  const clock = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(clock / 60), min: clock % 60, dayOffset };
}
// Seeded PRNG so the same AN query always returns the same "schedule" instead
// of a fresh random draw every time (mockAvailability swaps this in/out).
let _rand = Math.random;
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}
function randomClasses(distanceKm) {
  const longHaul = distanceKm > 3500;
  const letters = longHaul ? ["J","C","D","Y","M","K","B","H"] : ["J","Y","M","K","B","H"];
  const count = 4 + Math.floor(_rand() * 3);
  const chosen = letters.slice(0, Math.min(count, letters.length));
  return chosen.map(l => `${l}${_rand() < 0.15 ? 0 : Math.floor(_rand() * 9) + 1}`).join(" ");
}
function classAvailable(classesStr, letter) {
  const token = (classesStr || "").split(" ").find(t => t[0] === letter);
  if (!token) return true;
  return parseInt(token.slice(1), 10) > 0;
}
function findAirport(code) { return AMX.state.world.airports.find(a => a.code === code); }
function buildLeg(date, from, to, carrier) {
  const a = findAirport(from), b = findAirport(to);
  const duration = (a && b) ? flightDurationMinutes(a, b) : 120;
  const distanceKm = (a && b) ? haversineKm(a.lat, a.lon, b.lat, b.lon) : 800;
  const depHour = 6 + Math.floor(_rand() * 15);
  const depMin = [0, 15, 30, 45][Math.floor(_rand() * 4)];
  const arrival = addMinutesToClock(depHour, depMin, duration);
  return {
    date: fmtDDMMM(date), from, to, carrier,
    flight: String(Math.floor(_rand() * 800) + 100),
    dep: `${fmt.pad(depHour)}:${fmt.pad(depMin)}`,
    arr: `${fmt.pad(arrival.hour)}:${fmt.pad(arrival.min)}${arrival.dayOffset ? "+" + arrival.dayOffset : ""}`,
    classes: randomClasses(distanceKm),
    durationMin: duration,
    equipment: distanceKm > 5500 ? "77W" : distanceKm > 2500 ? "789" : "320",
  };
}
function findConnection(from, to, excludeCity) {
  const world = AMX.state.world;
  const firstLegs = world.routes.filter(r => r[0] === from && r[1] !== excludeCity);
  for (const leg1 of firstLegs) {
    const hub = leg1[1];
    if (hub === to) continue;
    const leg2 = world.routes.find(r => r[0] === hub && r[1] === to);
    if (leg2) return { hub, carrier1: leg1[2], carrier2: leg2[2] };
  }
  return null;
}
function mockAvailability(date, from, to, opts = {}) {
  const world = AMX.state.world;
  const seedKey = `${fmtDDMMM(date)}|${from}|${to}|${opts.airlineFilter || ""}|${opts.directOnly ? 1 : 0}|${opts.excludeCity || ""}`;
  const prevRand = _rand;
  _rand = mulberry32(hashString(seedKey));
  try {
    let routes = world.routes.filter(r => r[0] === from && r[1] === to);
    if (opts.airlineFilter) routes = routes.filter(r => r[2] === opts.airlineFilter);

    const lines = [];
    if (routes.length) {
      const carriers = [...new Set(routes.map(r => r[2]))];
      const flightCount = Math.min(carriers.length * 2, 4 + Math.floor(_rand() * 5));
      for (let i = 0; i < flightCount; i++) {
        const carrier = carriers[i % carriers.length];
        const leg = buildLeg(date, from, to, carrier);
        lines.push({ line: i + 1, connection: false, segments: [leg], from, to, carrier });
      }
    } else if (!opts.directOnly) {
      const conn = findConnection(from, to, opts.excludeCity);
      if (conn) {
        const leg1 = buildLeg(date, from, conn.hub, conn.carrier1);
        const leg2 = buildLeg(date, conn.hub, to, conn.carrier2);
        lines.push({ line: 1, connection: true, segments: [leg1, leg2], from, to, carrier: `${conn.carrier1}/${conn.carrier2}` });
      }
    }
    return lines;
  } finally {
    _rand = prevRand;
  }
}
function sortAvailLines(lines, mode) {
  const arr = lines.map(l => ({ ...l }));
  if (mode === "AD") arr.sort((a, b) => a.segments[0].dep.localeCompare(b.segments[0].dep));
  else if (mode === "AA") arr.sort((a, b) => a.segments[a.segments.length - 1].arr.localeCompare(b.segments[b.segments.length - 1].arr));
  else if (mode === "AE") arr.sort((a, b) => a.segments.reduce((s, l) => s + (l.durationMin || 0), 0) - b.segments.reduce((s, l) => s + (l.durationMin || 0), 0));
  arr.forEach((l, i) => l.line = i + 1);
  return arr;
}
function parseAvailArgs(arg) {
  const upper = arg.toUpperCase().trim().replace(/^\//, "");
  const m = upper.match(/^(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})(.*)$/);
  if (!m) return null;
  const [, ddmmm, from, to, rest] = m;
  const dt = parseDDMMM(ddmmm);
  if (!dt) return null;
  const tokens = rest.split("/").filter(Boolean);
  let returnDdmmm = null, airlineFilter = null, directOnly = false, classFilter = null, excludeCity = null;
  tokens.forEach(t => {
    let mm;
    if ((mm = t.match(/^R(\d{1,2}[A-Z]{3})$/))) returnDdmmm = mm[1];
    else if ((mm = t.match(/^A([A-Z0-9]{2,3})$/))) airlineFilter = mm[1];
    else if (t === "D") directOnly = true;
    else if ((mm = t.match(/^C([A-Z])$/))) classFilter = mm[1];
    else if ((mm = t.match(/^X([A-Z]{3})$/))) excludeCity = mm[1];
  });
  return { ddmmm, from, to, dt, returnDdmmm, opts: { airlineFilter, directOnly, classFilter, excludeCity } };
}
function runAvailability(arg, code, label) {
  const q = parseAvailArgs(arg);
  if (!q) return writeLine(`FORMAT: ${code}<DDMMM><FROM><TO>[/R<DDMMM>][/A<CARRIER>][/D][/C<CLASS>][/X<CITY>]`, "err");
  let outLines = mockAvailability(q.dt, q.from, q.to, q.opts);
  if (!outLines.length) return writeLine(`NO FLIGHTS FOUND FOR ${q.from}-${q.to}`, "err");
  if (["AA", "AD", "AE"].includes(code)) outLines = sortAvailLines(outLines, code);
  AMX.state.availability.outbound = outLines;
  AMX.state.lastAvailQuery = { code, ddmmm: q.ddmmm, from: q.from, to: q.to, opts: q.opts };

  writeLine(`** AMADEUS ${label} - ${code} ** ${q.ddmmm} ${q.from}-${q.to}`, "ok");
  outLines.forEach(l => printAvailLine(l));

  if (q.returnDdmmm) {
    const retDt = parseDDMMM(q.returnDdmmm);
    if (!retDt) return writeLine("INVALID RETURN DATE FORMAT", "err");
    let inLines = mockAvailability(retDt, q.to, q.from, q.opts);
    if (["AA", "AD", "AE"].includes(code)) inLines = sortAvailLines(inLines, code);
    AMX.state.availability.inbound = inLines;
    writeLine(`RETURN AVAILABILITY ${q.returnDdmmm} ${q.to}-${q.from}`, "ok");
    inLines.forEach(l => printAvailLine(l));
  }
}
function printAvailLine(l) {
  if (!l.connection) {
    const leg = l.segments[0];
    writeLine(`${l.line}  ${leg.carrier}${leg.flight}  ${leg.from}${leg.to}  ${leg.dep}-${leg.arr}  ${leg.classes}`);
  } else {
    const [leg1, leg2] = l.segments;
    writeLine(`${l.line}  ${leg1.carrier}${leg1.flight}  ${leg1.from}${leg1.to}  ${leg1.dep}-${leg1.arr}  ${leg1.classes}`);
    writeLine(`   ${leg2.carrier}${leg2.flight}  ${leg2.from}${leg2.to}  ${leg2.dep}-${leg2.arr}  ${leg2.classes}  (CONNECTION VIA ${leg1.to})`, "hint");
  }
}

// --- PRICING HELPERS ---
function selectPassengersByScope(pnr, scope) {
  const all = pnr.passengers.map((p, i) => i);
  if (!scope) return all;
  if (scope === "PAX") return all.filter(i => pnr.passengers[i].type !== "INF");
  if (scope === "INF") return all.filter(i => pnr.passengers[i].type === "INF");
  const m = scope.match(/^P(\d+)$/);
  if (m) { const idx = parseInt(m[1], 10) - 1; return pnr.passengers[idx] ? [idx] : []; }
  return all;
}
const CLASS_RATE = { F: 0.42, J: 0.28, C: 0.25, D: 0.22, Y: 0.15, M: 0.12, K: 0.10, B: 0.09, H: 0.085, Q: 0.075 };
const TICKET_STATUS_LABELS = {
  A: "AIRPORT CONTROL", C: "CHECKED IN", E: "EXCHANGED/REISSUED", F: "FLOWN/USED",
  G: "CONVERTED TO FIM", I: "IRREGULAR OPERATIONS", L: "LIFTED/BOARDED", O: "OPEN FOR USE",
  P: "PRINTED", R: "REFUNDED", S: "SUSPENDED", T: "PAPER TICKET", V: "VOID", X: "PRINT EXCHANGED",
};
function ticketStatusLabel(status) { return TICKET_STATUS_LABELS[status] || TICKET_STATUS_LABELS.O; }
const CURRENCY_RATES = { EUR: 1, USD: 1.08, GBP: 0.86, QAR: 3.94, AED: 3.97, SAR: 4.05, INR: 90.5, SGD: 1.46, AUD: 1.66, JPY: 163 };
function classRate(letter) { return CLASS_RATE[letter] || 0.12; }
function segmentDistanceKm(seg) {
  const a = findAirport(seg.from), b = findAirport(seg.to);
  return (a && b) ? haversineKm(a.lat, a.lon, b.lat, b.lon) : 800;
}
function cheapestAvailableClass(seg) {
  const tokens = (seg.classes || "").split(" ").filter(Boolean);
  const available = tokens
    .map(t => ({ letter: t[0], count: parseInt(t.slice(1), 10) || 0 }))
    .filter(t => t.count > 0);
  if (!available.length) return seg.cabin || "Y";
  available.sort((a, b) => classRate(a.letter) - classRate(b.letter));
  return available[0].letter;
}
function segmentFare(seg, lowest) {
  const distanceKm = segmentDistanceKm(seg);
  const cabin = lowest ? cheapestAvailableClass(seg) : (seg.cabin || "Y");
  const base = Math.max(40, classRate(cabin) * distanceKm);
  const tax = Math.min(95, 18 + distanceKm * 0.011);
  return { base, tax, cabin, distanceKm };
}
function computeFare(pnr, idxList, lowest) {
  let totalBase = 0;
  let totalTaxes = 0;
  idxList.forEach(i => {
    const pax = pnr.passengers[i];
    const baseMult = pax.type === "CHD" ? 0.75 : pax.type === "INF" ? 0.10 : 1;
    const taxMult = pax.type === "INF" ? 0.10 : 1;
    pnr.segments.forEach(seg => {
      const { base, tax } = segmentFare(seg, lowest);
      totalBase += base * baseMult;
      totalTaxes += tax * taxMult;
    });
  });
  totalBase = Math.round(totalBase * 100) / 100;
  totalTaxes = Math.round(totalTaxes * 100) / 100;
  return { currency: "EUR", base: totalBase, taxes: totalTaxes, total: Math.round((totalBase + totalTaxes) * 100) / 100, scope: idxList, lowest: !!lowest };
}
function parsePricingScope(arg) { return arg.trim().toUpperCase().replace(/^\//, "") || null; }

// --- FARE CALCULATION / TICKETING FIELDS (real-world IATA/Amadeus ticket fields) ---
function buildFareCalcLine(pnr, fare) {
  if (!pnr.segments.length) return `${fare.currency}${fare.base.toFixed(2)}END`;
  const parts = [pnr.segments[0].from];
  pnr.segments.forEach(s => { parts.push(s.carrier); parts.push(s.to); });
  return `${parts.join(" ")} ${fare.base.toFixed(2)}${fare.currency}${fare.base.toFixed(2)}END`;
}
function buildTaxBreakdown(pnr, fare) {
  if (!fare.taxes) return [];
  const first = pnr.segments[0];
  const last = pnr.segments[pnr.segments.length - 1];
  const origCountry = first ? findAirport(first.from)?.country : null;
  const destCountry = last ? findAirport(last.to)?.country : null;
  const yq = Math.round(fare.taxes * 0.35 * 100) / 100;
  const remaining = Math.round((fare.taxes - yq) * 100) / 100;
  const half = Math.round((remaining / 2) * 100) / 100;
  const otherHalf = Math.round((remaining - half) * 100) / 100;
  return [
    { code: origCountry || "XT", amount: half },
    { code: destCountry || "XY", amount: otherHalf },
    { code: "YQ", amount: yq },
  ].filter(t => t.amount > 0);
}
function fareBasisCode(pnr) {
  const cabin = pnr.segments[0]?.cabin || "Y";
  const roundTrip = pnr.segments.length > 1 && pnr.segments[0].from === pnr.segments[pnr.segments.length - 1].to;
  return `${cabin}${roundTrip ? "RT" : "OW"}`;
}
function ticketEndorsement(fare) {
  return fare.lowest ? "NONREFUNDABLE/NO MISCONNECT GUARANTEE" : "CHANGES PERMITTED WITH FEE/REFUNDABLE";
}
function decorateFare(pnr, fare) {
  fare.fareCalc = buildFareCalcLine(pnr, fare);
  fare.fareBasis = fareBasisCode(pnr);
  fare.taxBreakdown = buildTaxBreakdown(pnr, fare);
  fare.endorsement = ticketEndorsement(fare);
  fare.nvb = pnr.segments[0]?.date || "";
  fare.nva = pnr.segments[pnr.segments.length - 1]?.date || pnr.segments[0]?.date || "";
  return fare;
}
function printTicketBlock(pnr, ticket) {
  const pax = pnr.passengers[ticket.passengerIndex];
  const tst = (pnr.tst || []).find(t => t.id === ticket.tstId) || pnrTstLatest(pnr);
  const st = ticket.status || "O";
  writeLine(`ETKT ${ticket.number}  ${st} - ${ticketStatusLabel(st)}${ticket.reissueOf ? "  (REISSUE OF " + ticket.reissueOf + ")" : ""}`, st === "O" ? "ok" : "err");
  writeLine(`  1.${pax?.name || "UNKNOWN"}`, "hint");
  pnr.segments.forEach((s, i) => {
    writeLine(`  ${i + 1} O ${s.carrier} ${s.flight} ${s.cabin || ""} ${s.date} ${s.from}${s.to} ${s.status}1  ${s.dep} ${s.arr}  E  ${baggageAllowanceFor(s.cabin)}`, "hint");
  });
  if (tst) {
    writeLine(`  FARE F ${tst.currency} ${tst.base.toFixed(2)}${tst.netFare != null ? "  NETFARE " + tst.currency + " " + tst.netFare.toFixed(2) : ""}`, "hint");
    (tst.taxBreakdown || []).forEach(tb => writeLine(`  TAX      ${tb.amount.toFixed(2)}${tb.code}`, "hint"));
    writeLine(`  TOTAL    ${tst.currency} ${displayTotal(pnr).toFixed(2)}`, "hint");
    writeLine(`  FC ${tst.fareCalc}`, "hint");
    writeLine(`  FB ${tst.fareBasis}  NVB${tst.nvb}  NVA${tst.nva}`, "hint");
    writeLine(`  FE ${pnr.endorsementOverride || tst.endorsement}`, "hint");
    if (pnr.tourCode) writeLine(`  FT ${pnr.tourCode}`, "hint");
    if (tst.additionalCollection != null) writeLine(`  ADDITIONAL COLLECTION ${tst.currency} ${tst.additionalCollection.toFixed(2)}`, "hint");
  }
  const fopText = pnr.formOfPayment
    ? (pnr.formOfPayment.type === "CC" ? `CC ${pnr.formOfPayment.card} ****${pnr.formOfPayment.number.slice(-4)}` : pnr.formOfPayment.type)
    : "NOT ON FILE";
  writeLine(`  FP ${fopText}`, "hint");
  writeLine(`  ISSUED ${ticket.issuedAt}  ${AMX.state.office}  AGENT ${AMX.state.agent}`, "hint");
}

// --- QUEUE HELPER ---
function ensureQueue(n) {
  if (!AMX.state.queues[n]) AMX.state.queues[n] = { name: `QUEUE ${n}`, pnrs: [], categories: {} };
  if (!AMX.state.queues[n].categories) AMX.state.queues[n].categories = {};
  return AMX.state.queues[n];
}
function placeOnQueue(n, locator, category) {
  const q = ensureQueue(n);
  if (!q.pnrs.includes(locator)) q.pnrs.push(locator);
  q.categories[locator] = category || "C1";
  return q;
}
function queueCategory(q, locator) { return (q.categories && q.categories[locator]) || "C1"; }

// --- HELP TOPICS ---
const HELP_TOPICS = {
  AN: "AN<DDMMM><FROM><TO>[/R<DDMMM>][/A<CARRIER>][/D][/C<CLASS>][/X<CITY>] - Neutral availability display. /R adds a return date, /A filters one airline, /D shows direct flights only, /C focuses on a class, /X excludes a connection city.",
  NAME: "NM1<SURNAME>/<FIRSTNAME> <TITLE> adds the passenger name element. Append (CHD/DDMMMYY) for a child or (INF/INFANTNAME/DDMMMYY) for an infant travelling on an adult's lap.",
  STEPS: "PNR creation order: AN (availability) > SS (sell) > NM (name) > AP/APE (contact) > TKOK (ticketing arrangement) > RF (received from) > ER (save).",
  RT: "RT<LOCATOR> retrieves a PNR. RT/<SURNAME> searches by exact surname, RT/<PARTIAL> by partial surname (numbered list - select with RT<n>). Bare RT redisplays the active PNR. Retrieval occasionally triggers a random schedule change (IROPS), queuing the PNR to queue 5.",
  NU: "NU<OLD#>/<NEW#><SURNAME>/<FIRSTNAME> [TITLE] updates a passenger's name in the active PNR.",
  SP: "SP <PAX NUMBER>[,<PAX NUMBER>...] splits the listed passengers (and the shared itinerary) into a new, unsaved PNR - save it with ER.",
  PRICING: "Fares are calculated from real distance and booking class, not a flat number - a short hop in K class prices far below a long-haul in J. FXX/FXR display a fare without storing it; FXP/FXB store it as a TST. FXR/FXB also re-check the class actually open on file and use the cheapest one available, same as a real lowest-fare search. Add /P1, /PAX or /INF to price a subset of passengers.",
  FXP: "FXP prices the active itinerary and stores the result as a TST, including the fare calculation (FC) line, fare basis, tax breakdown by code, and NVB/NVA validity dates. Use /P1 for passenger 1 only, /PAX for adults+children, /INF for the infant only.",
  FXD: "FXD<FROM><TO> (or FXD<N><FROM><TO>) runs the Master Pricer and returns a ranked list of fare recommendations for the city pair.",
  FQD: "FQD<FROM><TO>[/A<CARRIER>][/C<CLASS>][/D<DDMMM>][/R,-CH|/R,-INF] displays fares for a city pair without needing a PNR.",
  FQP: "FQP<FROM>/A<CARRIER>/D<DDMMM><TO>[/R,-CH|/R,-INF] prices a specific itinerary without creating a PNR. Chain a second leg with --- for a connection.",
  FP: "FP sets the form of payment: FP CASH, FP INV, or FP CC <VI|CA|AX> <CARDNUMBER>/<MMYY>. Required before ticketing.",
  FCM: "FCM-A<AMOUNT> adds a flat agency markup; FCM-C<PERCENT> adds a percentage markup. Applied on top of the priced fare when displayed or ticketed.",
  SERVICES: "SVC <DESCRIPTION> <PRICE> records an ancillary service (bag, seat upgrade, etc.) against the PNR and adds it to the displayed total.",
  BESTBUY: "FXA lists lower fares without rebooking; FXU<n> selects one and stores a TST; FXZ<n> selects one without storing a TST; FXL shows the lowest applicable fare regardless of availability, warning LOWEST SOLD OUT // TRY WAITLIST if it isn't actually open.",
  TTP: "TTP issues tickets from the active TST. Requires a validating carrier (FV) and a form of payment (FP) on file. TTP/P1, TTP/PAX and TTP/INF scope the issuance. Each ticket prints a full coupon block: FA/segment lines, FARE/TAX/TOTAL, FC (fare calculation), FB (fare basis) with NVB/NVA, and FE (endorsement).",
  TWD: "TWD displays the current e-ticket's full coupon block (segments, fare, FC, FB, FE). TWD/L<n> selects by line, TWD/TKT<number> by ticket number, TWD/TAX shows the tax breakdown by code, TWH shows the ticket's history.",
  TJQ: "TJQ lists issued tickets. /D-<DDMMM> filters a date, /D-<DDMMM><DDMMM> a range, /SOF/QVP-<CARRIER> an airline, /SOF/QTC-RFND voids only.",
  TWX: "TWX voids the ticket last displayed with TWD (or select one with /L<n> / /TKT<number>). Cannot void a reissued (status E) ticket. Prints a SAC settlement code, same as a real void.",
  QUEUES: "QE<n>[C<c>] places the active PNR on queue n (optionally a category). QT<n>[C<c>] opens a queue for browsing, filtered to a category if given. QC<n>CA counts every category on queue n; QC<n>C<c> counts one. QN actions the current PNR and advances. QD delays it to the bottom. QI exits. QTQ shows total counts.",
  PROFILES: "PM/PME/PMP enter, exit, and temporarily suspend profile mode. PC/-<n> drafts a profile from PNR passenger n. PIN/<name> names it and PER (or PEE to also exit) saves it. PI/PIR ignore the draft. PDI/<index> or PDN/-<surname> retrieves one, PD redisplays it, PT transfers it into the active PNR. PCN//PBC//PBP//PCO//PBD/ set company/billing/country/birth-date fields on the draft.",
  IEP: "IEP-EML-<address> emails the itinerary once; IEPJ-EML-<address> emails it for every passenger; IEP-EMLA sends it to the email already stored in the PNR (simulated - no real email is sent).",
  DECODE: "DAN <text> looks up a code from a city/airport name. DAC <code> decodes an airport or country code. DC <code> decodes a country code both ways. DNA <code> decodes an airline code to its name and numeric code.",
  GG: "GG APT <code> / GG COU <code> / GG AIR <code> are Amadeus Information System (AIS) style reference lookups for an airport, country, or airline already on file.",
  DATETIME: "DD alone shows the system time. DD<DDMMM> gives the day of week for a date. DD<DDMMM>/<N> and DD<DDMMM>/-<N> add or subtract N days. DD<DDMMM1>/<DDMMM2> gives the number of days between two dates. DD<CITY> estimates local time from that airport's longitude. DF<A>;<B>, DF<A>-<B>, DF<A>*<B>, DF<A>/<B> and DF<BASE>P<PERCENT> are the add/subtract/multiply/divide/percentage calculator.",
  SIGNIN: "JI signs in (JJ for practice mode); JO signs out and blocks further commands except JI/HE until you sign back in. JD shows work-area status, JB redisplays the welcome message. RE/RE2 recall your last (or second-last) entry without re-running it. PV shows the office profile.",
  SCHEDULE: "SN is a schedule display (like AN, but reflects every scheduled flight rather than only open inventory). AA/AD/AE re-sort the same availability by arrival, departure, or elapsed flight time. AC/SC modify the last AN/SN query's date, city, or carrier without retyping it. MN/MY replay it for the next/previous day. DO<CARRIER><FLIGHT>[/<DDMMM>] shows flight information (equipment, times, status).",
  DIRECTACCESS: "1<CARRIER>AD<DDMMM><FROM><TO> (e.g. 1EKAD12SEPDOHDXB) opens a direct-access link straight into that carrier's own inventory, numbered from line 21 as in a real display.",
  RECONFIRM: "<segment#>/RR reconfirms a segment (e.g. 3/RR sets segment 3 to status RR). Other status codes (HK, HL, SC, SS) work the same way.",
  OPENSEG: "SO<CARRIER><CLASS><DDMMM><FROM><TO> adds an open segment (flight/time unknown, status OPEN) so an itinerary can still be priced and ticketed. SIARNK[<DDMMM>] adds an Arrival-Unknown marker segment to bridge a gap in the itinerary.",
  OP: "OP[<DDMMM>]/<free text> places the active, saved PNR on the general option queue (queue 0), optionally for a specific date.",
  FHE: "FHE<CARRIER><3-DIGIT NUMERIC><10-DIGIT DOCUMENT>[/S<SEGS>][/P<PAX#>] manually inserts a ticket number when the system didn't (or shouldn't) auto-issue one.",
  PRINTING: "WRA prints the entire active PNR (same as ITR/P); WRS prints just the first screen (the itinerary display) without the popup ticket receipt.",
  HISTORYCODES: "RH shows the active PNR's history, each line tagged in brackets with the same element codes a real Amadeus history uses - e.g. [AN] Added Name, [AS] Added a status/segment element, [AT] Added Ticketing Arrangement, [CN] Changed Name, [CS] Changed Status, [DL] Deleted Element, [SP] Split Party, [TC] Time Change, [OA] Added OSI, [SA] Added SSR, [AR] Added Remark, [AO] Added Option, [CF] Changed Fare Element, [AE] Added Security Element, [XE] Cancelled Security Element, [XS] Cancelled a status element.",
  SECURITY: "ES<OFFICE ID>-<R|B|N> adds a PNR security element (Read / Read+Write / No access) for another office. ESD displays them, ESX<n> cancels one.",
  COPY: "RRN copies the full PNR (names + itinerary) into a new, unsaved booking. RRI copies only the itinerary (add new names). RRP copies only the passengers (add a new itinerary).",
  FAREQUOTE: "After FQD, follow-up entries reference a printed line number: FQN<n> fare rules, FQK<n> tax breakdown, FQR<n> routing, FQS<n> booking-class info. Standalone: FQC converts currency (FQC100GBP or FQC100GBP/USD), FQA lists the rate-of-exchange table, FQX<FROM><TO>/<KG> prices excess baggage, FQM<FROM><TO>[<TO2>...] calculates mileage.",
  TICKETING: "TTK follow-up entries edit the active TST: /NF-<amt> net fare, /V<DDMMM><DDMMM> validity dates, /F<amt> fare override, /X<amt><taxcode> add a tax, /T<amt> additional collection (prefix /T<n>/ to target one TST by number). FE <text> sets the endorsement and FT <tourcode> sets the tour code, both printed on TWD/TTP/ITR-P. TTU/T<n>/S<segs> flags a TST's segments for reissue; TTF clears a TST's change flag.",
  ETRV: "TTP/ETRV/L<n> revalidates ticket line n after a segment change with no fare impact (status stays O, no new ticket issued) - use it instead of a full reissue when nothing but the flight/date/class actually changed.",
  REISSUE: "To reissue: rebook (SB), re-price the new segments (FXP), pull the original ticket's issue data with FO*L<n> (the line of the ticket being replaced), set the additional collection with TTK/T<amount>, then TTP as usual. The original ticket flips to status E (exchanged) and the new ticket prints a REISSUE OF line.",
  REFUND: "TRF[/L<n>] opens a refund record for a ticket (prints fare paid and the default cancellation fee). TRFU/CP<amt>[A] adjusts the penalty (A = amount, omit for percent); TRFU/U<amt> sets the fare already used for a partial refund. TRFT shows the refundable tax breakdown. TRFP finalizes it (status becomes R). TRFIG discards the draft instead.",
  BSP: "TGBD-<ISO country code> lists BSP/Area Reporting Plan participants for that country. TGAD-<carrier>[/<carrier2>] shows (or checks) a ticketing/interline agreement.",
  TKTL: "TKOK confirms a ticket will be issued with no time limit. TKTL<DDMMM>/<HHMM> sets a ticketing time limit and auto-queues the PNR to queue 8 category C1 when saved. TKXL<DDMMM> auto-cancels the itinerary if it's still unticketed once that date passes (checked on retrieval).",
  LP: "LP/<CARRIER><FLIGHT>/<DDMMM>[-<FROM><TO>] lists every saved PNR carrying that flight and date - select a passenger with RT<n> like any other name search.",
  RTFILTER: "With a PNR already active, a bare one-letter RT follow-up filters the display to one element type: RTN/RTP names, RTA/RTI/RTW segments, RTG SSR/OSI, RTJ contacts, RTK ticketing, RTR remarks, RTB itinerary remarks, RTTN ticket numbers.",
};

// --- COMMAND IMPLEMENTATIONS ---
const commands = {
  // Session & Reference
  JI: (arg) => {
    AMX.state.signedIn = true;
    const m = arg.trim().match(/^\*?\s*([A-Z0-9]{4,7})\/([A-Z]{2})/i);
    if (m) AMX.state.agent = m[1].toUpperCase();
    writeLine(`SIGNED IN - OFFICE ${AMX.state.office} - AGENT ${AMX.state.agent}`, "ok");
  },
  JJ: (arg) => { commands.JI(arg); writeLine("PRACTICE TRAINING MODE", "hint"); },
  JO: () => {
    AMX.state.signedIn = false;
    writeLine("SIGNED OUT. ENTER JI TO SIGN BACK IN.", "ok");
  },
  JD: () => {
    writeLine("WORK AREA STATUS", "ok");
    writeLine(`OFFICE ${AMX.state.office}   AGENT ${AMX.state.agent}   TM PRD   SG AS   STATUS ${AMX.state.signedIn ? "SIGNED IN" : "SIGNED OUT"}`, "hint");
    writeLine(`DT ${fmt.nowDate()}   LG ${fmt.nowTime()}`, "hint");
  },
  JB: () => {
    writeLine("WELCOME TO DONATRAINER - AN EDUCATIONAL AMADEUS GDS SIMULATOR", "ok");
    writeLine(`OFFICE ${AMX.state.office}   AGENT ${AMX.state.agent}`, "hint");
  },
  RE: () => {
    const hist = AMX.state.commandHistory;
    if (!hist.length) return writeLine("NO PREVIOUS ENTRY", "err");
    writeLine(`RECALL: ${hist[0]}`, "hint");
  },
  RE2: () => {
    const hist = AMX.state.commandHistory;
    if (hist.length < 2) return writeLine("NO ENTRY THAT FAR BACK", "err");
    writeLine(`RECALL: ${hist[1]}`, "hint");
  },
  PV: () => {
    writeLine(`OFFICE PROFILE - ${AMX.state.office}`, "ok");
    writeLine(`ANC Y (TICKETING AUTHORITY)   AGT ${AMX.state.agent}   PCC TRN1`, "hint");
  },
  GG: (arg) => {
    const parts = arg.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const [sub, code] = parts;
    if (sub === "APT" && code) {
      const a = findAirport(code);
      if (!a) return writeLine("AIRPORT NOT FOUND", "err");
      return writeLine(`${a.code}  ${a.city}, ${a.name} (${a.country})`, "ok");
    }
    if (sub === "COU" && code) {
      const c = (AMX.state.world.countries || []).find(c => c.code === code);
      if (!c) return writeLine("COUNTRY NOT FOUND", "err");
      return writeLine(`${c.code}  ${c.name}`, "ok");
    }
    if (sub === "AIR" && code) {
      const al = AMX.state.world.airlines.find(a => a.code === code);
      if (!al) return writeLine("AIRLINE NOT FOUND", "err");
      const routeCount = AMX.state.world.routes.filter(r => r[2] === code).length;
      return writeLine(`${al.name} (${al.code}/${al.numeric}) - ${routeCount} ROUTES ON FILE`, "ok");
    }
    writeLine("FORMAT: GG APT <CODE> | GG COU <CODE> | GG AIR <CODE>", "err");
  },
  DD: (arg) => {
    const DOW = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    const a = arg.trim().toUpperCase();
    if (!a) return writeLine(`SYSTEM TIME IS ${fmt.nowTime()} ON ${DOW[new Date().getDay()]}${fmt.nowDate()}`, "ok");
    let m;
    if ((m = a.match(/^(\d{1,2}[A-Z]{3}\d{0,4})\/(\d{1,2}[A-Z]{3}\d{0,4})$/))) {
      const d1 = parseDDMMM(m[1]), d2 = parseDDMMM(m[2]);
      if (!d1 || !d2) return writeLine("INVALID DATE", "err");
      const days = Math.round((d2 - d1) / 86400000);
      return writeLine(String(Math.abs(days)), "ok");
    }
    if ((m = a.match(/^(\d{1,2}[A-Z]{3}\d{0,4})\/(-?)(\d+)$/))) {
      const d1 = parseDDMMM(m[1]);
      if (!d1) return writeLine("INVALID DATE", "err");
      const delta = (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10);
      const result = new Date(d1.getTime() + delta * 86400000);
      return writeLine(`${DOW[result.getUTCDay()]}${fmtDDMMM(result)}${String(result.getUTCFullYear()).slice(-2)}`, "ok");
    }
    if ((m = a.match(/^(\d{1,2}[A-Z]{3}\d{0,4})$/))) {
      const d1 = parseDDMMM(m[1]);
      if (!d1) return writeLine("INVALID DATE", "err");
      return writeLine(`${DOW[d1.getUTCDay()]}${fmtDDMMM(d1)}${String(d1.getUTCFullYear()).slice(-2)}`, "ok");
    }
    const airportMatches = AMX.state.world.airports.filter(ap => ap.city.includes(a));
    if (airportMatches.length) {
      const ap = airportMatches[0];
      const offset = Math.round((ap.lon || 0) / 15);
      const utcNow = new Date();
      const local = new Date(utcNow.getTime() + offset * 3600000);
      return writeLine(`${ap.city} TIME IS ${fmt.pad(local.getUTCHours())}:${fmt.pad(local.getUTCMinutes())} (UTC${offset >= 0 ? "+" : ""}${offset})`, "ok");
    }
    writeLine("FORMAT: DD | DD<DDMMM> | DD<DDMMM>/<N> | DD<DDMMM>/-<N> | DD<DDMMM1>/<DDMMM2> | DD<CITY>", "err");
  },
  DF: (arg) => {
    const a = arg.trim().toUpperCase().replace(/\s+/g, "");
    let m;
    if ((m = a.match(/^(\d+(?:\.\d+)?)P(\d+(?:\.\d+)?)$/))) {
      const [, base, pct] = m;
      return writeLine((parseFloat(base) * (1 + parseFloat(pct) / 100)).toFixed(2), "ok");
    }
    if ((m = a.match(/^(\d+(?:\.\d+)?);(\d+(?:\.\d+)?)$/))) return writeLine((parseFloat(m[1]) + parseFloat(m[2])).toFixed(2), "ok");
    if ((m = a.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) return writeLine((parseFloat(m[1]) - parseFloat(m[2])).toFixed(2), "ok");
    if ((m = a.match(/^(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?)$/))) return writeLine((parseFloat(m[1]) * parseFloat(m[2])).toFixed(2), "ok");
    if ((m = a.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/))) return writeLine((parseFloat(m[1]) / parseFloat(m[2])).toFixed(2), "ok");
    writeLine("FORMAT: DF<A>;<B> (ADD) | DF<A>-<B> | DF<A>*<B> | DF<A>/<B> | DF<BASE>P<PERCENT>", "err");
  },

  // Core Booking
  AN: (arg) => runAvailability(arg, "AN", "AVAILABILITY"),
  SN: (arg) => runAvailability(arg, "SN", "SCHEDULE"),
  AA: (arg) => runAvailability(arg, "AA", "AVAILABILITY - BY ARRIVAL"),
  AD: (arg) => runAvailability(arg, "AD", "AVAILABILITY - BY DEPARTURE"),
  AE: (arg) => runAvailability(arg, "AE", "AVAILABILITY - BY ELAPSED TIME"),
  AC: (arg) => {
    const last = AMX.state.lastAvailQuery;
    if (!last) return writeLine("NO PRIOR AVAILABILITY DISPLAY TO MODIFY - USE AN FIRST", "err");
    const a = arg.trim().toUpperCase();
    let ddmmm = last.ddmmm, from = last.from, to = last.to, opts = { ...last.opts };
    let m;
    if ((m = a.match(/^(\d{1,2}[A-Z]{3})$/))) ddmmm = m[1];
    else if ((m = a.match(/^\/\/([A-Z]{3})$/))) to = m[1];
    else if ((m = a.match(/^([A-Z]{3})([A-Z]{3})$/))) { from = m[1]; to = m[2]; }
    else if ((m = a.match(/^([A-Z]{3})$/))) from = m[1];
    else if ((m = a.match(/^\/A([A-Z0-9]{2,3})$/))) opts.airlineFilter = m[1];
    else if ((m = a.match(/^-?(\d+)$/))) { const dt = parseDDMMM(ddmmm); const delta = (a.startsWith("-") ? -1 : 1) * parseInt(m[1], 10); ddmmm = fmtDDMMM(new Date(dt.getTime() + delta * 86400000)); }
    else return writeLine("FORMAT: AC<DDMMM> | AC<FROM><TO> | AC//<TO> | AC/A<CARRIER> | AC<N> | AC-<N>", "err");
    runAvailability(`${ddmmm}${from}${to}`, last.code, "AVAILABILITY (MODIFIED)");
  },
  SC: (arg) => commands.AC(arg),
  MN: () => {
    const last = AMX.state.lastAvailQuery;
    if (!last) return writeLine("NO PRIOR AVAILABILITY DISPLAY - USE AN FIRST", "err");
    const dt = parseDDMMM(last.ddmmm);
    const nextDay = fmtDDMMM(new Date(dt.getTime() + 86400000));
    runAvailability(`${nextDay}${last.from}${last.to}`, last.code, "AVAILABILITY (NEXT DAY)");
  },
  MY: () => {
    const last = AMX.state.lastAvailQuery;
    if (!last) return writeLine("NO PRIOR AVAILABILITY DISPLAY - USE AN FIRST", "err");
    const dt = parseDDMMM(last.ddmmm);
    const prevDay = fmtDDMMM(new Date(dt.getTime() - 86400000));
    runAvailability(`${prevDay}${last.from}${last.to}`, last.code, "AVAILABILITY (PREVIOUS DAY)");
  },
  DO: (arg) => {
    const m = arg.trim().toUpperCase().match(/^([A-Z0-9]{2,3})(\d{1,4})(?:\/(\d{1,2}[A-Z]{3}))?$/);
    if (!m) return writeLine("FORMAT: DO<CARRIER><FLIGHT>[/<DDMMM>]", "err");
    const [, carrier, flight, ddmmm] = m;
    const airline = AMX.state.world.airlines.find(a => a.code === carrier);
    if (!airline) return writeLine("UNKNOWN CARRIER CODE", "err");
    const route = AMX.state.world.routes.find(r => r[2] === carrier);
    if (!route) return writeLine("NO FLIGHT INFORMATION AVAILABLE FOR THIS CARRIER", "err");
    const dt = ddmmm ? parseDDMMM(ddmmm) : new Date();
    const leg = buildLeg(dt, route[0], route[1], carrier);
    writeLine(`FLIGHT INFORMATION - ${carrier}${flight} ${ddmmm || fmt.nowDate()}`, "ok");
    writeLine(`${route[0]}-${route[1]}  DEP ${leg.dep}  ARR ${leg.arr}  EQP ${leg.equipment}  STATUS ON TIME`, "hint");
  },
  SS: (arg) => {
    const parts = arg.toUpperCase().split("*");
    const pnr = ensurePNR();

    parts.forEach((part, index) => {
      const m = part.match(/^(\d+)([A-Z])(\d+)$/);
      if (!m) return writeLine("FORMAT: SS<PAX><CL><LN> OR SS...*SS...", "err");
      const [, pax, rbd, lineNo] = m;

      const availabilityList = (index === 0) ? AMX.state.availability.outbound : AMX.state.availability.inbound;
      const sel = availabilityList.find(l => l.line == lineNo);
      if (!sel) return writeLine(`LINE ${lineNo} NOT FOUND IN ${index === 0 ? "OUTBOUND" : "INBOUND"} DISPLAY`, "err");

      let anyWaitlisted = false;
      for (let i = 0; i < pax; i++) {
        sel.segments.forEach(leg => {
          const status = classAvailable(leg.classes, rbd) ? "HK" : "HL";
          if (status === "HL") anyWaitlisted = true;
          pnr.segments.push({ ...leg, cabin: rbd, status, seats: [] });
        });
      }
      addHistory(pnr, `SOLD ${pax} IN ${rbd} FROM LINE ${lineNo}${anyWaitlisted ? " (WAITLISTED)" : ""}`);
      writeLine(`${anyWaitlisted ? "WAITLISTED (HL)" : "SOLD"} ${pax} SEAT(S) FROM ${index === 0 ? "OUTBOUND" : "INBOUND"}${sel.connection ? " (CONNECTION - 2 SEGMENTS)" : ""}`, anyWaitlisted ? "hint" : "ok");
    });
  },
  NM: (arg) => {
    const pnr = ensurePNR();
    const upper = arg.toUpperCase();
    const head = upper.match(/^(\d+)([A-Z'\-]+)\/(.+)$/);
    if (!head) return writeLine("FORMAT: NM<N>SURNAME/FIRST1 TITLE1[(CHD/DDMMMYY)|(INF/INFANTNAME/DDMMMYY)][/FIRST2 TITLE2...]", "err");
    const [, countStr, surname, rest] = head;
    const paxRe = /([A-Z'\-]+)\s+(MRS|MSTR|MISS|MR|MS)(?:\((CHD|INF|YTH)\/?([A-Z]*)\/?(\d{1,2}[A-Z]{3}\d{0,4})?\))?\/?/g;
    const added = [];
    let m;
    while ((m = paxRe.exec(rest))) {
      const [, first, title, subType, infantName, dob] = m;
      const pax = { name: `${surname}/${first} ${title}`, type: subType || "ADT" };
      if (subType === "CHD") pax.dob = dob;
      if (subType === "YTH") { /* youth fare - no extra data needed */ }
      if (subType === "INF") pax.infant = { name: infantName, dob };
      pnr.passengers.push(pax);
      added.push(pax);
    }
    if (!added.length) return writeLine("FORMAT: NM<N>SURNAME/FIRST1 TITLE1[(CHD/DDMMMYY)|(INF/INFANTNAME/DDMMMYY)][/FIRST2 TITLE2...]", "err");
    addHistory(pnr, `ADDED ${added.length} PAX`, "AN");
    added.forEach(pax => writeLine(`PAX ADDED: ${pax.name}`, "ok"));
    const expected = parseInt(countStr, 10);
    if (expected !== added.length) writeLine(`NOTE: NM${countStr} REQUESTED BUT ${added.length} PARSED`, "hint");
  },
  AP: (arg) => { ensurePNR().contacts.phone = arg.trim(); addHistory(ensurePNR(), "ADDED PHONE", "AP"); writeLine("PHONE ADDED", "ok"); },
  APH: (arg) => { ensurePNR().contacts.home = arg.trim(); addHistory(ensurePNR(), "ADDED HOME PHONE", "AP"); writeLine("HOME PHONE ADDED", "ok"); },
  APM: (arg) => { ensurePNR().contacts.mobile = arg.trim(); addHistory(ensurePNR(), "ADDED MOBILE PHONE", "AP"); writeLine("MOBILE PHONE ADDED", "ok"); },
  APE: (arg) => { ensurePNR().contacts.email = arg.trim(); addHistory(ensurePNR(), "ADDED EMAIL"); writeLine("EMAIL ADDED", "ok"); },
  TKOK: () => { const pnr = ensurePNR(); pnr.remarks.push("TKOK"); pnr.ticketingArrangement = { type: "OK" }; addHistory(pnr, `ADDED TKOK`, "AT"); writeLine("TICKETING ARRANGEMENT: OK (NO TIME LIMIT)", "ok"); },
  TKTL: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d{1,2}[A-Z]{3})\/(\d{3,4})$/);
    if (!m) return writeLine("FORMAT: TKTL<DDMMM>/<HHMM>", "err");
    const pnr = ensurePNR();
    pnr.ticketingArrangement = { type: "TL", date: m[1], time: m[2] };
    pnr.remarks.push(`TKTL${m[1]}/${m[2]}`);
    const q = ensureQueue("8");
    addHistory(pnr, `ADDED TKTL ${m[1]}/${m[2]} - QUEUED TO 8/C1`, "AT");
    writeLine(`TICKET TIME LIMIT ${m[1]}/${m[2]} - AUTO-QUEUED TO QUEUE 8 CATEGORY C1 ON SAVE`, "ok");
  },
  TKXL: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d{1,2}[A-Z]{3})$/);
    if (!m) return writeLine("FORMAT: TKXL<DDMMM>", "err");
    const pnr = ensurePNR();
    pnr.ticketingArrangement = { type: "XL", date: m[1] };
    pnr.remarks.push(`TKXL${m[1]}`);
    addHistory(pnr, `ADDED TKXL ${m[1]} - AUTO-CANCEL IF UNTICKETED PAST THIS DATE`, "AT");
    writeLine(`TICKETING TIME LIMIT XL SET: ITINERARY AUTO-CANCELS AFTER ${m[1]} IF UNTICKETED`, "ok");
  },
  RF: (arg) => { const who = arg.trim() || AMX.state.agent; ensurePNR().remarks.push(`RF ${who}`); addHistory(ensurePNR(), `ADDED RF ${who}`); writeLine("RECEIVED FROM ADDED", "ok"); },
  ER: () => {
    const pnr = ensurePNR();
    if (!pnr.passengers.length || !pnr.segments.length) return writeLine("PNR INCOMPLETE", "err");
    if (!pnr.recordLocator) pnr.recordLocator = randomLocator();
    addHistory(pnr, `SAVED PNR`);
    savePNR(pnr);
    if (pnr.ticketingArrangement?.type === "TL") placeOnQueue("8", pnr.recordLocator, "C1");
    writeLine(`PNR SAVED: ${pnr.recordLocator}`, "ok");
  },
  EF: () => commands.ER(),

  // PNR Servicing
  RT: (arg) => {
    const raw = arg.trim();
    const upper = raw.toUpperCase();
    if (!raw || upper === "*E") {
      if (AMX.state.pnr) return writeHTML(renderItineraryHTML(AMX.state.pnr));
      return writeLine("NO ACTIVE PNR", "err");
    }
    const filterCodes = { A: "SEGMENTS", I: "SEGMENTS", W: "SEGMENTS", N: "NAMES", P: "NAMES", G: "SSR", J: "CONTACTS", K: "TICKETING", R: "REMARKS", B: "ITINERARY REMARKS", TN: "TICKET NUMBERS" };
    if ((filterCodes[upper] || upper === "TN") && AMX.state.pnr) {
      const pnr = AMX.state.pnr;
      const kind = filterCodes[upper];
      writeLine(`PNR ELEMENTS - ${kind}`, "ok");
      if (kind === "SEGMENTS") pnr.segments.forEach((s, i) => writeLine(`${i + 1}. ${s.date} ${s.from}${s.to} ${s.carrier}${s.flight} ${s.status}`, "hint"));
      else if (kind === "NAMES") pnr.passengers.forEach((p, i) => writeLine(`${i + 1}. ${p.name}`, "hint"));
      else if (kind === "SSR") (pnr.ssrs || []).forEach(s => writeLine(`SSR ${s.type} ${s.text}`, "hint"));
      else if (kind === "CONTACTS") Object.entries(pnr.contacts || {}).forEach(([k, v]) => v && writeLine(`${k.toUpperCase()}: ${v}`, "hint"));
      else if (kind === "TICKETING") writeLine(pnr.ticketingArrangement ? JSON.stringify(pnr.ticketingArrangement) : "NO TICKETING ARRANGEMENT ON FILE", "hint");
      else if (kind === "REMARKS") pnr.remarks.forEach(r => writeLine(r, "hint"));
      else if (kind === "ITINERARY REMARKS") (pnr.itineraryRemarks || []).forEach(r => writeLine(r, "hint"));
      else if (kind === "TICKET NUMBERS") (pnr.tickets || []).forEach(t => writeLine(`${t.number}  ${t.status || "O"}`, "hint"));
      return;
    }
    if (/^\d{1,2}$/.test(upper) && AMX.state.nameSearchResults && AMX.state.nameSearchResults.length) {
      const sel = AMX.state.nameSearchResults[parseInt(upper, 10) - 1];
      if (!sel) return writeLine("SELECTION NOT FOUND", "err");
      const pnr = loadPNR(sel.locator);
      AMX.state.pnr = pnr;
      AMX.state.nameSearchResults = null;
      const expired = maybeExpireXL(pnr);
      const disrupted = !expired && maybeTriggerIROPS(pnr);
      writeLine(`PNR ${sel.locator} RETRIEVED`, "ok");
      if (expired) writeLine("ITINERARY AUTO-CANCELLED - TICKETING TIME LIMIT (TKXL) PASSED", "err");
      if (disrupted) writeLine("SCHEDULE CHANGE DETECTED - PNR AUTO-QUEUED TO QUEUE 5", "err");
      return writeHTML(renderItineraryHTML(pnr));
    }
    const nameMatch = upper.match(/^\/(.+)$/);
    if (nameMatch) {
      const query = nameMatch[1];
      const results = [];
      allStoredPNRs().forEach(pnr => {
        (pnr.passengers || []).forEach(p => {
          const surname = (p.name || "").split("/")[0];
          if (surname === query || surname.startsWith(query)) results.push({ locator: pnr.recordLocator, name: p.name });
        });
      });
      if (!results.length) return writeLine("NO MATCHING PNR FOUND", "err");
      if (results.length === 1) {
        const pnr = loadPNR(results[0].locator);
        AMX.state.pnr = pnr;
        const expired = maybeExpireXL(pnr);
        const disrupted = !expired && maybeTriggerIROPS(pnr);
        writeLine(`PNR ${results[0].locator} RETRIEVED`, "ok");
        if (expired) writeLine("ITINERARY AUTO-CANCELLED - TICKETING TIME LIMIT (TKXL) PASSED", "err");
        if (disrupted) writeLine("SCHEDULE CHANGE DETECTED - PNR AUTO-QUEUED TO QUEUE 5", "err");
        return writeHTML(renderItineraryHTML(pnr));
      }
      AMX.state.nameSearchResults = results;
      writeLine(`${results.length} MATCHES FOUND - SELECT WITH RT<N>`, "ok");
      results.forEach((r, i) => writeLine(`${i + 1}. ${r.name}  ${r.locator}`, "hint"));
      return;
    }
    const pnr = loadPNR(upper);
    if (pnr) {
      AMX.state.pnr = pnr;
      AMX.state.nameSearchResults = null;
      const expired = maybeExpireXL(pnr);
      const disrupted = !expired && maybeTriggerIROPS(pnr);
      writeLine(`PNR ${upper} RETRIEVED`, "ok");
      if (expired) writeLine("ITINERARY AUTO-CANCELLED - TICKETING TIME LIMIT (TKXL) PASSED", "err");
      if (disrupted) writeLine("SCHEDULE CHANGE DETECTED - PNR AUTO-QUEUED TO QUEUE 5", "err");
      writeHTML(renderItineraryHTML(pnr));
    } else {
      writeLine("PNR NOT FOUND", "err");
    }
  },
  IR: () => {
    if (AMX.state.pnr?.recordLocator) {
      commands.RT(AMX.state.pnr.recordLocator);
    } else {
      AMX.state.pnr = null;
      writeLine("IGNORED. NO PNR ON SCREEN.", "ok");
    }
  },
  IG: () => { AMX.state.pnr = null; AMX.state.nameSearchResults = null; writeLine("IGNORED.", "ok"); },
  RRN: () => copyPnrVariant("FULL"),
  RRI: () => copyPnrVariant("ITINERARY"),
  RRP: () => copyPnrVariant("PASSENGERS"),
  ES: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().toUpperCase().match(/^([A-Z0-9]{4,9})-([RBN])$/);
    if (!m) return writeLine("FORMAT: ES<OFFICE ID>-<R|B|N>", "err");
    pnr.security.push({ office: m[1], mode: m[2] });
    addHistory(pnr, `ADDED PNR SECURITY FOR ${m[1]} (${m[2]})`, "AE");
    writeLine(`SECURITY ELEMENT ADDED: ${m[1]} - ${{ R: "READ ACCESS", B: "READ/WRITE ACCESS", N: "NO ACCESS" }[m[2]]}`, "ok");
  },
  ESD: () => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.security.length) return writeLine("NO SECURITY ELEMENTS ON FILE", "hint");
    writeLine("PNR SECURITY ELEMENTS", "ok");
    pnr.security.forEach((s, i) => writeLine(`${i + 1}. ${s.office} - ${s.mode}`, "hint"));
  },
  ESX: (arg) => {
    const pnr = ensurePNR();
    const n = parseInt(arg.trim(), 10);
    if (!pnr.security[n - 1]) return writeLine("SECURITY ELEMENT NOT FOUND", "err");
    pnr.security.splice(n - 1, 1);
    addHistory(pnr, `CANCELLED SECURITY ELEMENT ${n}`, "XE");
    writeLine(`SECURITY ELEMENT ${n} CANCELLED`, "ok");
  },
  RH: () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR", "err");
    writeLine(`HISTORY FOR ${pnr.recordLocator || "UNSAVED PNR"}`, "ok");
    pnr.history.forEach(h => writeLine(h, "hint"));
  },
  LP: (arg) => {
    const m = arg.trim().toUpperCase().match(/^\/([A-Z0-9]{2,3})(\d{1,4})\/(\d{1,2}[A-Z]{3})(?:-([A-Z]{3})([A-Z]{3}))?$/);
    if (!m) return writeLine("FORMAT: LP/<CARRIER><FLIGHT>/<DDMMM>[-<FROM><TO>]", "err");
    const [, carrier, flight, ddmmm, from, to] = m;
    const results = [];
    allStoredPNRs().forEach(pnr => {
      pnr.segments.forEach(s => {
        if (s.carrier === carrier && s.flight === flight && s.date === ddmmm && (!from || (s.from === from && s.to === to))) {
          (pnr.passengers || []).forEach(p => results.push({ locator: pnr.recordLocator, name: p.name }));
        }
      });
    });
    if (!results.length) return writeLine("NO PNRS FOUND FOR THIS FLIGHT", "err");
    AMX.state.nameSearchResults = results;
    writeLine(`${carrier}${flight} ${ddmmm} - ${results.length} PASSENGER(S) - SELECT WITH RT<N>`, "ok");
    results.forEach((r, i) => writeLine(`${i + 1}. ${r.name}  ${r.locator}`, "hint"));
  },
  NU: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^(\d+)\/(\d+)([A-Z'\-]+)\/([A-Z'\-]+)(?:\s+(MRS|MSTR|MISS|MR|MS))?$/);
    if (!m) return writeLine("FORMAT: NU<OLD#>/<NEW#><SURNAME>/<FIRSTNAME> [TITLE]", "err");
    const [, oldIdx, , surname, first, title] = m;
    const pax = pnr.passengers[parseInt(oldIdx, 10) - 1];
    if (!pax) return writeLine("PASSENGER NOT FOUND", "err");
    const oldName = pax.name;
    const existingTitle = pax.name.split(" ").pop();
    pax.name = `${surname}/${first} ${title || existingTitle}`;
    addHistory(pnr, `UPDATED NAME ${oldName} -> ${pax.name}`, "CN");
    writeLine(`NAME UPDATED: ${pax.name}`, "ok");
  },
  SP: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR", "err");
    const nums = arg.trim().split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (!nums.length) return writeLine("FORMAT: SP <PAX NUMBER>[,<PAX NUMBER>...]", "err");
    const idxSet = new Set(nums.map(n => n - 1));
    const movedPax = [];
    const keptPax = [];
    pnr.passengers.forEach((p, i) => (idxSet.has(i) ? movedPax : keptPax).push(p));
    if (!movedPax.length) return writeLine("NO MATCHING PASSENGERS", "err");
    if (!keptPax.length) return writeLine("CANNOT SPLIT ALL PASSENGERS OUT OF A PNR - LEAVE AT LEAST ONE", "err");

    pnr.passengers = keptPax;
    addHistory(pnr, `SPLIT ${movedPax.length} PAX TO NEW PNR`, "SP");
    if (pnr.recordLocator) savePNR(pnr);

    const newPnr = createEmptyPNR();
    newPnr.passengers = movedPax;
    newPnr.segments = JSON.parse(JSON.stringify(pnr.segments));
    newPnr.contacts = { ...pnr.contacts };
    newPnr.history.push(`SPLIT FROM PNR ${pnr.recordLocator || "UNSAVED"}`);
    AMX.state.pnr = newPnr;
    writeLine(`SPLIT COMPLETE - ${movedPax.length} PAX MOVED TO NEW PNR (UNSAVED). SAVE WITH ER.`, "ok");
    writeHTML(renderItineraryHTML(newPnr));
  },
  XE: (arg) => {
    const pnr = ensurePNR();
    const n = parseInt(arg.trim(), 10);
    const items = buildElementList(pnr);
    const item = items[n - 1];
    if (!item) return writeLine("ELEMENT NOT FOUND", "err");
    if (item.kind === "NM") pnr.passengers.splice(item.idx, 1);
    else if (item.kind === "SEG") pnr.segments.splice(item.idx, 1);
    else if (item.kind === "SSR") pnr.ssrs.splice(item.idx, 1);
    else if (item.kind === "RM") pnr.remarks.splice(item.idx, 1);
    addHistory(pnr, `CANCELLED ELEMENT ${n}`, "DL");
    writeLine(`ELEMENT ${n} CANCELLED`, "ok");
  },
  XI: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO ITINERARY TO CANCEL", "err");
    pnr.segments = [];
    addHistory(pnr, "CANCELLED ALL ITINERARY ELEMENTS", "XS");
    writeLine("ITINERARY CANCELLED", "ok");
  },
  SB: (arg) => {
    const pnr = ensurePNR();
    const a = arg.trim().toUpperCase();
    let m;
    if (!a) {
      if (!pnr.segments.length) return writeLine("NO SEGMENTS ON FILE", "err");
      const scIdx = pnr.segments.findIndex(s => s.status === "SC");
      const segIdx = scIdx !== -1 ? scIdx : 0;
      const seg = pnr.segments[segIdx];
      const dt = parseDDMMM(seg.date) || new Date();
      const options = mockAvailability(dt, seg.from, seg.to, {});
      if (!options.length) return writeLine(`NO REBOOKING OPTIONS FOUND FOR ${seg.from}-${seg.to}`, "err");
      AMX.state.rebookOptions = { segIdx, options };
      writeLine(`REBOOKING OPTIONS FOR SEGMENT ${segIdx + 1} (${seg.from}-${seg.to})${seg.status === "SC" ? " - SCHEDULE CHANGED" : ""}`, "ok");
      options.forEach(l => printAvailLine(l));
      writeLine("SELECT WITH SB<N>", "hint");
      return;
    }
    if ((m = a.match(/^(\d+)$/)) && AMX.state.rebookOptions) {
      const { segIdx, options } = AMX.state.rebookOptions;
      const sel = options.find(o => o.line === parseInt(m[1], 10));
      if (!sel) return writeLine("OPTION NOT FOUND", "err");
      const leg = sel.segments[0];
      const seg = pnr.segments[segIdx];
      const cabin = seg.cabin;
      Object.assign(seg, leg, { cabin, status: "HK" });
      AMX.state.rebookOptions = null;
      addHistory(pnr, `REBOOKED SEGMENT ${segIdx + 1} TO ${leg.carrier}${leg.flight} ${leg.date}`, "CS");
      return writeLine(`SEGMENT ${segIdx + 1} REBOOKED TO ${leg.carrier}${leg.flight} ${leg.date} ${leg.dep}-${leg.arr}`, "ok");
    }
    if ((m = a.match(/^([A-Z])(\d+)$/))) {
      const seg = pnr.segments[parseInt(m[2], 10) - 1];
      if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
      seg.cabin = m[1];
      addHistory(pnr, `REBOOKED SEGMENT ${m[2]} INTO CLASS ${m[1]}`, "CS");
      return writeLine(`SEGMENT ${m[2]} REBOOKED TO CLASS ${m[1]}`, "ok");
    }
    if ((m = a.match(/^(M?)(\d{1,2}[A-Z]{3})(\d+)$/))) {
      const seg = pnr.segments[parseInt(m[3], 10) - 1];
      if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
      seg.date = m[2];
      addHistory(pnr, `REBOOKED SEGMENT ${m[3]} TO DATE ${m[2]}`, "TC");
      return writeLine(`SEGMENT ${m[3]} DATE CHANGED TO ${m[2]}`, "ok");
    }
    writeLine("FORMAT: SB (SHOW REBOOKING OPTIONS) | SB<n> (SELECT) | SBC<n> (CLASS) | SB<DDMMM><n> (DATE)", "err");
  },
  RM: (arg) => {
    const pnr = ensurePNR();
    let text = arg.trim();
    let tag = "";
    const m = text.match(/^\/(\w+)\s+(.*)$/);
    if (m) { tag = `[${m[1].toUpperCase()}] `; text = m[2]; }
    pnr.remarks.push(`${tag}${text.toUpperCase()}`);
    addHistory(pnr, "ADDED REMARK", "AR");
    writeLine("REMARK ADDED", "ok");
  },
  RC: (arg) => {
    const pnr = ensurePNR();
    pnr.confidentialRemarks.push(arg.trim().toUpperCase());
    addHistory(pnr, "ADDED CONFIDENTIAL REMARK", "AR");
    writeLine("CONFIDENTIAL REMARK ADDED (VISIBLE ONLY IN THIS OFFICE)", "ok");
  },
  RIR: (arg) => {
    const pnr = ensurePNR();
    const m = arg.match(/^(.*)\/S(\d+)$/i);
    const text = (m ? m[1] : arg).trim().toUpperCase();
    const segNum = m ? m[2] : null;
    pnr.itineraryRemarks.push(segNum ? `${text} /S${segNum}` : text);
    addHistory(pnr, "ADDED ITINERARY REMARK", "AR");
    writeLine("ITINERARY REMARK ADDED - PRINTS ON THE CLIENT ITINERARY", "ok");
  },
  OS: (arg) => {
    const pnr = ensurePNR();
    pnr.remarks.push(`OSI ${arg.trim().toUpperCase()}`);
    addHistory(pnr, "ADDED OSI", "OA");
    writeLine("OTHER SERVICE INFORMATION ADDED", "ok");
  },
  FFN: (arg) => {
    const pnr = ensurePNR();
    pnr.ssrs.push({ type: "FQTV", text: arg.trim().toUpperCase() });
    addHistory(pnr, "ADDED FREQUENT FLYER NUMBER", "SA");
    writeLine("FREQUENT FLYER NUMBER ADDED", "ok");
  },
  SR: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().match(/^([A-Za-z]+)\s*(.*)$/);
    if (!m) return writeLine("FORMAT: SR <TYPE> <FREE TEXT>", "err");
    pnr.ssrs.push({ type: m[1].toUpperCase(), text: m[2].trim().toUpperCase() });
    addHistory(pnr, `ADDED SSR ${m[1].toUpperCase()}`, "SA");
    writeLine(`SSR ${m[1].toUpperCase()} ADDED`, "ok");
  },
  SO: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().toUpperCase().match(/^([A-Z0-9]{2,3})([A-Z])(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})$/);
    if (!m) return writeLine("FORMAT: SO<CARRIER><CLASS><DDMMM><FROM><TO>", "err");
    const [, carrier, cls, ddmmm, from, to] = m;
    pnr.segments.push({ date: ddmmm, from, to, carrier, flight: "OPEN", dep: "OPEN", arr: "OPEN", classes: `${cls}9`, cabin: cls, status: "OPEN", seats: [] });
    addHistory(pnr, `ADDED OPEN SEGMENT ${carrier} ${from}-${to}`, "AS");
    writeLine(`OPEN SEGMENT ADDED: ${carrier} ${cls} ${ddmmm} ${from}-${to}`, "ok");
  },
  SI: (arg) => {
    const a = arg.trim().toUpperCase();
    const m = a.match(/^ARNK(\d{1,2}[A-Z]{3})?$/);
    if (!m) return writeLine("FORMAT: SIARNK[<DDMMM>]", "err");
    const pnr = ensurePNR();
    pnr.segments.push({ date: m[1] || "", from: "ARNK", to: "ARNK", carrier: "", flight: "", dep: "", arr: "", classes: "", status: "ARNK", seats: [] });
    addHistory(pnr, "ADDED ARRIVAL UNKNOWN SEGMENT", "AS");
    writeLine("ARNK SEGMENT ADDED - MAINTAINS ITINERARY CONTINUITY", "ok");
  },
  OP: (arg) => {
    const m = arg.match(/^(?:(\d{1,2}[A-Z]{3})\/)?(.*)$/i);
    const pnr = AMX.state.pnr;
    if (!pnr?.recordLocator) return writeLine("PNR MUST BE SAVED (ER) BEFORE QUEUING", "err");
    placeOnQueue("0", pnr.recordLocator, "C1");
    addHistory(pnr, `OPTION QUEUED${m[1] ? " FOR " + m[1] : ""}${m[2] ? ": " + m[2].trim().toUpperCase() : ""}`, "AO");
    writeLine(`OPTION ELEMENT ADDED - QUEUED TO QUEUE 0${m[1] ? " ON " + m[1] : ""}`, "ok");
  },
  FHE: (arg) => {
    const pnr = AMX.state.pnr;
    const m = arg.trim().toUpperCase().match(/^([A-Z]{2,3})(\d{3})(\d{10})(?:\/S[\d,-]+)?(?:\/P(\d+))?$/);
    if (!pnr || !m) return writeLine("FORMAT: FHE<CARRIER><3-DIGIT NUMERIC><10-DIGIT DOCUMENT>[/S<SEGS>][/P<PAX#>]", "err");
    const [, carrier, numeric, doc, paxNum] = m;
    const paxIndex = paxNum ? parseInt(paxNum, 10) - 1 : 0;
    const ticket = { number: `${numeric}-${doc}`, passengerIndex: paxIndex, carrier, issuedAt: fmt.nowDate(), status: "O", manual: true };
    pnr.tickets.push(ticket);
    addHistory(pnr, `MANUALLY INSERTED TICKET NUMBER ${ticket.number}`, "AT");
    writeLine(`TICKET NUMBER ${ticket.number} MANUALLY INSERTED`, "ok");
  },
  WRA: () => commands["ITR/P"](),
  WRS: () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR TO PRINT", "err");
    writeHTML(renderItineraryHTML(pnr));
    writeLine("FIRST SCREEN SENT TO PRINTER (SIMULATED)", "ok");
  },

  // Pricing & Ticketing
  FQD: (arg) => {
    const a = arg.trim().toUpperCase();
    const m = a.match(/^([A-Z]{3})([A-Z]{3})(.*)$/);
    if (!m) return writeLine("FORMAT: FQD<FROM><TO>[/A<CARRIER>][/C<CLASS>][/D<DDMMM>][/C<CCY>][/R,-CH|/R,-INF]", "err");
    const [, from, to, rest] = m;
    const tokens = rest.split("/").filter(Boolean);
    let carrier = null, cls = null, ddmmm = null, paxType = null, currency = null;
    tokens.forEach(t => {
      let mm;
      if ((mm = t.match(/^A([A-Z0-9]{2,3})$/))) carrier = mm[1];
      else if ((mm = t.match(/^C([A-Z]{3})$/))) currency = mm[1];
      else if ((mm = t.match(/^C([A-Z])$/))) cls = mm[1];
      else if ((mm = t.match(/^D(\d{1,2}[A-Z]{3})$/))) ddmmm = mm[1];
      else if (t === "R,-CH") paxType = "CHD";
      else if (t === "R,-INF") paxType = "INF";
    });
    if (currency && !CURRENCY_RATES[currency]) return writeLine(`UNKNOWN CURRENCY CODE ${currency}`, "err");
    const rate = currency ? CURRENCY_RATES[currency] : 1;
    const ccy = currency || "EUR";
    const routes = AMX.state.world.routes.filter(r => r[0] === from && r[1] === to && (!carrier || r[2] === carrier));
    if (!routes.length) return writeLine(`NO FARES FOUND FOR ${from}-${to}`, "err");
    const carriers = [...new Set(routes.map(r => r[2]))].slice(0, 4);
    writeLine(`FARE DISPLAY FOR ${from}-${to}${ddmmm ? " ON " + ddmmm : ""}`, "ok");
    const families = [
      { code: "SAVER", mult: 1.0, letter: "K" },
      { code: "FLEX", mult: 1.7, letter: "Y" },
      { code: "BUSINESS", mult: 3.2, letter: "C" },
    ];
    let row = 1;
    const rows = [];
    carriers.forEach(c => {
      const base = 220 + (from.charCodeAt(0) + to.charCodeAt(0)) % 180;
      families.forEach(fam => {
        if (cls && cls !== fam.letter) return;
        let price = base * fam.mult;
        if (paxType === "CHD") price *= 0.75;
        if (paxType === "INF") price *= 0.10;
        writeLine(`${row}. ${c} ${fam.letter}${fam.code.charAt(0)} ${fam.code.padEnd(9)} ${ccy} ${(price * rate).toFixed(2)}`, "hint");
        rows.push({ line: row, carrier: c, letter: fam.letter, famCode: fam.code, price: price * rate, ccy, from, to, direct: routes.some(r => r[2] === c) });
        row++;
      });
    });
    AMX.state.lastFareQuote = { from, to, rows };
  },
  FQP: (arg) => {
    const a = arg.trim().toUpperCase();
    const legs = a.split("---");
    const parsed = [];
    for (const leg of legs) {
      const m = leg.match(/^([A-Z]{3})\/A([A-Z0-9]{2,3})\/D(\d{1,2}[A-Z]{3})([A-Z]{3})(\/R.*)?$/);
      if (!m) return writeLine("FORMAT: FQP<FROM>/A<CARRIER>/D<DDMMM><TO>[/R,-CH|/R,-INF][---<TO2>/A<CARRIER>/D<DDMMM><TO3>]", "err");
      parsed.push({ from: m[1], carrier: m[2], ddmmm: m[3], to: m[4], qualifier: m[5] || "" });
    }
    let total = 0;
    const currency = "EUR";
    writeLine("INFORMATIVE PRICING", "ok");
    parsed.forEach((leg, i) => {
      const base = 200 + (leg.from.charCodeAt(0) + leg.to.charCodeAt(0)) % 200;
      let price = base;
      if (leg.qualifier.includes("-CH")) price *= 0.75;
      if (leg.qualifier.includes("-INF")) price *= 0.10;
      total += price;
      writeLine(`${i + 1}. ${leg.carrier} ${leg.from}-${leg.to} ${leg.ddmmm}  ${currency} ${price.toFixed(2)}`, "hint");
    });
    writeLine(`TOTAL: ${currency} ${total.toFixed(2)}`, "ok");
  },
  FXX: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const fare = computeFare(pnr, idx, false);
    writeLine(`PRICED (NOT STORED): ${fare.currency} ${fare.total.toFixed(2)}`, "ok");
  },
  FXR: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const fare = computeFare(pnr, idx, true);
    writeLine(`LOWEST FARE FOUND (NOT STORED): ${fare.currency} ${fare.total.toFixed(2)}`, "ok");
  },
  FXP: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const fare = decorateFare(pnr, computeFare(pnr, idx, false));
    pnr.fare = fare;
    pnr.tst.push({ id: pnr.tst.length + 1, ...fare, createdAt: fmt.nowDate() });
    addHistory(pnr, "PRICED PNR (FXP)");
    writeLine(`TST${pnr.tst.length} CREATED`, "ok");
    writeLine(`FARE F ${fare.currency} ${fare.base.toFixed(2)}  FB ${fare.fareBasis}  TOTAL ${fare.currency} ${fare.total.toFixed(2)}`, "hint");
    writeLine(`FC ${fare.fareCalc}`, "hint");
  },
  FXB: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const fare = decorateFare(pnr, computeFare(pnr, idx, true));
    pnr.fare = fare;
    pnr.tst.push({ id: pnr.tst.length + 1, ...fare, createdAt: fmt.nowDate() });
    addHistory(pnr, "PRICED PNR WITH LOWEST FARE (FXB)");
    writeLine(`TST${pnr.tst.length} CREATED - LOWEST FARE`, "ok");
    writeLine(`FARE F ${fare.currency} ${fare.base.toFixed(2)}  FB ${fare.fareBasis}  TOTAL ${fare.currency} ${fare.total.toFixed(2)}`, "hint");
    writeLine(`FC ${fare.fareCalc}`, "hint");
  },
  FQN: (arg) => {
    const n = arg.trim().match(/^(\d+)/);
    if (n) {
      const row = AMX.state.lastFareQuote?.rows.find(r => r.line === parseInt(n[1], 10));
      if (!row) return writeLine("FARE LINE NOT FOUND - RUN FQD FIRST", "err");
      const restrictive = row.letter === "K";
      writeLine(`FARE RULES - LINE ${row.line} - ${row.carrier} ${row.letter}${row.famCode.charAt(0)} ${row.famCode}`, "ok");
      writeLine(`01 ADVANCE RES/TKT     ${restrictive ? "MUST BOOK AND TICKET 14 DAYS BEFORE DEPARTURE" : "NONE"}`, "hint");
      writeLine(`04 CHANGES             ${restrictive ? "NOT PERMITTED" : "PERMITTED, FEE " + row.ccy + " 150.00"}`, "hint");
      writeLine(`05 CANCELLATIONS       ${restrictive ? "NONREFUNDABLE" : "REFUNDABLE, FEE " + row.ccy + " 150.00"}`, "hint");
      return;
    }
    const pnr = ensurePNR();
    if (!pnr.fare) return writeLine("PRICE PNR FIRST (FXP), OR USE FQN<LINE#> AFTER FQD", "err");
    const restrictive = !!pnr.fare.lowest;
    writeLine(`FARE RULES - FARE BASIS ${pnr.fare.fareBasis}`, "ok");
    writeLine(`01 ADVANCE RES/TKT     ${restrictive ? "MUST BOOK AND TICKET 14 DAYS BEFORE DEPARTURE" : "NONE"}`, "hint");
    writeLine(`02 MIN STAY            ${restrictive ? "SATURDAY NIGHT OR 3 DAYS, WHICHEVER LATER" : "NONE"}`, "hint");
    writeLine(`03 MAX STAY            ${restrictive ? "1 MONTH" : "1 YEAR"}`, "hint");
    writeLine(`04 CHANGES             ${restrictive ? "NOT PERMITTED" : "PERMITTED, FEE EUR 150.00"}`, "hint");
    writeLine(`05 CANCELLATIONS       ${restrictive ? "NONREFUNDABLE" : "REFUNDABLE, FEE EUR 150.00"}`, "hint");
    writeLine(`06 COMBINABILITY       ${restrictive ? "NOT COMBINABLE WITH ANY OTHER FARE" : "COMBINABLE WITHIN SAME FARE FAMILY"}`, "hint");
    writeLine(`   VALID ${pnr.fare.nvb} THROUGH ${pnr.fare.nva}`, "hint");
  },
  FQK: (arg) => {
    const n = parseInt(arg.trim(), 10);
    const row = AMX.state.lastFareQuote?.rows.find(r => r.line === n);
    if (!row) return writeLine("FARE LINE NOT FOUND - RUN FQD FIRST", "err");
    const yq = Math.round(row.price * 0.08 * 100) / 100;
    const other = Math.round(row.price * 0.04 * 100) / 100;
    writeLine(`TAX BREAKDOWN - LINE ${row.line}`, "ok");
    writeLine(`YQ  ${row.ccy} ${yq.toFixed(2)}`, "hint");
    writeLine(`XT  ${row.ccy} ${other.toFixed(2)}`, "hint");
  },
  FQR: (arg) => {
    const n = parseInt(arg.trim(), 10);
    const row = AMX.state.lastFareQuote?.rows.find(r => r.line === n);
    if (!row) return writeLine("FARE LINE NOT FOUND - RUN FQD FIRST", "err");
    writeLine(`ROUTING - LINE ${row.line}`, "ok");
    writeLine(row.direct ? `${row.from} ${row.carrier} ${row.to} - DIRECT ROUTING` : `${row.from} ${row.carrier} VIA HUB ${row.to} - CONNECTING ROUTING`, "hint");
  },
  FQS: (arg) => {
    const n = parseInt(arg.trim(), 10);
    const row = AMX.state.lastFareQuote?.rows.find(r => r.line === n);
    if (!row) return writeLine("FARE LINE NOT FOUND - RUN FQD FIRST", "err");
    writeLine(`BOOKING CLASS INFORMATION - LINE ${row.line}`, "ok");
    writeLine(`${row.carrier}  ${row.letter} = ${row.famCode}`, "hint");
  },
  FQC: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)([A-Z]{3})(?:\/([A-Z]{3}))?$/);
    if (!m) return writeLine("FORMAT: FQC<AMOUNT><CCY>[/<CCY2>]", "err");
    const [, amountStr, from, to] = m;
    if (!CURRENCY_RATES[from]) return writeLine(`UNKNOWN CURRENCY CODE ${from}`, "err");
    const toCcy = to || "EUR";
    if (!CURRENCY_RATES[toCcy]) return writeLine(`UNKNOWN CURRENCY CODE ${toCcy}`, "err");
    const nuc = parseFloat(amountStr) / CURRENCY_RATES[from];
    const converted = nuc * CURRENCY_RATES[toCcy];
    writeLine(`${amountStr}${from} = ${converted.toFixed(2)}${toCcy}`, "ok");
  },
  FQA: (arg) => {
    writeLine("IATA RATE OF EXCHANGE (BASE EUR)", "ok");
    Object.keys(CURRENCY_RATES).forEach(ccy => writeLine(`${ccy.padEnd(4)} ${CURRENCY_RATES[ccy].toFixed(4)}`, "hint"));
  },
  FQX: (arg) => {
    const m = arg.trim().toUpperCase().match(/^([A-Z]{3})([A-Z]{3})\/(\d+)(?:\/([A-Z0-9]{2,3}))?$/);
    if (!m) return writeLine("FORMAT: FQX<FROM><TO>/<KG>[/<CARRIER>]", "err");
    const [, from, to, kg] = m;
    const a = findAirport(from), b = findAirport(to);
    if (!a || !b) return writeLine("UNKNOWN AIRPORT CODE", "err");
    const distanceKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const perKg = distanceKm > 3500 ? 12 : distanceKm > 1500 ? 8 : 5;
    const charge = perKg * parseInt(kg, 10);
    writeLine(`EXCESS BAGGAGE CHARGE ${from}-${to} FOR ${kg}KG: EUR ${charge.toFixed(2)}`, "ok");
  },
  FQM: (arg) => {
    const codes = arg.trim().toUpperCase().match(/[A-Z]{3}/g) || [];
    if (codes.length < 2) return writeLine("FORMAT: FQM<FROM><TO>[<TO2>...] (E.G. FQMDOHDXBAMM)", "err");
    let totalKm = 0;
    for (let i = 0; i < codes.length - 1; i++) {
      const a = findAirport(codes[i]), b = findAirport(codes[i + 1]);
      if (!a || !b) return writeLine(`UNKNOWN AIRPORT CODE ${!a ? codes[i] : codes[i + 1]}`, "err");
      totalKm += haversineKm(a.lat, a.lon, b.lat, b.lon);
    }
    const miles = Math.round(totalKm * 0.621371);
    writeLine(`${codes.join("-")}  MILEAGE: ${miles} MILES`, "ok");
  },
  FXD: (arg) => {
    const raw = arg.trim().toUpperCase();
    const main = raw.split("//")[0];
    const codes = main.match(/[A-Z]{3}/g) || [];
    const validCodes = codes.filter(c => AMX.state.world.airports.some(a => a.code === c));
    if (validCodes.length < 2) return writeLine("FORMAT: FXD<FROM><TO> (E.G. FXDDOHLHR)", "err");
    const from = validCodes[0], to = validCodes[validCodes.length - 1];
    const nMatch = main.match(/^(\d)[A-Z]/);
    const n = nMatch ? parseInt(nMatch[1], 10) : 4;
    const routes = AMX.state.world.routes.filter(r => r[0] === from && r[1] === to);
    if (!routes.length) return writeLine(`NO RECOMMENDATIONS FOR ${from}-${to}`, "err");
    const carriers = [...new Set(routes.map(r => r[2]))].slice(0, Math.max(n, 3));
    writeLine(`MASTER PRICER RECOMMENDATIONS ${from}-${to}`, "ok");
    carriers.forEach((c, i) => {
      const base = 250 + (from.charCodeAt(0) * to.charCodeAt(0)) % 300;
      writeLine(`${i + 1}. ${c} ${from}-${to} NONSTOP  EUR ${base.toFixed(2)}`, "hint");
    });
  },
  FV: (arg) => {
    const code = arg.trim().toUpperCase();
    const airline = AMX.state.world.airlines.find(a => a.code === code);
    if (!airline) return writeLine("UNKNOWN CARRIER CODE", "err");
    ensurePNR().validatingCarrier = code;
    addHistory(ensurePNR(), `SET VALIDATING CARRIER ${code}`);
    writeLine(`VALIDATING CARRIER: ${code} - ${airline.name}`, "ok");
  },
  FP: (arg) => {
    const pnr = ensurePNR();
    const a = arg.trim();
    const au = a.toUpperCase();
    let fop;
    if (au.startsWith("CASH")) fop = { type: "CASH" };
    else if (au.startsWith("INV")) fop = { type: "INVOICE" };
    else {
      const m = a.match(/CC\s+([A-Za-z]{2})\s*(\d{4,})\/?(\d{2,4})?/i);
      if (m) fop = { type: "CC", card: m[1].toUpperCase(), number: m[2], expiry: m[3] || "" };
      else return writeLine("FORMAT: FP CASH | FP INV | FP CC <VI/CA/AX> <CARDNO>/<EXP>", "err");
    }
    pnr.formOfPayment = fop;
    addHistory(pnr, `ADDED FORM OF PAYMENT ${fop.type}`);
    writeLine(`FORM OF PAYMENT: ${fop.type}${fop.card ? " " + fop.card + " ****" + fop.number.slice(-4) : ""}`, "ok");
  },
  FM: (arg) => {
    ensurePNR().commission = arg.trim();
    addHistory(ensurePNR(), `SET COMMISSION ${arg.trim()}`);
    writeLine(`COMMISSION SET: ${arg.trim()}`, "ok");
  },
  FCM: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().toUpperCase().match(/^-([AC])(\d+(?:\.\d+)?)$/);
    if (!m) return writeLine("FORMAT: FCM-A<AMOUNT> (FLAT MARKUP) OR FCM-C<PERCENT>", "err");
    pnr.markup = { type: m[1], value: parseFloat(m[2]) };
    addHistory(pnr, `SET AGENCY MARKUP ${m[1]}${m[2]}`);
    writeLine(`AGENCY MARKUP SET: ${m[1] === "A" ? "EUR " + m[2] : m[2] + "%"}`, "ok");
  },
  SVC: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().match(/^(.*)\s+(\d+(?:\.\d+)?)$/);
    if (!m) return writeLine("FORMAT: SVC <DESCRIPTION> <PRICE>", "err");
    const price = parseFloat(m[2]);
    pnr.ancillaries.push({ type: "SVC", text: m[1].trim().toUpperCase(), price });
    addHistory(pnr, `ADDED ANCILLARY SERVICE ${m[1].trim().toUpperCase()} (${price.toFixed(2)})`);
    writeLine(`ANCILLARY ADDED: ${m[1].trim().toUpperCase()} - EUR ${price.toFixed(2)}`, "ok");
  },
  FXA: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const options = pnr.segments.map((seg, i) => {
      const cheapest = cheapestAvailableClass(seg);
      return { segIdx: i, cabin: cheapest, fare: computeFare(pnr, idx, true) };
    }).filter(o => o.cabin !== pnr.segments[o.segIdx].cabin);
    if (!options.length) return writeLine("NO LOWER FARES FOUND - ALREADY ON THE LOWEST AVAILABLE CLASS", "hint");
    AMX.state.bestBuyOptions = { idx, options };
    writeLine("BEST BUY - LOWER FARES AVAILABLE", "ok");
    options.forEach((o, i) => writeLine(`${i + 1}. SEGMENT ${o.segIdx + 1} -> CLASS ${o.cabin}  ${o.fare.currency} ${o.fare.total.toFixed(2)}`, "hint"));
    writeLine("SELECT WITH FXU<N> (STORE TST) OR FXZ<N> (NO TST)", "hint");
  },
  FXU: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+)/);
    if (!m || !AMX.state.bestBuyOptions) return writeLine("FORMAT: FXU<N> - RUN FXA FIRST", "err");
    const pnr = ensurePNR();
    const sel = AMX.state.bestBuyOptions.options[parseInt(m[1], 10) - 1];
    if (!sel) return writeLine("OPTION NOT FOUND", "err");
    pnr.segments[sel.segIdx].cabin = sel.cabin;
    const fare = decorateFare(pnr, computeFare(pnr, AMX.state.bestBuyOptions.idx, true));
    pnr.fare = fare;
    pnr.tst.push({ id: pnr.tst.length + 1, ...fare, createdAt: fmt.nowDate() });
    addHistory(pnr, `BEST BUY REBOOKED SEGMENT ${sel.segIdx + 1} TO ${sel.cabin} - TST${pnr.tst.length}`, "CF");
    AMX.state.bestBuyOptions = null;
    writeLine(`REBOOKED TO ${sel.cabin} - TST${pnr.tst.length} CREATED - ${fare.currency} ${fare.total.toFixed(2)}`, "ok");
  },
  FXZ: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+)/);
    if (!m || !AMX.state.bestBuyOptions) return writeLine("FORMAT: FXZ<N> - RUN FXA FIRST", "err");
    const pnr = ensurePNR();
    const sel = AMX.state.bestBuyOptions.options[parseInt(m[1], 10) - 1];
    if (!sel) return writeLine("OPTION NOT FOUND", "err");
    pnr.segments[sel.segIdx].cabin = sel.cabin;
    addHistory(pnr, `BEST BUY REBOOKED SEGMENT ${sel.segIdx + 1} TO ${sel.cabin} (NO TST STORED)`, "CF");
    AMX.state.bestBuyOptions = null;
    writeLine(`REBOOKED TO ${sel.cabin} - NOT STORED AS A TST (USE FQQ TO VIEW FARE DETAILS)`, "ok");
  },
  FXL: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const lowestLetter = Object.keys(CLASS_RATE).reduce((best, l) => CLASS_RATE[l] < CLASS_RATE[best] ? l : best);
    const soldOut = pnr.segments.some(seg => (seg.classes || "").split(" ").some(t => t[0] === lowestLetter && parseInt(t.slice(1), 10) === 0));
    const fare = computeFare(pnr, idx, true);
    if (soldOut) writeLine("LOWEST SOLD OUT // TRY WAITLIST", "err");
    writeLine(`LOWEST APPLICABLE FARE: ${fare.currency} ${fare.total.toFixed(2)}`, "ok");
  },
  TTP: (arg) => {
    const pnr = ensurePNR();
    const a = arg.trim().toUpperCase();

    const etrvMatch = a.match(/^\/ETRV\/L(\d+)(?:\/E\d+)?(?:\/S[\d,-]+)?$/);
    if (etrvMatch) {
      const ticket = pnr.tickets[parseInt(etrvMatch[1], 10) - 1];
      if (!ticket) return writeLine("TICKET NOT FOUND", "err");
      if ((ticket.status || "O") !== "O") return writeLine("ONLY AN OPEN (STATUS O) TICKET CAN BE REVALIDATED", "err");
      ticket.revalidated = true;
      addHistory(pnr, `REVALIDATED TICKET ${ticket.number}`, "CS");
      savePNR(pnr);
      return writeLine(`TICKET ${ticket.number} REVALIDATED - SEGMENT DATA UPDATED, NO FARE CHANGE`, "ok");
    }

    const tst = pnrTstLatest(pnr);
    if (!tst) return writeLine("NO TST ON FILE - PRICE WITH FXP OR FXB FIRST", "err");
    if (!pnr.validatingCarrier) return writeLine("VALIDATING CARRIER REQUIRED - ENTER FV<CARRIER>", "err");
    if (!pnr.formOfPayment) return writeLine("FORM OF PAYMENT REQUIRED - ENTER FP", "err");

    let scopeIdx;
    let tMatch = a.match(/^\/T(\d+)$/);
    if (tMatch) {
      const chosen = pnr.tst[parseInt(tMatch[1], 10) - 1];
      if (!chosen) return writeLine("TST NOT FOUND", "err");
      scopeIdx = chosen.scope;
    } else if (a === "/PAX") {
      scopeIdx = pnr.passengers.map((p, i) => i).filter(i => pnr.passengers[i].type !== "INF");
    } else if (a === "/INF") {
      scopeIdx = pnr.passengers.map((p, i) => i).filter(i => pnr.passengers[i].type === "INF");
    } else {
      const pMatch = a.match(/^\/P(\d+)$/);
      scopeIdx = pMatch ? [parseInt(pMatch[1], 10) - 1] : tst.scope;
    }
    if (!scopeIdx || !scopeIdx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");

    const airline = AMX.state.world.airlines.find(al => al.code === pnr.validatingCarrier);
    const numeric = airline ? airline.numeric : "999";
    const originalRef = pnr.fare?.originalTicket;
    const issued = [];
    scopeIdx.forEach(i => {
      if (!pnr.passengers[i]) return;
      const serial = String(Math.floor(1000000000 + Math.random() * 9000000000));
      const t = { number: `${numeric}-${serial}`, passengerIndex: i, carrier: pnr.validatingCarrier, issuedAt: fmt.nowDate(), status: "O", tstId: tst.id };
      if (originalRef && originalRef.passengerIndex === i) {
        t.reissueOf = originalRef.number;
        const orig = pnr.tickets.find(tk => tk.number === originalRef.number);
        if (orig) orig.status = "E";
      }
      pnr.tickets.push(t);
      issued.push(t);
    });
    if (originalRef) pnr.fare.originalTicket = null;
    addHistory(pnr, `TICKETED ${issued.length} PAX${originalRef ? " (REISSUE)" : ""}`, originalRef ? "CT" : undefined);
    savePNR(pnr);
    writeLine(`TTP - ${issued.length} TICKET(S) ISSUED${originalRef ? " (REISSUE - ADDITIONAL COLLECTION " + tst.currency + " " + (tst.additionalCollection || 0).toFixed(2) + ")" : ""}`, "ok");
    issued.forEach(t => { printTicketBlock(pnr, t); AMX.state.lastTicket = t; });
  },
  "ITR/P": () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR TO PRINT", "err");
    writeHTML(renderItineraryHTML(pnr));
    const printWindow = window.open('', '_blank');
    if (!printWindow) return writeLine("PRINT BLOCKED BY THE BROWSER - ALLOW POP-UPS FOR THIS SITE AND TRY AGAIN", "err");
    printWindow.document.write(buildTicketPrintHTML(pnr));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  },
  TWD: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.tickets || !pnr.tickets.length) return writeLine("NO TICKET ON FILE", "err");
    const a = arg.trim().toUpperCase();
    const tst = pnrTstLatest(pnr);
    if (a === "/TAX") {
      writeLine("TAX BREAKDOWN:", "ok");
      (tst?.taxBreakdown || []).forEach(tb => writeLine(`  TAX      ${tb.amount.toFixed(2)}${tb.code}`, "hint"));
      writeLine(`  TOTALTAX ${tst?.currency || "EUR"} ${(tst?.taxes || 0).toFixed(2)}`, "hint");
      return;
    }
    let ticket;
    const lMatch = a.match(/^\/L(\d+)$/);
    const tMatch = a.match(/^\/TKT(.+)$/);
    if (lMatch) ticket = pnr.tickets[parseInt(lMatch[1], 10) - 1];
    else if (tMatch) ticket = pnr.tickets.find(t => t.number === tMatch[1]);
    else ticket = pnr.tickets[pnr.tickets.length - 1];
    if (!ticket) return writeLine("TICKET NOT FOUND", "err");
    printTicketBlock(pnr, ticket);
    AMX.state.lastTicket = ticket;
  },
  TWH: () => {
    const t = AMX.state.lastTicket;
    if (!t) return writeLine("NO TICKET DISPLAYED - USE TWD FIRST", "err");
    writeLine(`TICKET HISTORY FOR ${t.number}`, "ok");
    writeLine(`ISSUED ${t.issuedAt}  STATUS ${t.status || "O"} - ${ticketStatusLabel(t.status)}`, "hint");
  },
  TWX: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.tickets?.length) return writeLine("NO TICKET ON FILE", "err");
    const a = arg.trim().toUpperCase();
    let ticket;
    const lMatch = a.match(/^\/L(\d+)$/);
    const tMatch = a.match(/^\/TKT(.+)$/) || a.match(/^\/TK-(.+)$/);
    if (lMatch) ticket = pnr.tickets[parseInt(lMatch[1], 10) - 1];
    else if (tMatch) ticket = pnr.tickets.find(t => t.number === tMatch[1]);
    else ticket = AMX.state.lastTicket || pnr.tickets[pnr.tickets.length - 1];
    if (!ticket) return writeLine("NO TICKET DISPLAYED - USE TWD FIRST, THEN TWX", "err");
    if (ticket.status === "V") return writeLine("TICKET ALREADY VOID", "err");
    if (ticket.status === "E") return writeLine("CANNOT VOID A REISSUED TICKET", "err");
    const sac = `${ticket.carrier}${Math.floor(10000000 + Math.random() * 90000000)}`;
    ticket.status = "V";
    ticket.sac = sac;
    addHistory(pnr, `VOIDED TICKET ${ticket.number} SAC-${sac}`, "CS");
    savePNR(pnr);
    writeLine(`OK-ETKT UPDATED SAC-${sac}`, "ok");
    writeLine("SALE IS CANCELLED IN REPORTING SYSTEM", "ok");
  },
  TGBD: (arg) => {
    const m = arg.trim().toUpperCase().match(/^-([A-Z]{2})$/);
    if (!m) return writeLine("FORMAT: TGBD-<ISO COUNTRY CODE>", "err");
    const country = (AMX.state.world.countries || []).find(c => c.code === m[1]);
    if (!country) return writeLine("COUNTRY NOT FOUND", "err");
    const carriers = [...new Set(AMX.state.world.routes.filter(r => AMX.state.world.airports.some(a => a.code === r[0] && a.country === m[1])).map(r => r[2]))];
    writeLine(`BSP/ARP PARTICIPANTS - ${country.name}`, "ok");
    (carriers.length ? carriers : ["NONE ON FILE"]).forEach(c => writeLine(c, "hint"));
  },
  TGAD: (arg) => {
    const m = arg.trim().toUpperCase().match(/^-([A-Z0-9]{2,3})(?:\/([A-Z0-9]{2,3}))?$/);
    if (!m) return writeLine("FORMAT: TGAD-<CARRIER>[/<CARRIER2>]", "err");
    const al1 = AMX.state.world.airlines.find(a => a.code === m[1]);
    if (!al1) return writeLine("CARRIER NOT FOUND", "err");
    if (m[2]) {
      const al2 = AMX.state.world.airlines.find(a => a.code === m[2]);
      if (!al2) return writeLine("CARRIER NOT FOUND", "err");
      writeLine(`TICKETING/INTERLINE AGREEMENT ${m[1]}-${m[2]}: ACTIVE`, "ok");
    } else {
      writeLine(`${al1.name} (${m[1]}) TICKETING AGREEMENTS: ALL AMADEUS PARTICIPATING CARRIERS`, "ok");
    }
  },
  TTK: (arg) => {
    const pnr = ensurePNR();
    const a = arg.trim().toUpperCase();
    const tMatch = a.match(/^\/T(\d+)\//);
    const tst = tMatch ? pnr.tst[parseInt(tMatch[1], 10) - 1] : pnrTstLatest(pnr);
    if (!tst) return writeLine("NO TST ON FILE - PRICE WITH FXP FIRST", "err");
    const body = tMatch ? a.slice(tMatch[0].length) : a.replace(/^\//, "");
    let m;
    if ((m = body.match(/^NF-(\d+(?:\.\d+)?)$/))) { tst.netFare = parseFloat(m[1]); addHistory(pnr, `TTK SET NET FARE ${m[1]}`, "CF"); return writeLine(`NET FARE SET: ${tst.currency} ${m[1]}`, "ok"); }
    if ((m = body.match(/^V(\d{1,2}[A-Z]{3})(\d{1,2}[A-Z]{3})$/))) { tst.nvb = m[1]; tst.nva = m[2]; addHistory(pnr, `TTK SET NVB/NVA ${m[1]}/${m[2]}`, "CF"); return writeLine(`NVB ${m[1]}  NVA ${m[2]} SET`, "ok"); }
    if ((m = body.match(/^F(\d+(?:\.\d+)?)$/))) { tst.base = parseFloat(m[1]); addHistory(pnr, `TTK OVERRODE FARE AMOUNT ${m[1]}`, "CF"); return writeLine(`FARE AMOUNT SET: ${tst.currency} ${m[1]}`, "ok"); }
    if ((m = body.match(/^X(\d+(?:\.\d+)?)([A-Z]{2})$/))) { tst.taxBreakdown = tst.taxBreakdown || []; tst.taxBreakdown.push({ code: m[2], amount: parseFloat(m[1]) }); addHistory(pnr, `TTK ADDED TAX ${m[2]} ${m[1]}`, "CF"); return writeLine(`TAX ${m[2]} ${tst.currency} ${m[1]} ADDED`, "ok"); }
    if ((m = body.match(/^T(\d+(?:\.\d+)?)$/))) { tst.additionalCollection = parseFloat(m[1]); addHistory(pnr, `TTK SET ADDITIONAL COLLECTION ${m[1]}`, "CF"); return writeLine(`ADDITIONAL COLLECTION SET: ${tst.currency} ${m[1]}`, "ok"); }
    writeLine("FORMAT: TTK/NF-<AMT> | TTK/V<DDMMM><DDMMM> | TTK/F<AMT> | TTK/X<AMT><TAXCODE> | TTK/T<AMT> (PREFIX /T<N>/ TO TARGET A SPECIFIC TST)", "err");
  },
  TTU: (arg) => {
    const m = arg.trim().toUpperCase().match(/^\/T(\d+)\/S([\d,-]+)$/);
    if (!m) return writeLine("FORMAT: TTU/T<TST#>/S<SEGMENTS>", "err");
    const pnr = ensurePNR();
    const tst = pnr.tst[parseInt(m[1], 10) - 1];
    if (!tst) return writeLine("TST NOT FOUND", "err");
    tst.reissueSegments = m[2];
    addHistory(pnr, `TTU ATTACHED SEGMENTS ${m[2]} TO TST${m[1]} FOR REISSUE`, "CF");
    writeLine(`TST${m[1]} FLAGGED FOR REISSUE ON SEGMENTS ${m[2]}`, "ok");
  },
  TTF: () => writeLine("CHANGE FLAG REMOVED FROM TST", "ok"),
  FE: (arg) => {
    const pnr = ensurePNR();
    pnr.endorsementOverride = arg.trim().toUpperCase();
    addHistory(pnr, `SET ENDORSEMENT: ${pnr.endorsementOverride}`, "CF");
    writeLine("ENDORSEMENT SET - WILL PRINT ON TWD/TTP/ITR/P", "ok");
  },
  FT: (arg) => {
    const pnr = ensurePNR();
    pnr.tourCode = arg.trim().toUpperCase();
    addHistory(pnr, `SET TOUR CODE: ${pnr.tourCode}`, "CF");
    writeLine(`TOUR CODE SET: ${pnr.tourCode}`, "ok");
  },
  "FO*L": (arg) => {
    const pnr = AMX.state.pnr;
    const m = arg.trim().toUpperCase().match(/^(\d+)(?:\/P(\d+))?(?:\/S[\d,-]+)?$/);
    if (!pnr || !m) return writeLine("FORMAT: FO*L<TICKET LINE>[/P<PAX#>][/S<SEGMENTS>]", "err");
    const ticket = pnr.tickets[parseInt(m[1], 10) - 1];
    if (!ticket) return writeLine("TICKET NOT FOUND", "err");
    if ((ticket.status || "O") !== "O") return writeLine("ORIGINAL TICKET MUST BE OPEN (STATUS O) TO REISSUE", "err");
    if (!pnr.fare) return writeLine("PRICE THE NEW ITINERARY FIRST (FXP)", "err");
    const paxIndex = m[2] ? parseInt(m[2], 10) - 1 : ticket.passengerIndex;
    pnr.fare.originalTicket = { number: ticket.number, passengerIndex: paxIndex, issuedAt: ticket.issuedAt };
    addHistory(pnr, `FO* PULLED ORIGINAL ISSUE DATA FROM TICKET ${ticket.number}`, "CF");
    writeLine(`ORIGINAL ISSUE DATA ATTACHED - TICKET ${ticket.number} WILL BE MARKED EXCHANGED ON NEXT TTP`, "ok");
  },
  TRF: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.tickets?.length) return writeLine("NO TICKET ON FILE", "err");
    const a = arg.trim().toUpperCase();
    const lMatch = a.match(/^\/L(\d+)$/);
    const ticket = lMatch ? pnr.tickets[parseInt(lMatch[1], 10) - 1] : pnr.tickets[pnr.tickets.length - 1];
    if (!ticket) return writeLine("FORMAT: TRF[/L<n>]", "err");
    if (ticket.status === "R") return writeLine("TICKET ALREADY REFUNDED", "err");
    if (ticket.status === "V") return writeLine("CANNOT REFUND A VOIDED TICKET", "err");
    const fare = pnr.fare;
    if (!fare) return writeLine("NO FARE ON FILE FOR THIS PNR", "err");
    const nonRefundable = !!fare.lowest;
    AMX.state.refundDraft = { ticket, pnrLocator: pnr.recordLocator, fare, penalty: nonRefundable ? fare.total : Math.min(150, Math.round(fare.total * 0.15 * 100) / 100), used: 0 };
    addHistory(pnr, `TRF - OPENED REFUND RECORD FOR ${ticket.number}`);
    writeLine(`REFUND RECORD OPENED - ${ticket.number}`, "ok");
    writeLine(`FARE PAID    ${fare.currency} ${fare.total.toFixed(2)}`, "hint");
    writeLine(`CANX FEE     ${fare.currency} ${AMX.state.refundDraft.penalty.toFixed(2)}${nonRefundable ? " (NONREFUNDABLE FARE)" : ""}`, "hint");
    writeLine("USE TRFU/CP<AMT>[A] TO ADJUST PENALTY, TRFU/U<AMT> FOR USED FARE, TRFT FOR TAXES, TRFP TO PROCESS, TRFIG TO DISCARD", "hint");
  },
  TRFU: (arg) => {
    const draft = AMX.state.refundDraft;
    if (!draft) return writeLine("NO REFUND RECORD OPEN - USE TRF FIRST", "err");
    const a = arg.trim().toUpperCase();
    let m;
    if ((m = a.match(/^\/CP(\d+(?:\.\d+)?)(A)?$/))) {
      draft.penalty = m[2] ? parseFloat(m[1]) : Math.round(draft.fare.total * (parseFloat(m[1]) / 100) * 100) / 100;
      writeLine(`CANCELLATION PENALTY SET: ${draft.fare.currency} ${draft.penalty.toFixed(2)}`, "ok");
      return;
    }
    if ((m = a.match(/^\/U(\d+(?:\.\d+)?)$/))) {
      draft.used = parseFloat(m[1]);
      writeLine(`FARE USED SET: ${draft.fare.currency} ${draft.used.toFixed(2)}`, "ok");
      return;
    }
    writeLine("FORMAT: TRFU/CP<AMOUNT>[A] (A=AMOUNT, OMIT FOR PERCENT) | TRFU/U<USED FARE AMOUNT>", "err");
  },
  TRFT: () => {
    const draft = AMX.state.refundDraft;
    if (!draft) return writeLine("NO REFUND RECORD OPEN - USE TRF FIRST", "err");
    writeLine("REFUNDABLE TAXES", "ok");
    (draft.fare.taxBreakdown || []).forEach(tb => writeLine(`${tb.code}  ${draft.fare.currency} ${tb.amount.toFixed(2)}`, "hint"));
    writeLine(`REFUNDABLE TAX TOTAL ${draft.fare.currency} ${(draft.fare.taxes || 0).toFixed(2)}`, "hint");
  },
  TRFIG: () => {
    if (!AMX.state.refundDraft) return writeLine("NO REFUND RECORD OPEN", "err");
    AMX.state.refundDraft = null;
    writeLine("REFUND RECORD IGNORED", "ok");
  },
  TRFP: () => {
    const draft = AMX.state.refundDraft;
    if (!draft) return writeLine("NO REFUND RECORD OPEN - USE TRF FIRST", "err");
    const pnr = AMX.state.pnr;
    const refundable = Math.max(0, draft.fare.total - draft.used);
    const refundAmount = Math.round(Math.max(0, refundable - draft.penalty) * 100) / 100;
    draft.ticket.status = "R";
    draft.ticket.refundAmount = refundAmount;
    const sac = `${draft.ticket.carrier}${Math.floor(10000000 + Math.random() * 90000000)}`;
    addHistory(pnr, `TRFP - REFUND PROCESSED ${draft.ticket.number} ${draft.fare.currency} ${refundAmount.toFixed(2)} (FEE ${draft.fare.currency} ${draft.penalty.toFixed(2)})`, "CS");
    savePNR(pnr);
    writeLine(`OK-ETKT RECORD UPDATED SAC-${sac}`, "ok");
    writeLine("OK - REFUND PROCESSED", "ok");
    writeLine(`REFUND TOTAL ${draft.fare.currency} ${refundAmount.toFixed(2)}`, "hint");
    AMX.state.refundDraft = null;
  },
  TJQ: (arg) => {
    const a = arg.trim().toUpperCase();
    const tokens = a.split("/").filter(Boolean);
    let dateFrom = null, dateTo = null, carrierFilter = null, typeFilter = null;
    tokens.forEach(t => {
      let m;
      if ((m = t.match(/^D-(\d{1,2}[A-Z]{3})(\d{1,2}[A-Z]{3})?$/))) { dateFrom = m[1]; dateTo = m[2] || m[1]; }
      else if ((m = t.match(/^QVP-([A-Z0-9]{2,3})$/))) carrierFilter = m[1];
      else if ((m = t.match(/^QTC-([A-Z]+)$/))) typeFilter = m[1];
    });
    const rows = [];
    allStoredPNRs().forEach(pnr => {
      (pnr.tickets || []).forEach(t => {
        if (carrierFilter && t.carrier !== carrierFilter) return;
        if (typeFilter === "RFND" && !["V", "R"].includes(t.status)) return;
        rows.push({ locator: pnr.recordLocator, ticket: t });
      });
    });
    writeLine(`SALES REPORT ${dateFrom ? dateFrom + "-" + dateTo : fmt.nowDate()}`, "ok");
    if (!rows.length) return writeLine("NO TICKETS FOUND", "hint");
    rows.forEach(r => writeLine(`${r.locator}  ${r.ticket.number}  ${r.ticket.carrier}  ${r.ticket.status || "O"} - ${ticketStatusLabel(r.ticket.status)}`, "hint"));
  },

  // Passenger Servicing
  SM: (arg) => {
    const pnr = ensurePNR();
    const segIdx = parseInt(arg.trim(), 10) - 1;
    const seg = pnr.segments[segIdx];
    if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
    if (!seg.seatMap) seg.seatMap = generateSeatMap(seg.cabin);
    const { letters, rows } = seg.seatMap;
    writeLine(`SEAT MAP FOR SEGMENT ${segIdx + 1} - ${seg.carrier}${seg.flight} ${seg.cabin || "Y"} CLASS`, "ok");
    writeLine(`      ${letters.join("  ")}`, "hint");
    rows.forEach(r => writeLine(`${String(r.row).padStart(3)}   ${letters.map(l => r.seats[l]).join("  ")}`, "hint"));
    writeLine("O = AVAILABLE   X = OCCUPIED", "hint");
  },
  ST: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^\/?(\d+)([A-Z])\/P(\d+)$/);
    if (!m) return writeLine("FORMAT: ST/<SEAT>/P<PAX#>", "err");
    const [, rowStr, letter, paxIdx] = m;
    const seat = `${rowStr}${letter}`;
    if (!pnr.passengers[paxIdx - 1]) return writeLine("PASSENGER NOT FOUND", "err");
    if (!pnr.segments.length) return writeLine("NO FLIGHTS TO ASSIGN SEATS TO", "err");
    for (const seg of pnr.segments) {
      if (!seg.seatMap) seg.seatMap = generateSeatMap(seg.cabin);
      const row = seg.seatMap.rows.find(r => String(r.row) === rowStr);
      if (!row || !(letter in row.seats)) return writeLine(`SEAT ${seat} DOES NOT EXIST ON THIS AIRCRAFT`, "err");
      if (row.seats[letter] === "X" && seg.seats?.[paxIdx - 1] !== seat) return writeLine(`SEAT ${seat} IS ALREADY OCCUPIED`, "err");
    }
    pnr.segments.forEach(seg => {
      if (!seg.seats) seg.seats = [];
      seg.seats[paxIdx - 1] = seat;
      const row = seg.seatMap.rows.find(r => String(r.row) === rowStr);
      if (row) row.seats[letter] = "X";
    });
    addHistory(pnr, `ASSIGNED SEAT ${seat} TO PAX ${paxIdx}`);
    writeLine(`SEAT ${seat} ASSIGNED TO PAX ${paxIdx} FOR ALL SEGMENTS`, "ok");
  },

  // Queues
  QE: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+)(?:C(\d))?$/);
    if (!m) return writeLine("FORMAT: QE<QUEUE NUMBER>[C<CATEGORY>]", "err");
    const [, n, cat] = m;
    const pnr = AMX.state.pnr;
    if (!pnr?.recordLocator) return writeLine("PNR MUST BE SAVED (ER) BEFORE QUEUING", "err");
    placeOnQueue(n, pnr.recordLocator, cat ? `C${cat}` : "C1");
    addHistory(pnr, `PLACED ON QUEUE ${n}${cat ? "C" + cat : ""}`, "AO");
    writeLine(`PNR ${pnr.recordLocator} PLACED ON QUEUE ${n}${cat ? " CATEGORY " + cat : ""}`, "ok");
  },
  QTQ: () => {
    writeLine("QUEUE COUNT TOTAL", "ok");
    Object.keys(AMX.state.queues).sort((a, b) => a - b).forEach(n => {
      const q = AMX.state.queues[n];
      writeLine(`${n}  ${q.name.padEnd(20)} ${q.pnrs.length}`, "hint");
    });
  },
  QC: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+)(CA|CE|C(\d))$/);
    if (!m) return writeLine("FORMAT: QC<QUEUE NUMBER><CA|CE|C<CATEGORY>>", "err");
    const [, n, mode, catDigit] = m;
    const q = ensureQueue(n);
    writeLine(`QUEUE COUNT ${n} (${q.name})`, "ok");
    if (mode === "CA" || mode === "CE") {
      const byCat = {};
      q.pnrs.forEach(loc => { const c = queueCategory(q, loc); byCat[c] = (byCat[c] || 0) + 1; });
      const cats = Object.keys(byCat);
      if (!cats.length) return writeLine("NO ACTIVE CATEGORIES", "hint");
      cats.sort().forEach(c => writeLine(`${c}  ${byCat[c]}`, "hint"));
    } else {
      const cat = `C${catDigit}`;
      const count = q.pnrs.filter(loc => queueCategory(q, loc) === cat).length;
      writeLine(`${cat}  ${count}`, "hint");
    }
  },
  QT: (arg) => {
    const m = arg.trim().toUpperCase().match(/^(\d+)(?:C(\d))?$/);
    if (!m) return writeLine("FORMAT: QT<QUEUE NUMBER>", "err");
    const [, n, cat] = m;
    const q = ensureQueue(n);
    const pool = cat ? q.pnrs.filter(loc => queueCategory(q, loc) === `C${cat}`) : q.pnrs;
    if (!pool.length) { AMX.state.queueBrowse = null; return writeLine(`QUEUE ${n}${cat ? "C" + cat : ""} (${q.name}) IS EMPTY`, "ok"); }
    AMX.state.queueBrowse = { qnum: n, pos: 0, category: cat ? `C${cat}` : null };
    const locator = pool[0];
    const pnr = loadPNR(locator);
    writeLine(`QUEUE ${n}${cat ? "C" + cat : ""} (${q.name}) - ${pool.length} PNR(S)`, "ok");
    writeLine(`1. ${locator} ${(pnr?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
  },
  QS: (arg) => commands.QT(arg),
  QN: () => {
    const b = AMX.state.queueBrowse;
    if (!b) return writeLine("NO QUEUE OPEN - USE QT<N> FIRST", "err");
    const q = AMX.state.queues[b.qnum];
    const idx = b.category ? q.pnrs.findIndex(loc => queueCategory(q, loc) === b.category) : 0;
    const locator = idx === -1 ? undefined : q.pnrs.splice(idx, 1)[0];
    if (!locator) { AMX.state.queueBrowse = null; return writeLine("QUEUE EMPTY", "ok"); }
    delete q.categories[locator];
    AMX.state.pnr = loadPNR(locator);
    writeLine(`ACTIONED ${locator} - REMOVED FROM QUEUE ${b.qnum}`, "ok");
    const pool = b.category ? q.pnrs.filter(loc => queueCategory(q, loc) === b.category) : q.pnrs;
    if (pool.length) {
      const next = loadPNR(pool[0]);
      writeLine(`NEXT: ${pool[0]} ${(next?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
    } else {
      writeLine(`QUEUE ${b.qnum} IS NOW EMPTY`, "hint");
      AMX.state.queueBrowse = null;
    }
  },
  QD: () => {
    const b = AMX.state.queueBrowse;
    if (!b) return writeLine("NO QUEUE OPEN - USE QT<N> FIRST", "err");
    const q = AMX.state.queues[b.qnum];
    const idx = b.category ? q.pnrs.findIndex(loc => queueCategory(q, loc) === b.category) : 0;
    const locator = idx === -1 ? undefined : q.pnrs.splice(idx, 1)[0];
    if (!locator) return writeLine("QUEUE EMPTY", "ok");
    q.pnrs.push(locator);
    writeLine(`${locator} DELAYED TO BOTTOM OF QUEUE ${b.qnum}`, "ok");
    const pool = b.category ? q.pnrs.filter(loc => queueCategory(q, loc) === b.category) : q.pnrs;
    if (pool.length) {
      const next = loadPNR(pool[0]);
      writeLine(`NEXT: ${pool[0]} ${(next?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
    }
  },
  QI: () => {
    if (!AMX.state.queueBrowse) return writeLine("NO QUEUE OPEN", "err");
    AMX.state.queueBrowse = null;
    writeLine("EXITED QUEUE", "ok");
  },

  // Profiles
  PM: () => { AMX.state.profileMode = true; writeLine("****PM MODE**** PROFILE MODE ACTIVE", "ok"); },
  PME: () => { AMX.state.profileMode = false; AMX.state.profileDraft = null; writeLine("EXITED PROFILE MODE", "ok"); },
  PMP: () => { AMX.state.profileMode = false; writeLine("PROFILE MODE SUSPENDED TEMPORARILY - PM TO RESUME", "ok"); },
  PEE: () => {
    const d = AMX.state.profileDraft;
    if (!d || !d.index) return writeLine("NO PROFILE INDEX SET - USE PIN/<NAME> FIRST", "err");
    AMX.state.profiles[d.index] = d;
    AMX.state.profileMode = false;
    AMX.state.profileDraft = null;
    writeLine(`PROFILE SAVED: ${d.index} - EXITED PROFILE MODE`, "ok");
  },
  PIR: () => {
    const d = AMX.state.profileDraft;
    AMX.state.profileDraft = null;
    if (d && d.index && AMX.state.profiles[d.index]) AMX.state.profileDraft = AMX.state.profiles[d.index];
    writeLine("PROFILE UPDATES IGNORED - REDISPLAYED ORIGINAL", "ok");
  },
  "PCN/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.companyName = arg.trim().toUpperCase();
    writeLine(`COMPANY PROFILE NAME SET: ${AMX.state.profileDraft.companyName}`, "ok");
  },
  "PBC/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.billingContact = arg.trim().toUpperCase();
    writeLine(`BILLING CONTACT SET: ${AMX.state.profileDraft.billingContact}`, "ok");
  },
  "PBP/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.billingPhone = arg.trim();
    writeLine(`BILLING PHONE SET: ${AMX.state.profileDraft.billingPhone}`, "ok");
  },
  "PCO/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.countryCode = arg.trim().toUpperCase();
    writeLine(`PROFILE COUNTRY CODE SET: ${AMX.state.profileDraft.countryCode}`, "ok");
  },
  "PBD/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.dob = arg.trim().toUpperCase();
    writeLine(`DATE OF BIRTH SET: ${AMX.state.profileDraft.dob}`, "ok");
  },
  "PC/": (arg) => {
    const m = arg.match(/^-(\d+)$/);
    if (!m) return writeLine("FORMAT: PC/-<PAX NUMBER>", "err");
    const pnr = AMX.state.pnr;
    const pax = pnr?.passengers[parseInt(m[1], 10) - 1];
    if (!pax) return writeLine("PASSENGER NOT FOUND", "err");
    AMX.state.profileDraft = { index: null, name: pax.name, contacts: { ...(pnr.contacts || {}) } };
    writeLine(`PROFILE DRAFT CREATED FOR ${pax.name}`, "ok");
  },
  "PIN/": (arg) => {
    if (!AMX.state.profileDraft) AMX.state.profileDraft = { index: null, name: null, contacts: {} };
    AMX.state.profileDraft.index = arg.trim();
    writeLine(`PROFILE INDEX SET: ${arg.trim()}`, "ok");
  },
  PER: () => {
    const d = AMX.state.profileDraft;
    if (!d || !d.index) return writeLine("NO PROFILE INDEX SET - USE PIN/<NAME> FIRST", "err");
    AMX.state.profiles[d.index] = d;
    writeLine(`PROFILE SAVED: ${d.index}`, "ok");
  },
  PI: () => {
    if (!AMX.state.profileDraft) return writeLine("NO PROFILE DRAFT TO IGNORE", "err");
    AMX.state.profileDraft = null;
    writeLine("PROFILE DRAFT DISCARDED", "ok");
  },
  "PDI/": (arg) => {
    const p = AMX.state.profiles[arg.trim()];
    if (!p) return writeLine("PROFILE NOT FOUND", "err");
    AMX.state.profileDraft = p;
    writeLine(`PROFILE: ${p.name || ""} [${p.index}]`, "ok");
  },
  "PDN/": (arg) => {
    const q = arg.trim().replace(/^-/, "").toUpperCase();
    const matches = Object.values(AMX.state.profiles).filter(p => (p.name || "").toUpperCase().startsWith(q));
    if (!matches.length) return writeLine("PROFILE NOT FOUND", "err");
    AMX.state.profileDraft = matches[0];
    writeLine(`PROFILE: ${matches[0].name} [${matches[0].index}]`, "ok");
  },
  PD: () => {
    const d = AMX.state.profileDraft;
    if (!d) return writeLine("NO PROFILE DISPLAYED", "err");
    writeLine(`PROFILE [${d.index || "UNSAVED"}]: ${d.name || ""}`, "ok");
    writeLine(`CONTACTS: ${JSON.stringify(d.contacts || {})}`, "hint");
  },
  PT: () => {
    const d = AMX.state.profileDraft;
    if (!d) return writeLine("NO PROFILE LOADED", "err");
    const pnr = ensurePNR();
    if (d.name) pnr.passengers.push({ name: d.name, type: "ADT" });
    pnr.contacts = { ...pnr.contacts, ...(d.contacts || {}) };
    addHistory(pnr, `TRANSFERRED PROFILE ${d.index || ""}`);
    writeLine("PROFILE ELEMENTS TRANSFERRED TO PNR", "ok");
  },

  // Decode / Encode
  DAN: (arg) => {
    const q = arg.trim().toUpperCase();
    if (!q) return writeLine("FORMAT: DAN <CITY OR AIRPORT NAME>", "err");
    const airportMatches = AMX.state.world.airports.filter(a => a.city.includes(q) || a.name.toUpperCase().includes(q));
    const countryMatches = (AMX.state.world.countries || []).filter(c => c.name.includes(q));
    if (!airportMatches.length && !countryMatches.length) return writeLine("NO MATCH FOUND", "err");
    writeLine(`DECODE ACCESS NAME: ${q}`, "ok");
    airportMatches.forEach(a => writeLine(`${a.code}  ${a.city}, ${a.name} (${a.country})`, "hint"));
    countryMatches.forEach(c => writeLine(`${c.code}  ${c.name} (COUNTRY)`, "hint"));
  },
  DAC: (arg) => {
    const q = arg.trim().toUpperCase();
    const airport = AMX.state.world.airports.find(a => a.code === q);
    if (airport) return writeLine(`${airport.code}  ${airport.city}, ${airport.name} (${airport.country})`, "ok");
    const country = (AMX.state.world.countries || []).find(c => c.code === q);
    if (country) return writeLine(`${country.code}  ${country.name}`, "ok");
    writeLine("CODE NOT FOUND", "err");
  },
  DC: (arg) => {
    const q = arg.trim().toUpperCase();
    const byCode = (AMX.state.world.countries || []).find(c => c.code === q);
    if (byCode) return writeLine(`${byCode.code}  ${byCode.name}`, "ok");
    const byName = (AMX.state.world.countries || []).find(c => c.name === q || c.name.includes(q));
    if (byName) return writeLine(`${byName.name}  ${byName.code}`, "ok");
    writeLine("COUNTRY NOT FOUND", "err");
  },
  DNA: (arg) => {
    const q = arg.trim().toUpperCase();
    const byCode = AMX.state.world.airlines.find(a => a.code === q);
    if (byCode) return writeLine(`${byCode.name} / ${byCode.code} / ${byCode.numeric}`, "ok");
    const byName = AMX.state.world.airlines.filter(a => a.name.toUpperCase().includes(q));
    if (byName.length) return byName.forEach(a => writeLine(`${a.name} / ${a.code} / ${a.numeric}`, "ok"));
    writeLine("AIRLINE NOT FOUND", "err");
  },

  // Dynamic Travel Document
  "IEP-EML-": (arg) => {
    const pnr = ensurePNR();
    addHistory(pnr, `EMAILED ITINERARY TO ${arg.trim()}`);
    writeLine(`ITINERARY EMAILED TO ${arg.trim()} (SIMULATED - NO EMAIL SENT)`, "ok");
  },
  "IEPJ-EML-": (arg) => {
    const pnr = ensurePNR();
    addHistory(pnr, `EMAILED ITINERARY (ALL PAX) TO ${arg.trim()}`);
    writeLine(`ITINERARY EMAILED TO ${arg.trim()} FOR ALL PASSENGERS (SIMULATED)`, "ok");
  },
  "IEP-EMLA": () => {
    const pnr = ensurePNR();
    const email = pnr.contacts?.email;
    if (!email) return writeLine("NO EMAIL STORED IN PNR - ADD WITH APE", "err");
    addHistory(pnr, `EMAILED ITINERARY TO STORED ADDRESS ${email}`);
    writeLine(`ITINERARY EMAILED TO ${email} (SIMULATED)`, "ok");
  },

  // Training & Utility
  TRAIN: (arg) => {
    const a = arg.trim().toUpperCase();
    if (a === "STOP" || a === "EXIT") {
      if (!AMX.state.training.active) return writeLine("NO ACTIVE TRAINING SCENARIO", "err");
      AMX.state.training.active = false;
      AMX.state.training.scenario = null;
      return writeLine("TRAINING SCENARIO ENDED.", "scenario");
    }
    let idx = null;
    if (a === "START") idx = 0;
    else if (/^\d+$/.test(a)) idx = parseInt(a, 10) - 1;

    if (idx === null) {
      const progress = loadProgress();
      writeLine(`AVAILABLE SCENARIOS - REAL CUSTOMER CALLS, START TO FINISH (${progress.completed.length}/${scenarios.length} COMPLETE):`, "scenario");
      scenarios.forEach((sc, i) => writeLine(`${i + 1}. [${sc.level}] ${sc.title}${progress.completed.includes(sc.title) ? " [DONE]" : ""}`, "hint"));
      writeLine("TYPE: TRAIN <NUMBER> TO BEGIN, HINT IF YOU'RE STUCK, TRAIN STOP TO EXIT EARLY.", "hint");
      return;
    }
    const scenario = scenarios[idx];
    if (!scenario) return writeLine("SCENARIO NOT FOUND - TYPE TRAIN FOR THE LIST", "err");
    if (typeof scenario.setup === "function") scenario.setup();
    AMX.state.training.active = true;
    AMX.state.training.scenario = scenario;
    AMX.state.training.step = 0;
    writeLine(`SCENARIO ${idx + 1}: ${scenario.title} [${scenario.level}]`, "scenario");
    writeLine(scenario.brief, "scenario");
    writeLine(scenario.steps[0].instruction, "scenario");
  },
  HINT: () => {
    if (!AMX.state.training.active) return writeLine("NO ACTIVE TRAINING SCENARIO", "err");
    const step = AMX.state.training.scenario.steps[AMX.state.training.step];
    writeLine(`HINT: ${step.hint || "Re-read the instruction above."}`, "scenario");
  },
  HE: (arg) => {
    const topic = arg.trim().toUpperCase();
    if (!topic) {
      writeLine("HELP TOPICS: " + Object.keys(HELP_TOPICS).join(", "), "hint");
      writeLine("TYPE: HE <TOPIC>  (E.G. HE AN, HE PRICING, HE QUEUES)", "hint");
      return;
    }
    const text = HELP_TOPICS[topic];
    if (!text) return writeLine(`NO HELP FOUND FOR "${topic}" - TYPE HE FOR A LIST OF TOPICS`, "err");
    writeLine(text, "hint");
  },
  CS: () => { const out = $("output"); if (out) out.innerHTML = ""; },
};

const scenarios = [
  {
    title: "The One-Way Request",
    level: "BASIC",
    brief: '"Good morning — I need a one-way ticket from London to Paris, tomorrow, economy class." (Walk-in customer, paying cash)',
    steps: [
      { instruction: "Check availability from LHR to CDG for tomorrow.", hint: "AN<DDMMM>LHRCDG — e.g. AN20DECLHRCDG.", validate: (cmd) => cmd.startsWith("AN") },
      { instruction: "Sell one seat in economy (Y) from the first line shown.", hint: "SS1Y1", validate: (cmd) => cmd.startsWith("SS") },
      { instruction: "Add the passenger's name: Smith, John (Mr).", hint: "NM1SMITH/JOHN MR", validate: (cmd, full) => cmd.startsWith("NM") && full.includes("SMITH/JOHN") },
      { instruction: "Add a contact phone number.", hint: "AP 33-123456789", validate: (cmd) => cmd.startsWith("AP") },
      { instruction: "Confirm the ticketing arrangement.", hint: "TKOK", validate: (cmd) => cmd === "TKOK" },
      { instruction: "Sign the booking as received from the customer.", hint: "RF <YOUR NAME>", validate: (cmd) => cmd.startsWith("RF") },
      { instruction: "Price the itinerary.", hint: "FXP", validate: (cmd) => cmd.startsWith("FXP") || cmd.startsWith("FXB") },
      { instruction: "Set the validating carrier from the availability display.", hint: "FV <CARRIER CODE>", validate: (cmd) => cmd.startsWith("FV") },
      { instruction: "Take payment — the customer is paying cash.", hint: "FP CASH", validate: (cmd, full) => cmd.startsWith("FP") && full.includes("CASH") },
      { instruction: "Issue the ticket.", hint: "TTP", validate: (cmd) => cmd.startsWith("TTP") },
      { instruction: "Save the PNR.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
  {
    title: "The Family With a Child",
    level: "BASIC",
    brief: '"I need two seats from Doha to Mumbai and back for me and my 8-year-old son, economy, for the 20th." (Repeat customer)',
    steps: [
      { instruction: "Check round-trip availability from DOH to BOM.", hint: "AN<DDMMM>DOHBOM/R<DDMMM>", validate: (cmd, full) => cmd.startsWith("AN") && full.includes("/R") },
      { instruction: "Sell 2 seats in economy each way from line 1, in one entry.", hint: "SS2Y1*2Y1", validate: (cmd, full) => cmd.startsWith("SS") && full.includes("*") },
      { instruction: "Add the adult passenger's name.", hint: "NM1ALI/FATIMA MRS", validate: (cmd, full) => cmd.startsWith("NM") && !full.includes("CHD") },
      { instruction: "Add the child, with his date of birth.", hint: "NM1ALI/YOUSEF MSTR(CHD/10JUN17)", validate: (cmd, full) => cmd.startsWith("NM") && full.includes("CHD") },
      { instruction: "Add a phone contact.", hint: "AP 33-123456789", validate: (cmd) => cmd.startsWith("AP") },
      { instruction: "Add an email contact.", hint: "APE parent@example.com", validate: (cmd) => cmd.startsWith("APE") },
      { instruction: "Confirm the ticketing arrangement.", hint: "TKOK", validate: (cmd) => cmd === "TKOK" },
      { instruction: "Sign the booking.", hint: "RF <YOUR NAME>", validate: (cmd) => cmd.startsWith("RF") },
      { instruction: "Price the itinerary — the child fare applies automatically.", hint: "FXP", validate: (cmd) => cmd.startsWith("FXP") || cmd.startsWith("FXB") },
      { instruction: "Set the validating carrier.", hint: "FV <CARRIER CODE>", validate: (cmd) => cmd.startsWith("FV") },
      { instruction: "Take payment.", hint: "FP CASH or FP CC VI 4111111111111111/1228", validate: (cmd) => cmd.startsWith("FP") },
      { instruction: "Issue the tickets for both passengers.", hint: "TTP/PAX", validate: (cmd) => cmd.startsWith("TTP") },
      { instruction: "Save the PNR.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
  {
    title: "The Budget Hunter",
    level: "INTERMEDIATE",
    brief: '"What\'s the cheapest way to get to Bangkok? I don\'t care about the airline, and I\'ll need to check a bag."',
    steps: [
      { instruction: "Check fares to BKK before booking anything.", hint: "FQD<FROM>BKK", validate: (cmd) => cmd.startsWith("FQD") },
      { instruction: "Check availability once you've picked a date.", hint: "AN<DDMMM><FROM>BKK", validate: (cmd) => cmd.startsWith("AN") },
      { instruction: "Sell one seat in the lowest class shown.", hint: "SS1<CLASS>1", validate: (cmd) => cmd.startsWith("SS") },
      { instruction: "Add the passenger's name.", hint: "NM1DOE/JANE MS", validate: (cmd) => cmd.startsWith("NM") },
      { instruction: "Add a contact.", hint: "AP 33-123456789", validate: (cmd) => cmd.startsWith("AP") },
      { instruction: "Confirm the ticketing arrangement.", hint: "TKOK", validate: (cmd) => cmd === "TKOK" },
      { instruction: "Sign the booking.", hint: "RF <YOUR NAME>", validate: (cmd) => cmd.startsWith("RF") },
      { instruction: "Find and store the lowest fare.", hint: "FXR to preview, then FXB to store it", validate: (cmd) => cmd.startsWith("FXR") || cmd.startsWith("FXB") },
      { instruction: "Add a checked bag — the customer needs one.", hint: "SVC CHECKED BAG 35", validate: (cmd) => cmd.startsWith("SVC") },
      { instruction: "Set the validating carrier.", hint: "FV <CARRIER CODE>", validate: (cmd) => cmd.startsWith("FV") },
      { instruction: "Take payment by card.", hint: "FP CC VI 4111111111111111/1228", validate: (cmd, full) => cmd.startsWith("FP") && full.includes("CC") },
      { instruction: "Issue the ticket.", hint: "TTP", validate: (cmd) => cmd.startsWith("TTP") },
      { instruction: "Save the PNR.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
  {
    title: "The Same-Day Change",
    level: "INTERMEDIATE",
    brief: '"I need to fly out today instead — can you move my booking to an earlier flight and grab me a window seat?"',
    steps: [
      { instruction: "First, put the original booking on file: check availability anywhere.", hint: "AN<DDMMM><FROM><TO>", validate: (cmd) => cmd.startsWith("AN") },
      { instruction: "Sell one seat in economy.", hint: "SS1Y1", validate: (cmd) => cmd.startsWith("SS") },
      { instruction: "Add the passenger's name.", hint: "NM1BROWN/ALEX MR", validate: (cmd) => cmd.startsWith("NM") },
      { instruction: "Save the original booking.", hint: "ER", validate: (cmd) => cmd === "ER" },
      { instruction: "Now the change: rebook segment 1 to a different class or date.", hint: "SBC1 (class) or SB<DDMMM>1 (date)", validate: (cmd) => cmd.startsWith("SB") },
      { instruction: "View the seat map for that segment.", hint: "SM1", validate: (cmd) => cmd.startsWith("SM") },
      { instruction: "Assign a window seat (A or F) to the passenger.", hint: "ST/1A/P1", validate: (cmd) => cmd.startsWith("ST") },
      { instruction: "Save the updated booking.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
  {
    title: "The Group Split",
    level: "ADVANCED",
    brief: '"Three of us are flying together to Cape Town, but my colleague\'s company is paying separately — can you split his ticket out?"',
    steps: [
      { instruction: "Check availability to CPT.", hint: "AN<DDMMM><FROM>CPT", validate: (cmd) => cmd.startsWith("AN") },
      { instruction: "Sell 3 seats from the same line.", hint: "SS3Y1", validate: (cmd) => cmd.startsWith("SS") },
      { instruction: "Add passenger 1's name.", hint: "NM1KHAN/OMAR MR", validate: (cmd) => cmd.startsWith("NM") },
      { instruction: "Add passenger 2's name.", hint: "NM1KHAN/SARA MRS", validate: (cmd) => cmd.startsWith("NM") },
      { instruction: "Add passenger 3's name — your colleague.", hint: "NM1REED/TOM MR", validate: (cmd) => cmd.startsWith("NM") },
      { instruction: "Add a contact.", hint: "AP 33-123456789", validate: (cmd) => cmd.startsWith("AP") },
      { instruction: "Confirm the ticketing arrangement.", hint: "TKOK", validate: (cmd) => cmd === "TKOK" },
      { instruction: "Sign the booking.", hint: "RF <YOUR NAME>", validate: (cmd) => cmd.startsWith("RF") },
      { instruction: "Save the group PNR first.", hint: "ER", validate: (cmd) => cmd === "ER" },
      { instruction: "Split your colleague (passenger 3) into his own PNR.", hint: "SP 3", validate: (cmd) => cmd.startsWith("SP") },
      { instruction: "Apply a small agency service fee to his booking.", hint: "FCM-A15", validate: (cmd) => cmd.startsWith("FCM") },
      { instruction: "Price his new PNR.", hint: "FXP", validate: (cmd) => cmd.startsWith("FXP") || cmd.startsWith("FXB") },
      { instruction: "Set the validating carrier.", hint: "FV <CARRIER CODE>", validate: (cmd) => cmd.startsWith("FV") },
      { instruction: "Take his payment.", hint: "FP INV", validate: (cmd) => cmd.startsWith("FP") },
      { instruction: "Issue his ticket.", hint: "TTP", validate: (cmd) => cmd.startsWith("TTP") },
      { instruction: "Save his split booking.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
  {
    title: "The Schedule-Change Call",
    level: "ADVANCED",
    brief: '"Hi, I got an email saying my flight time changed? I don\'t really understand it — can you tell me what\'s new and fix my seat?" (Her PNR is already on queue 5, waiting for you.)',
    setup: () => {
      const demo = createEmptyPNR();
      demo.passengers = [{ name: "HARRIS/EMMA MRS", type: "ADT" }];
      demo.segments = [{ date: "22DEC", from: "DOH", to: "SIN", carrier: "QR", flight: "938", dep: "02:15", arr: "13:40", classes: "Y5", cabin: "Y", status: "SC", seats: [] }];
      demo.contacts = { email: "emma.harris@example.com" };
      demo.recordLocator = "TRNSC1";
      demo.history.push("SCHEDULE CHANGE ON SEGMENT 1 (QR938)");
      savePNR(demo);
      const q = ensureQueue("5");
      if (!q.pnrs.includes("TRNSC1")) q.pnrs.push("TRNSC1");
    },
    steps: [
      { instruction: "Open queue 5 to see who's waiting.", hint: "QT5", validate: (cmd) => cmd.startsWith("QT") },
      { instruction: "Action the PNR at the top of the queue.", hint: "QN", validate: (cmd) => cmd === "QN" },
      { instruction: "Check the PNR's history to see exactly what changed.", hint: "RH", validate: (cmd) => cmd === "RH" },
      { instruction: "Rebook the affected segment to a workable time or class.", hint: "SBC1 or SB<DDMMM>1", validate: (cmd) => cmd.startsWith("SB") },
      { instruction: "View the seat map.", hint: "SM1", validate: (cmd) => cmd.startsWith("SM") },
      { instruction: "Reassign her seat.", hint: "ST/12A/P1", validate: (cmd) => cmd.startsWith("ST") },
      { instruction: "Save the updated booking.", hint: "ER", validate: (cmd) => cmd === "ER" },
    ],
  },
];

// --- BOOT & UI WIRING ---
function levenshtein(a, b) {
    const dp = [];
    for (let i = 0; i <= a.length; i++) dp.push([i, ...new Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
function suggestCommand(verb) {
    let best = null, bestDist = Infinity;
    Object.keys(commands).forEach(key => {
        if (Math.abs(verb.length - key.length) > 3) return;
        const d = levenshtein(verb, key);
        if (d < bestDist) { bestDist = d; best = key; }
    });
    return bestDist <= 2 ? best : null;
}
function dispatchCommand(s, verb) {
    try {
        const commandKeys = Object.keys(commands).sort((a, b) => b.length - a.length);
        const action = commandKeys.find(key => verb.startsWith(key));

        if (!AMX.state.signedIn && action !== "JI" && action !== "JJ" && action !== "HE") {
            return writeLine("NOT SIGNED IN - ENTER JI TO SIGN IN", "err");
        }

        if (action) {
            const effectiveArg = s.slice(action.length).trim();
            commands[action](effectiveArg);
        } else {
            writeLine("UNKNOWN COMMAND", "err");
            const suggestion = suggestCommand(verb);
            if (suggestion) writeLine(`DID YOU MEAN: ${suggestion}?`, "hint");
        }
    } catch (err) {
        console.error(err);
        writeLine(`SYSTEM ERROR - COMMAND FAILED (${err.message || err})`, "err");
    }
}

function exec(raw) {
    const s = String(raw || "").trim();
    if (!s) return;
    writeLine(`> ${s}`, "cmd");
    if (s.toUpperCase() !== AMX.state.commandHistory[0]) AMX.state.commandHistory.unshift(s);
    AMX.state.historyIndex = -1;

    const sp = s.split(/\s+/);
    const verb = sp[0].toUpperCase();

    // Reconfirm (e.g. "3/RR") and Direct Access (e.g. "1EKAD12SEPDOHDXB") both start
    // with a digit, which no alphabetic command key ever does - handled here instead
    // of in `commands` so they can never collide with a real command prefix.
    let m;
    if ((m = verb.match(/^(\d{1,2})\/(RR|HK|HL|SC|SS)$/))) {
        const pnr = AMX.state.pnr;
        const seg = pnr?.segments[parseInt(m[1], 10) - 1];
        if (!seg) { writeLine("SEGMENT NOT FOUND", "err"); return; }
        seg.status = m[2];
        addHistory(pnr, `RECONFIRMED SEGMENT ${m[1]} TO STATUS ${m[2]}`, "CS");
        writeLine(`SEGMENT ${m[1]} RECONFIRMED - STATUS ${m[2]}`, "ok");
        return;
    }
    if ((m = verb.match(/^1([A-Z]{2})(AD|AA|AN)?(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})$/))) {
        const [, carrier, , ddmmm, from, to] = m;
        const dt = parseDDMMM(ddmmm);
        if (!dt) { writeLine("INVALID DATE FORMAT", "err"); return; }
        const lines = mockAvailability(dt, from, to, { airlineFilter: carrier });
        if (!lines.length) { writeLine(`NO DIRECT ACCESS INVENTORY FOR ${carrier} ${from}-${to}`, "err"); return; }
        lines.forEach((l, i) => l.line = 21 + i);
        AMX.state.availability.outbound = lines;
        AMX.state.lastAvailQuery = { code: "AN", ddmmm, from, to, opts: { airlineFilter: carrier } };
        writeLine(`DIRECT ACCESS - ${carrier} ${ddmmm} ${from}-${to} (LINK ACTIVE 3 MIN)`, "ok");
        lines.forEach(l => printAvailLine(l));
        return;
    }

    // TRAIN and HINT are meta-commands: they always run directly, even mid-scenario.
    if (verb.startsWith("TRAIN") || verb === "HINT") {
        return dispatchCommand(s, verb);
    }

    if (AMX.state.training.active) {
        const step = AMX.state.training.scenario.steps[AMX.state.training.step];
        const passed = step.validate(verb, s.toUpperCase());
        dispatchCommand(s, verb); // the command actually runs, so the PNR/state stays real
        if (passed) {
            AMX.state.training.step++;
            if (AMX.state.training.step >= AMX.state.training.scenario.steps.length) {
                writeLine("SCENARIO COMPLETE — nicely handled. Type TRAIN for another.", "scenario");
                markScenarioComplete(AMX.state.training.scenario.title);
                AMX.state.training.active = false;
                AMX.state.training.scenario = null;
            } else {
                writeLine("Correct — next:", "scenario");
                writeLine(AMX.state.training.scenario.steps[AMX.state.training.step].instruction, "scenario");
            }
        } else {
            writeLine("That doesn't cover what this step needs yet. Type HINT if you're stuck, or TRAIN STOP to exit.", "scenario");
        }
    } else {
        dispatchCommand(s, verb);
    }
}

function bindUI() {
  const input = $("commandInput");
  const enterBtn = $("btnEnter");
  $("btnTrain")?.addEventListener("click", () => exec("TRAIN"));

  const processInput = () => { if (input) { exec(input.value); input.value = ""; input.focus(); } };
  enterBtn.addEventListener("click", processInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); processInput(); }
    if (e.key === "ArrowUp") {
        e.preventDefault();
        if (AMX.state.historyIndex < AMX.state.commandHistory.length - 1) {
            AMX.state.historyIndex++;
            input.value = AMX.state.commandHistory[AMX.state.historyIndex];
        }
    }
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (AMX.state.historyIndex > 0) {
            AMX.state.historyIndex--;
            input.value = AMX.state.commandHistory[AMX.state.historyIndex];
        } else {
            AMX.state.historyIndex = -1;
            input.value = "";
        }
    }
  });
}

function startClock() {
  const d = $("amxClockDate");
  const t = $("amxClockTime");
  const o = $("amxOffice");
  const a = $("amxAgent");
  if (o) o.textContent = AMX.state.office;
  if (a) a.textContent = AMX.state.agent;
  function tick() {
    if (d) d.textContent = fmt.nowDate();
    if (t) t.textContent = fmt.nowTime();
  }
  tick();
  setInterval(tick, 1000);
}

async function loadInitialData() {
    try {
        const res = await fetch("../assets/data/worlddata.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        AMX.state.world = await res.json();
    } catch (err) {
        console.error(err);
        writeLine("WORLD DATA LOAD FAILED", "err");
    }
}

window.addEventListener("DOMContentLoaded", () => {
  startClock();
  bindUI();
  loadInitialData();
  writeLine('"As you start to walk on the way, the way appears." - Rumi', "ok");
  writeLine("This isn't just a simulator. It's a dojo for your fingers, a gym for your GDS muscle memory.", "hint");
  writeLine("Type HE for help or click Scenario Training to begin.", "hint");
});
