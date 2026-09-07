/* ============================================================================
   DonaTrainer — App JS (v9.0 - Full-Feature GDS Pass)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Full command coverage from the Amadeus Basic training guide: pricing/TST,
     ticketing, queues, profiles, decode/encode, rebooking, name-search retrieval.
   - Realistic flight durations & class inventory driven by real airport coords.
   - v9.0 adds: NU, SP, FCM, FXA/FXK, waitlisting (HL), and IROPS schedule
     changes auto-queued to queue 5 - closing out the README's promised features.
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
  const tickets = (pnr.tickets || []).map((t, i) => `<div class="mono">${i+1}. ${t.number} ${pnr.passengers[t.passengerIndex]?.name || ""}${t.voided ? " (VOID)" : ""}</div>`).join("");
  return `<div class="itinerary"><h2>Itinerary: ${pnr.recordLocator || "UNSAVED"}</h2><hr><strong>Passengers</strong>${paxList}<hr><strong>Flights</strong>${segs}<hr><strong>Contacts</strong>${contactList || '<div class="mono">NONE</div>'}<hr><strong>Fare</strong>${fare}<hr><strong>Services</strong>${ssrList}<hr><strong>Ancillaries</strong>${ancillaryList || '<div class="mono">NONE</div>'}<hr><strong>Tickets</strong>${tickets || '<div class="mono">NONE</div>'}</div>`;
}

// --- PNR & PROFILE MANAGEMENT ---
function createEmptyPNR() {
  return {
    recordLocator: "", passengers: [], segments: [], ssrs: [], remarks: [],
    history: [`CREATED BY M.A. KAHAR / DONABIL SAS`], status: "ACTIVE", ancillaries: [],
    contacts: {}, tst: [], tickets: [], markup: null,
    validatingCarrier: null, formOfPayment: null, commission: null,
  };
}
function newPNR() { AMX.state.pnr = createEmptyPNR(); return AMX.state.pnr; }
function ensurePNR() { return AMX.state.pnr || newPNR(); }
function addHistory(pnr, text) { if (pnr) pnr.history.push(`${fmt.nowTime()} ${text}`); }
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
    const status = ticket ? (ticket.voided ? "VOID" : "OPEN FOR USE") : "NOT ISSUED";
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
    <div class="sub endorsement">${tst.endorsement}</div>
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
  addHistory(pnr, `SCHEDULE CHANGE ON SEGMENT ${idx + 1} (${seg.carrier}${seg.flight})`);
  const q = ensureQueue("5");
  if (pnr.recordLocator && !q.pnrs.includes(pnr.recordLocator)) q.pnrs.push(pnr.recordLocator);
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
function randomClasses(distanceKm) {
  const longHaul = distanceKm > 3500;
  const letters = longHaul ? ["J","C","D","Y","M","K","B","H"] : ["J","Y","M","K","B","H"];
  const count = 4 + Math.floor(Math.random() * 3);
  const chosen = letters.slice(0, Math.min(count, letters.length));
  return chosen.map(l => `${l}${Math.random() < 0.15 ? 0 : Math.floor(Math.random() * 9) + 1}`).join(" ");
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
  const depHour = 6 + Math.floor(Math.random() * 15);
  const depMin = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
  const arrival = addMinutesToClock(depHour, depMin, duration);
  return {
    date: fmtDDMMM(date), from, to, carrier,
    flight: String(Math.floor(Math.random() * 800) + 100),
    dep: `${fmt.pad(depHour)}:${fmt.pad(depMin)}`,
    arr: `${fmt.pad(arrival.hour)}:${fmt.pad(arrival.min)}${arrival.dayOffset ? "+" + arrival.dayOffset : ""}`,
    classes: randomClasses(distanceKm),
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
  let routes = world.routes.filter(r => r[0] === from && r[1] === to);
  if (opts.airlineFilter) routes = routes.filter(r => r[2] === opts.airlineFilter);

  const lines = [];
  if (routes.length) {
    const carriers = [...new Set(routes.map(r => r[2]))];
    const flightCount = Math.min(carriers.length * 2, 4 + Math.floor(Math.random() * 5));
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
  writeLine(`ETKT ${ticket.number}  ${ticket.voided ? "VOID" : "OPEN FOR USE"}`, ticket.voided ? "err" : "ok");
  writeLine(`  1.${pax?.name || "UNKNOWN"}`, "hint");
  pnr.segments.forEach((s, i) => {
    writeLine(`  ${i + 1} O ${s.carrier} ${s.flight} ${s.cabin || ""} ${s.date} ${s.from}${s.to} ${s.status}1  ${s.dep} ${s.arr}  E  ${baggageAllowanceFor(s.cabin)}`, "hint");
  });
  if (tst) {
    writeLine(`  FARE F ${tst.currency} ${tst.base.toFixed(2)}`, "hint");
    (tst.taxBreakdown || []).forEach(tb => writeLine(`  TAX      ${tb.amount.toFixed(2)}${tb.code}`, "hint"));
    writeLine(`  TOTAL    ${tst.currency} ${displayTotal(pnr).toFixed(2)}`, "hint");
    writeLine(`  FC ${tst.fareCalc}`, "hint");
    writeLine(`  FB ${tst.fareBasis}  NVB${tst.nvb}  NVA${tst.nva}`, "hint");
    writeLine(`  FE ${tst.endorsement}`, "hint");
  }
  const fopText = pnr.formOfPayment
    ? (pnr.formOfPayment.type === "CC" ? `CC ${pnr.formOfPayment.card} ****${pnr.formOfPayment.number.slice(-4)}` : pnr.formOfPayment.type)
    : "NOT ON FILE";
  writeLine(`  FP ${fopText}`, "hint");
  writeLine(`  ISSUED ${ticket.issuedAt}  ${AMX.state.office}  AGENT ${AMX.state.agent}`, "hint");
}

// --- QUEUE HELPER ---
function ensureQueue(n) {
  if (!AMX.state.queues[n]) AMX.state.queues[n] = { name: `QUEUE ${n}`, pnrs: [] };
  return AMX.state.queues[n];
}

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
  SERVICES: "FXA/FXK <DESCRIPTION> <PRICE> records an ancillary service (bag, seat upgrade, etc.) against the PNR and adds it to the displayed total.",
  TTP: "TTP issues tickets from the active TST. Requires a validating carrier (FV) and a form of payment (FP) on file. TTP/P1, TTP/PAX and TTP/INF scope the issuance. Each ticket prints a full coupon block: FA/segment lines, FARE/TAX/TOTAL, FC (fare calculation), FB (fare basis) with NVB/NVA, and FE (endorsement).",
  TWD: "TWD displays the current e-ticket's full coupon block (segments, fare, FC, FB, FE). TWD/L<n> selects by line, TWD/TKT<number> by ticket number, TWD/TAX shows the tax breakdown by code, TWH shows the ticket's history.",
  TJQ: "TJQ lists issued tickets. /D-<DDMMM> filters a date, /D-<DDMMM><DDMMM> a range, /SOF/QVP-<CARRIER> an airline, /SOF/QTC-RFND voids only.",
  TRDC: "TRDC/L<n> or TRDC/TK-<number> voids an issued ticket.",
  QUEUES: "QE<n> places the active PNR on queue n. QT<n> opens a queue for browsing. QN actions the current PNR and advances. QD delays it to the bottom. QI exits. QTQ shows total counts.",
  PROFILES: "PM/PME enter and exit profile mode. PC/-<n> drafts a profile from PNR passenger n. PIN/<name> names it and PER saves it. PDI/<index> or PDN/-<surname> retrieves one, PD redisplays it, PT transfers it into the active PNR.",
  IEP: "IEP-EML-<address> emails the itinerary once; IEPJ-EML-<address> emails it for every passenger; IEP-EMLA sends it to the email already stored in the PNR (simulated - no real email is sent).",
  DECODE: "DAN <text> looks up a code from a city/airport name. DAC <code> decodes an airport or country code. DC <code> decodes a country code both ways. DNA <code> decodes an airline code to its name and numeric code.",
};

// --- COMMAND IMPLEMENTATIONS ---
const commands = {
  // Core Booking
  AN: (arg) => {
    const upper = arg.toUpperCase().trim().replace(/^\//, "");
    const m = upper.match(/^(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})(.*)$/);
    if (!m) return writeLine("FORMAT: AN<DDMMM><FROM><TO>[/R<DDMMM>][/A<CARRIER>][/D][/C<CLASS>][/X<CITY>]", "err");
    const [, ddmmm, from, to, rest] = m;
    const dt = parseDDMMM(ddmmm);
    if (!dt) return writeLine("INVALID DATE FORMAT", "err");

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

    const opts = { airlineFilter, directOnly, classFilter, excludeCity };
    const outLines = mockAvailability(dt, from, to, opts);
    if (!outLines.length) return writeLine(`NO FLIGHTS FOUND FOR ${from}-${to}`, "err");
    AMX.state.availability.outbound = outLines;

    writeLine(`** AMADEUS AVAILABILITY - AN ** ${ddmmm} ${from}-${to}`, "ok");
    outLines.forEach(l => printAvailLine(l));

    if (returnDdmmm) {
      const retDt = parseDDMMM(returnDdmmm);
      if (!retDt) return writeLine("INVALID RETURN DATE FORMAT", "err");
      const inLines = mockAvailability(retDt, to, from, opts);
      AMX.state.availability.inbound = inLines;
      writeLine(`RETURN AVAILABILITY ${returnDdmmm} ${to}-${from}`, "ok");
      inLines.forEach(l => printAvailLine(l));
    }
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
    const m = arg.toUpperCase().match(/^1([A-Z'\-]+)\/([A-Z'\-]+)\s+(MR|MRS|MS|MSTR|MISS)(?:\((CHD|INF)\/?([A-Z]*)\/?(\d{1,2}[A-Z]{3}\d{0,4})\))?$/);
    if (!m) return writeLine("FORMAT: NM1SURNAME/FIRSTNAME TITLE[(CHD/DDMMMYY)|(INF/INFANTNAME/DDMMMYY)]", "err");
    const [, surname, first, title, subType, infantName, dob] = m;
    const pax = { name: `${surname}/${first} ${title}`, type: subType || "ADT" };
    if (subType === "CHD") pax.dob = dob;
    if (subType === "INF") pax.infant = { name: infantName, dob };
    pnr.passengers.push(pax);
    addHistory(pnr, `ADDED PAX ${pnr.passengers.length}`);
    writeLine(`PAX ADDED: ${pax.name}`, "ok");
  },
  AP: (arg) => { ensurePNR().contacts.phone = arg.trim(); addHistory(ensurePNR(), "ADDED PHONE"); writeLine("PHONE ADDED", "ok"); },
  APH: (arg) => { ensurePNR().contacts.home = arg.trim(); addHistory(ensurePNR(), "ADDED HOME PHONE"); writeLine("HOME PHONE ADDED", "ok"); },
  APM: (arg) => { ensurePNR().contacts.mobile = arg.trim(); addHistory(ensurePNR(), "ADDED MOBILE PHONE"); writeLine("MOBILE PHONE ADDED", "ok"); },
  APE: (arg) => { ensurePNR().contacts.email = arg.trim(); addHistory(ensurePNR(), "ADDED EMAIL"); writeLine("EMAIL ADDED", "ok"); },
  TKOK: () => { ensurePNR().remarks.push("TKOK"); addHistory(ensurePNR(), `ADDED TKOK`); writeLine("TICKETING TIME LIMIT: OK", "ok"); },
  RF: (arg) => { const who = arg.trim() || AMX.state.agent; ensurePNR().remarks.push(`RF ${who}`); addHistory(ensurePNR(), `ADDED RF ${who}`); writeLine("RECEIVED FROM ADDED", "ok"); },
  ER: () => {
    const pnr = ensurePNR();
    if (!pnr.passengers.length || !pnr.segments.length) return writeLine("PNR INCOMPLETE", "err");
    if (!pnr.recordLocator) pnr.recordLocator = randomLocator();
    addHistory(pnr, `SAVED PNR`);
    savePNR(pnr);
    writeLine(`PNR SAVED: ${pnr.recordLocator}`, "ok");
  },

  // PNR Servicing
  RT: (arg) => {
    const raw = arg.trim();
    const upper = raw.toUpperCase();
    if (!raw || upper === "*E") {
      if (AMX.state.pnr) return writeHTML(renderItineraryHTML(AMX.state.pnr));
      return writeLine("NO ACTIVE PNR", "err");
    }
    if (/^\d{1,2}$/.test(upper) && AMX.state.nameSearchResults && AMX.state.nameSearchResults.length) {
      const sel = AMX.state.nameSearchResults[parseInt(upper, 10) - 1];
      if (!sel) return writeLine("SELECTION NOT FOUND", "err");
      const pnr = loadPNR(sel.locator);
      AMX.state.pnr = pnr;
      AMX.state.nameSearchResults = null;
      const disrupted = maybeTriggerIROPS(pnr);
      writeLine(`PNR ${sel.locator} RETRIEVED`, "ok");
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
        const disrupted = maybeTriggerIROPS(pnr);
        writeLine(`PNR ${results[0].locator} RETRIEVED`, "ok");
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
      const disrupted = maybeTriggerIROPS(pnr);
      writeLine(`PNR ${upper} RETRIEVED`, "ok");
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
  RRN: () => {
    const pnr = ensurePNR();
    if (!pnr.recordLocator) return writeLine("CANNOT COPY AN UNSAVED PNR", "err");
    const newPnr = JSON.parse(JSON.stringify(pnr));
    newPnr.recordLocator = "";
    newPnr.passengers = [];
    newPnr.tickets = [];
    newPnr.tst = [];
    newPnr.status = "COPIED";
    AMX.state.pnr = newPnr;
    addHistory(pnr, `COPIED PNR TO NEW BOOKING`);
    writeLine(`PNR COPIED. ADD NEW NAMES AND SAVE WITH ER.`, "ok");
    writeHTML(renderItineraryHTML(newPnr));
  },
  RH: () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR", "err");
    writeLine(`HISTORY FOR ${pnr.recordLocator || "UNSAVED PNR"}`, "ok");
    pnr.history.forEach(h => writeLine(h, "hint"));
  },
  NU: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^(\d+)\/(\d+)([A-Z'\-]+)\/([A-Z'\-]+)(?:\s+(MR|MRS|MS|MSTR|MISS))?$/);
    if (!m) return writeLine("FORMAT: NU<OLD#>/<NEW#><SURNAME>/<FIRSTNAME> [TITLE]", "err");
    const [, oldIdx, , surname, first, title] = m;
    const pax = pnr.passengers[parseInt(oldIdx, 10) - 1];
    if (!pax) return writeLine("PASSENGER NOT FOUND", "err");
    const oldName = pax.name;
    const existingTitle = pax.name.split(" ").pop();
    pax.name = `${surname}/${first} ${title || existingTitle}`;
    addHistory(pnr, `UPDATED NAME ${oldName} -> ${pax.name}`);
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
    addHistory(pnr, `SPLIT ${movedPax.length} PAX TO NEW PNR`);
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
    addHistory(pnr, `CANCELLED ELEMENT ${n}`);
    writeLine(`ELEMENT ${n} CANCELLED`, "ok");
  },
  XI: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO ITINERARY TO CANCEL", "err");
    pnr.segments = [];
    addHistory(pnr, "CANCELLED ALL ITINERARY ELEMENTS");
    writeLine("ITINERARY CANCELLED", "ok");
  },
  SB: (arg) => {
    const pnr = ensurePNR();
    const a = arg.trim().toUpperCase();
    let m;
    if ((m = a.match(/^([A-Z])(\d+)$/))) {
      const seg = pnr.segments[parseInt(m[2], 10) - 1];
      if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
      seg.cabin = m[1];
      addHistory(pnr, `REBOOKED SEGMENT ${m[2]} INTO CLASS ${m[1]}`);
      return writeLine(`SEGMENT ${m[2]} REBOOKED TO CLASS ${m[1]}`, "ok");
    }
    if ((m = a.match(/^(M?)(\d{1,2}[A-Z]{3})(\d+)$/))) {
      const seg = pnr.segments[parseInt(m[3], 10) - 1];
      if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
      seg.date = m[2];
      addHistory(pnr, `REBOOKED SEGMENT ${m[3]} TO DATE ${m[2]}`);
      return writeLine(`SEGMENT ${m[3]} DATE CHANGED TO ${m[2]}`, "ok");
    }
    writeLine("FORMAT: SBC<n> (CLASS) | SB<DDMMM><n> (DATE) | SBM<DDMMM><n> (DATE)", "err");
  },
  RM: (arg) => {
    const pnr = ensurePNR();
    let text = arg.trim();
    let tag = "";
    const m = text.match(/^\/(\w+)\s+(.*)$/);
    if (m) { tag = `[${m[1].toUpperCase()}] `; text = m[2]; }
    pnr.remarks.push(`${tag}${text.toUpperCase()}`);
    addHistory(pnr, "ADDED REMARK");
    writeLine("REMARK ADDED", "ok");
  },
  OS: (arg) => {
    const pnr = ensurePNR();
    pnr.remarks.push(`OSI ${arg.trim().toUpperCase()}`);
    addHistory(pnr, "ADDED OSI");
    writeLine("OTHER SERVICE INFORMATION ADDED", "ok");
  },
  FFN: (arg) => {
    const pnr = ensurePNR();
    pnr.ssrs.push({ type: "FQTV", text: arg.trim().toUpperCase() });
    addHistory(pnr, "ADDED FREQUENT FLYER NUMBER");
    writeLine("FREQUENT FLYER NUMBER ADDED", "ok");
  },
  SR: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().match(/^([A-Za-z]+)\s*(.*)$/);
    if (!m) return writeLine("FORMAT: SR <TYPE> <FREE TEXT>", "err");
    pnr.ssrs.push({ type: m[1].toUpperCase(), text: m[2].trim().toUpperCase() });
    addHistory(pnr, `ADDED SSR ${m[1].toUpperCase()}`);
    writeLine(`SSR ${m[1].toUpperCase()} ADDED`, "ok");
  },

  // Pricing & Ticketing
  FQD: (arg) => {
    const a = arg.trim().toUpperCase();
    const m = a.match(/^([A-Z]{3})([A-Z]{3})(.*)$/);
    if (!m) return writeLine("FORMAT: FQD<FROM><TO>[/A<CARRIER>][/C<CLASS>][/D<DDMMM>][/R,-CH|/R,-INF]", "err");
    const [, from, to, rest] = m;
    const tokens = rest.split("/").filter(Boolean);
    let carrier = null, cls = null, ddmmm = null, paxType = null;
    tokens.forEach(t => {
      let mm;
      if ((mm = t.match(/^A([A-Z0-9]{2,3})$/))) carrier = mm[1];
      else if ((mm = t.match(/^C([A-Z])$/))) cls = mm[1];
      else if ((mm = t.match(/^D(\d{1,2}[A-Z]{3})$/))) ddmmm = mm[1];
      else if (t === "R,-CH") paxType = "CHD";
      else if (t === "R,-INF") paxType = "INF";
    });
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
    carriers.forEach(c => {
      const base = 220 + (from.charCodeAt(0) + to.charCodeAt(0)) % 180;
      families.forEach(fam => {
        if (cls && cls !== fam.letter) return;
        let price = base * fam.mult;
        if (paxType === "CHD") price *= 0.75;
        if (paxType === "INF") price *= 0.10;
        writeLine(`${row++}. ${c} ${fam.letter}${fam.code.charAt(0)} ${fam.code.padEnd(9)} EUR ${price.toFixed(2)}`, "hint");
      });
    });
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
  FQN: () => {
    const pnr = ensurePNR();
    if (!pnr.fare) return writeLine("PRICE PNR FIRST (FXP)", "err");
    writeLine("FARE RULES:", "ok");
    writeLine(`FARE BASIS ${pnr.fare.fareBasis}  NVB${pnr.fare.nvb}  NVA${pnr.fare.nva}`, "hint");
    writeLine(`CHANGES: ${pnr.fare.lowest ? "NOT PERMITTED" : "PERMITTED, FEE EUR 150.00"}`, "hint");
    writeLine(`CANCELLATION: ${pnr.fare.lowest ? "NONREFUNDABLE" : "REFUNDABLE, FEE EUR 150.00"}`, "hint");
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
  FXA: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().match(/^(.*)\s+(\d+(?:\.\d+)?)$/);
    if (!m) return writeLine("FORMAT: FXA <DESCRIPTION> <PRICE>", "err");
    const price = parseFloat(m[2]);
    pnr.ancillaries.push({ type: "FXA", text: m[1].trim().toUpperCase(), price });
    addHistory(pnr, `ADDED ANCILLARY FXA ${m[1].trim().toUpperCase()} (${price.toFixed(2)})`);
    writeLine(`ANCILLARY ADDED: ${m[1].trim().toUpperCase()} - EUR ${price.toFixed(2)}`, "ok");
  },
  FXK: (arg) => {
    const pnr = ensurePNR();
    const m = arg.trim().match(/^(.*)\s+(\d+(?:\.\d+)?)$/);
    if (!m) return writeLine("FORMAT: FXK <DESCRIPTION> <PRICE>", "err");
    const price = parseFloat(m[2]);
    pnr.ancillaries.push({ type: "FXK", text: m[1].trim().toUpperCase(), price });
    addHistory(pnr, `ADDED ANCILLARY FXK ${m[1].trim().toUpperCase()} (${price.toFixed(2)})`);
    writeLine(`ANCILLARY ADDED: ${m[1].trim().toUpperCase()} - EUR ${price.toFixed(2)}`, "ok");
  },
  TTP: (arg) => {
    const pnr = ensurePNR();
    const tst = pnrTstLatest(pnr);
    if (!tst) return writeLine("NO TST ON FILE - PRICE WITH FXP OR FXB FIRST", "err");
    if (!pnr.validatingCarrier) return writeLine("VALIDATING CARRIER REQUIRED - ENTER FV<CARRIER>", "err");
    if (!pnr.formOfPayment) return writeLine("FORM OF PAYMENT REQUIRED - ENTER FP", "err");

    const a = arg.trim().toUpperCase();
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
    const issued = [];
    scopeIdx.forEach(i => {
      if (!pnr.passengers[i]) return;
      const serial = String(Math.floor(1000000000 + Math.random() * 9000000000));
      const t = { number: `${numeric}-${serial}`, passengerIndex: i, carrier: pnr.validatingCarrier, issuedAt: fmt.nowDate(), voided: false, tstId: tst.id };
      pnr.tickets.push(t);
      issued.push(t);
    });
    addHistory(pnr, `TICKETED ${issued.length} PAX`);
    savePNR(pnr);
    writeLine(`TTP - ${issued.length} TICKET(S) ISSUED`, "ok");
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
    writeLine(`ISSUED ${t.issuedAt}${t.voided ? " / VOIDED" : ""}`, "hint");
  },
  TRDC: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.tickets?.length) return writeLine("NO TICKET ON FILE", "err");
    const a = arg.trim().toUpperCase();
    let ticket;
    const lMatch = a.match(/^\/L(\d+)$/);
    const tMatch = a.match(/^\/TK-(.+)$/);
    if (lMatch) ticket = pnr.tickets[parseInt(lMatch[1], 10) - 1];
    else if (tMatch) ticket = pnr.tickets.find(t => t.number === tMatch[1]);
    if (!ticket) return writeLine("FORMAT: TRDC/L<n> OR TRDC/TK-<number>", "err");
    if (ticket.voided) return writeLine("TICKET ALREADY VOID", "err");
    ticket.voided = true;
    addHistory(pnr, `VOIDED TICKET ${ticket.number}`);
    savePNR(pnr);
    writeLine(`TICKET ${ticket.number} VOIDED`, "ok");
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
        if (typeFilter === "RFND" && !t.voided) return;
        rows.push({ locator: pnr.recordLocator, ticket: t });
      });
    });
    writeLine(`SALES REPORT ${dateFrom ? dateFrom + "-" + dateTo : fmt.nowDate()}`, "ok");
    if (!rows.length) return writeLine("NO TICKETS FOUND", "hint");
    rows.forEach(r => writeLine(`${r.locator}  ${r.ticket.number}  ${r.ticket.carrier}  ${r.ticket.voided ? "VOID" : "ISSUED"}`, "hint"));
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
    const n = arg.trim();
    if (!/^\d+$/.test(n)) return writeLine("FORMAT: QE<QUEUE NUMBER>", "err");
    const pnr = AMX.state.pnr;
    if (!pnr?.recordLocator) return writeLine("PNR MUST BE SAVED (ER) BEFORE QUEUING", "err");
    const q = ensureQueue(n);
    if (!q.pnrs.includes(pnr.recordLocator)) q.pnrs.push(pnr.recordLocator);
    addHistory(pnr, `PLACED ON QUEUE ${n}`);
    writeLine(`PNR ${pnr.recordLocator} PLACED ON QUEUE ${n}`, "ok");
  },
  QTQ: () => {
    writeLine("QUEUE COUNT TOTAL", "ok");
    Object.keys(AMX.state.queues).sort((a, b) => a - b).forEach(n => {
      const q = AMX.state.queues[n];
      writeLine(`${n}  ${q.name.padEnd(20)} ${q.pnrs.length}`, "hint");
    });
  },
  QT: (arg) => {
    const n = arg.trim();
    if (!/^\d+$/.test(n)) return writeLine("FORMAT: QT<QUEUE NUMBER>", "err");
    const q = ensureQueue(n);
    if (!q.pnrs.length) { AMX.state.queueBrowse = null; return writeLine(`QUEUE ${n} (${q.name}) IS EMPTY`, "ok"); }
    AMX.state.queueBrowse = { qnum: n, pos: 0 };
    const locator = q.pnrs[0];
    const pnr = loadPNR(locator);
    writeLine(`QUEUE ${n} (${q.name}) - ${q.pnrs.length} PNR(S)`, "ok");
    writeLine(`1. ${locator} ${(pnr?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
  },
  QN: () => {
    const b = AMX.state.queueBrowse;
    if (!b) return writeLine("NO QUEUE OPEN - USE QT<N> FIRST", "err");
    const q = AMX.state.queues[b.qnum];
    const locator = q.pnrs.shift();
    if (!locator) { AMX.state.queueBrowse = null; return writeLine("QUEUE EMPTY", "ok"); }
    AMX.state.pnr = loadPNR(locator);
    writeLine(`ACTIONED ${locator} - REMOVED FROM QUEUE ${b.qnum}`, "ok");
    if (q.pnrs.length) {
      const next = loadPNR(q.pnrs[0]);
      writeLine(`NEXT: ${q.pnrs[0]} ${(next?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
    } else {
      writeLine(`QUEUE ${b.qnum} IS NOW EMPTY`, "hint");
      AMX.state.queueBrowse = null;
    }
  },
  QD: () => {
    const b = AMX.state.queueBrowse;
    if (!b) return writeLine("NO QUEUE OPEN - USE QT<N> FIRST", "err");
    const q = AMX.state.queues[b.qnum];
    const locator = q.pnrs.shift();
    if (!locator) return writeLine("QUEUE EMPTY", "ok");
    q.pnrs.push(locator);
    writeLine(`${locator} DELAYED TO BOTTOM OF QUEUE ${b.qnum}`, "ok");
    if (q.pnrs.length) {
      const next = loadPNR(q.pnrs[0]);
      writeLine(`NEXT: ${q.pnrs[0]} ${(next?.passengers || []).map(p => p.name).join(", ") || ""}`, "hint");
    }
  },
  QI: () => {
    if (!AMX.state.queueBrowse) return writeLine("NO QUEUE OPEN", "err");
    AMX.state.queueBrowse = null;
    writeLine("EXITED QUEUE", "ok");
  },

  // Profiles
  PM: () => { AMX.state.profileMode = true; writeLine("PROFILE MODE ACTIVE", "ok"); },
  PME: () => { AMX.state.profileMode = false; AMX.state.profileDraft = null; writeLine("EXITED PROFILE MODE", "ok"); },
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
      writeLine("AVAILABLE SCENARIOS - REAL CUSTOMER CALLS, START TO FINISH:", "scenario");
      scenarios.forEach((sc, i) => writeLine(`${i + 1}. [${sc.level}] ${sc.title}`, "hint"));
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
      { instruction: "Add a checked bag — the customer needs one.", hint: "FXA CHECKED BAG 35", validate: (cmd) => cmd.startsWith("FXA") || cmd.startsWith("FXK") },
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
function dispatchCommand(s, verb) {
    const commandKeys = Object.keys(commands).sort((a, b) => b.length - a.length);
    const action = commandKeys.find(key => verb.startsWith(key));

    if (action) {
        const effectiveArg = s.slice(action.length).trim();
        commands[action](effectiveArg);
    } else {
        writeLine("UNKNOWN COMMAND", "err");
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
