/* ============================================================================
   DonaTrainer — App JS (v8.0 - Amadeus Guide Expansion)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Full command coverage from the Amadeus Basic training guide: pricing/TST,
     ticketing, queues, profiles, decode/encode, rebooking, name-search retrieval.
   - Realistic flight durations & class inventory driven by real airport coords.
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
  const fare = pnr.fare ? `<div class="mono">TOTAL: ${pnr.fare.currency} ${pnr.fare.total.toFixed(2)}</div>` : "";
  const ssrList = (pnr.ssrs || []).map(s => `<div class="mono">&bull; SSR ${s.type} ${s.text}</div>`).join("");
  const contacts = pnr.contacts || {};
  const contactList = Object.entries(contacts).filter(([, v]) => v).map(([k, v]) => `<div class="mono">&bull; ${k.toUpperCase()}: ${v}</div>`).join("");
  const tickets = (pnr.tickets || []).map((t, i) => `<div class="mono">${i+1}. ${t.number} ${pnr.passengers[t.passengerIndex]?.name || ""}${t.voided ? " (VOID)" : ""}</div>`).join("");
  return `<div class="itinerary"><h2>Itinerary: ${pnr.recordLocator || "UNSAVED"}</h2><hr><strong>Passengers</strong>${paxList}<hr><strong>Flights</strong>${segs}<hr><strong>Contacts</strong>${contactList || '<div class="mono">NONE</div>'}<hr><strong>Fare</strong>${fare}<hr><strong>Services</strong>${ssrList}<hr><strong>Tickets</strong>${tickets || '<div class="mono">NONE</div>'}</div>`;
}

// --- PNR & PROFILE MANAGEMENT ---
function newPNR() {
  AMX.state.pnr = {
    recordLocator: "", passengers: [], segments: [], ssrs: [], remarks: [],
    history: [`CREATED BY M.A. KAHAR / DONABIL SAS`], status: "ACTIVE", ancillaries: [],
    contacts: {}, tst: [], tickets: [],
    validatingCarrier: null, formOfPayment: null, commission: null,
  };
  return AMX.state.pnr;
}
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
function computeFare(pnr, idxList, lowest) {
  const BASE = lowest ? 280 : 350;
  let totalBase = 0;
  idxList.forEach(i => {
    const pax = pnr.passengers[i];
    let baseFare = BASE;
    if (pax.type === "CHD") baseFare *= 0.75;
    if (pax.type === "INF") baseFare *= 0.10;
    totalBase += baseFare;
  });
  const payingCount = idxList.filter(i => pnr.passengers[i].type !== "INF").length;
  const totalTaxes = 115.50 * payingCount;
  return { currency: "EUR", base: totalBase, taxes: totalTaxes, total: totalBase + totalTaxes, scope: idxList };
}
function parsePricingScope(arg) { return arg.trim().toUpperCase().replace(/^\//, "") || null; }

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
  RT: "RT<LOCATOR> retrieves a PNR. RT/<SURNAME> searches by exact surname, RT/<PARTIAL> by partial surname (numbered list - select with RT<n>). Bare RT redisplays the active PNR.",
  PRICING: "FXX/FXR display a fare without storing it; FXP/FXB store it as a TST (FXB also uses the lowest fare found). Add /P1, /PAX or /INF to price a subset of passengers.",
  FXP: "FXP prices the active itinerary and stores the result as a TST. Use /P1 for passenger 1 only, /PAX for adults+children, /INF for the infant only.",
  FXD: "FXD<FROM><TO> (or FXD<N><FROM><TO>) runs the Master Pricer and returns a ranked list of fare recommendations for the city pair.",
  FQD: "FQD<FROM><TO>[/A<CARRIER>][/C<CLASS>][/D<DDMMM>][/R,-CH|/R,-INF] displays fares for a city pair without needing a PNR.",
  FQP: "FQP<FROM>/A<CARRIER>/D<DDMMM><TO>[/R,-CH|/R,-INF] prices a specific itinerary without creating a PNR. Chain a second leg with --- for a connection.",
  FP: "FP sets the form of payment: FP CASH, FP INV, or FP CC <VI|CA|AX> <CARDNUMBER>/<MMYY>. Required before ticketing.",
  TTP: "TTP issues tickets from the active TST. Requires a validating carrier (FV) and a form of payment (FP) on file. TTP/P1, TTP/PAX and TTP/INF scope the issuance.",
  TWD: "TWD displays the current e-ticket. TWD/L<n> selects by line, TWD/TKT<number> by ticket number, TWD/TAX shows the tax breakdown, TWH shows the ticket's history.",
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

      for (let i = 0; i < pax; i++) {
        sel.segments.forEach(leg => pnr.segments.push({ ...leg, cabin: rbd, status: "HK", seats: [] }));
      }
      addHistory(pnr, `SOLD ${pax} IN ${rbd} FROM LINE ${lineNo}`);
      writeLine(`SOLD ${pax} SEAT(S) FROM ${index === 0 ? "OUTBOUND" : "INBOUND"}${sel.connection ? " (CONNECTION - 2 SEGMENTS)" : ""}`, "ok");
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
      writeLine(`PNR ${sel.locator} RETRIEVED`, "ok");
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
        writeLine(`PNR ${results[0].locator} RETRIEVED`, "ok");
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
      writeLine(`PNR ${upper} RETRIEVED`, "ok");
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
    const fare = computeFare(pnr, idx, false);
    pnr.fare = fare;
    pnr.tst.push({ id: pnr.tst.length + 1, ...fare, createdAt: fmt.nowDate() });
    addHistory(pnr, "PRICED PNR (FXP)");
    writeLine(`PRICED: ${fare.currency} ${fare.total.toFixed(2)} - TST${pnr.tst.length} STORED`, "ok");
  },
  FXB: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const idx = selectPassengersByScope(pnr, parsePricingScope(arg));
    if (!idx.length) return writeLine("NO PASSENGERS MATCH SCOPE", "err");
    const fare = computeFare(pnr, idx, true);
    pnr.fare = fare;
    pnr.tst.push({ id: pnr.tst.length + 1, ...fare, createdAt: fmt.nowDate() });
    addHistory(pnr, "PRICED PNR WITH LOWEST FARE (FXB)");
    writeLine(`LOWEST FARE STORED: ${fare.currency} ${fare.total.toFixed(2)} - TST${pnr.tst.length} STORED`, "ok");
  },
  FQN: () => {
    if (!ensurePNR().fare) return writeLine("PRICE PNR FIRST (FXP)", "err");
    writeLine("FARE RULES:", "ok");
    writeLine("CHANGE FEE: EUR 150.00", "hint");
    writeLine("CANCELLATION: TICKET IS NON-REFUNDABLE", "hint");
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
    writeLine(`TICKETS ISSUED: ${issued.length}`, "ok");
    issued.forEach(t => writeLine(`${t.number}  ${pnr.passengers[t.passengerIndex].name}`, "hint"));
  },
  "ITR/P": () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR TO PRINT", "err");
    const html = renderItineraryHTML(pnr);
    writeHTML(html);
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!doctype html><html><head><title>Itinerary</title><link rel="stylesheet" href="../assets/css/base.css"><link rel="stylesheet" href="../assets/css/app.css"><style>body{background:#fff!important;color:#000!important;}</style></head><body>${html}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  },
  TWD: (arg) => {
    const pnr = AMX.state.pnr;
    if (!pnr || !pnr.tickets || !pnr.tickets.length) return writeLine("NO TICKET ON FILE", "err");
    const a = arg.trim().toUpperCase();
    if (a === "/TAX") {
      writeLine("TAX BREAKDOWN:", "ok");
      writeLine(`TOTAL TAXES: ${pnr.fare?.currency || "EUR"} ${(pnr.fare?.taxes || 0).toFixed(2)}`, "hint");
      return;
    }
    let ticket;
    const lMatch = a.match(/^\/L(\d+)$/);
    const tMatch = a.match(/^\/TKT(.+)$/);
    if (lMatch) ticket = pnr.tickets[parseInt(lMatch[1], 10) - 1];
    else if (tMatch) ticket = pnr.tickets.find(t => t.number === tMatch[1]);
    else ticket = pnr.tickets[pnr.tickets.length - 1];
    if (!ticket) return writeLine("TICKET NOT FOUND", "err");
    const pax = pnr.passengers[ticket.passengerIndex];
    writeLine(`E-TICKET ${ticket.number}${ticket.voided ? " (VOID)" : ""}`, "ok");
    writeLine(`PASSENGER: ${pax?.name || "UNKNOWN"}`, "hint");
    pnr.segments.forEach((s, i) => writeLine(`${i + 1}. ${s.date} ${s.from}-${s.to} ${s.carrier}${s.flight} ${s.status}`, "hint"));
    writeLine(`FARE: ${pnr.fare?.currency || ""} ${(pnr.fare?.total || 0).toFixed(2)}`, "hint");
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
    if (!pnr.segments[segIdx]) return writeLine("SEGMENT NOT FOUND", "err");
    writeLine(`SEAT MAP FOR SEGMENT ${segIdx + 1}`, "ok");
    writeLine("   A B C   D E F", "hint");
    writeLine("24 O O X   O X O", "hint");
    writeLine("25 X O O   O O X", "hint");
  },
  ST: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^(\d+[A-F])\/P(\d+)$/);
    if (!m) return writeLine("FORMAT: ST/<SEAT>/P<PAX#>", "err");
    const [, seat, paxIdx] = m;
    if (!pnr.passengers[paxIdx - 1]) return writeLine("PASSENGER NOT FOUND", "err");
    if (pnr.segments[0]) {
      pnr.segments.forEach(seg => {
        if (!seg.seats) seg.seats = [];
        seg.seats[paxIdx - 1] = seat;
      });
      addHistory(pnr, `ASSIGNED SEAT ${seat} TO PAX ${paxIdx}`);
      writeLine(`SEAT ${seat} ASSIGNED TO PAX ${paxIdx} FOR ALL SEGMENTS`, "ok");
    } else {
      writeLine("NO FLIGHTS TO ASSIGN SEATS TO", "err");
    }
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
    if (arg.toUpperCase() === 'START') {
      AMX.state.training.active = true;
      AMX.state.training.scenario = scenarios[0];
      AMX.state.training.step = 0;
      writeLine(AMX.state.training.scenario.description, "scenario");
      writeLine(AMX.state.training.scenario.steps[0].instruction, "scenario");
    }
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
        name: "Basic Booking",
        description: "SCENARIO 1: A client wants a one-way flight.",
        steps: [
            { instruction: "Find a flight from LHR to CDG for tomorrow.", validate: (cmd) => cmd.startsWith("AN") },
            { instruction: "Book one seat in economy.", validate: (cmd) => cmd.startsWith("SS") },
            { instruction: "Add the passenger name: SMITH/JOHN MR", validate: (cmd) => cmd.includes("SMITH/JOHN") },
            { instruction: "Save the PNR.", validate: (cmd) => cmd === "ER" },
        ]
    }
];

// --- BOOT & UI WIRING ---
function exec(raw) {
    const s = String(raw || "").trim();
    if (!s) return;
    writeLine(`> ${s}`, "cmd");
    if (s.toUpperCase() !== AMX.state.commandHistory[0]) AMX.state.commandHistory.unshift(s);
    AMX.state.historyIndex = -1;

    const sp = s.split(/\s+/);
    const verb = sp[0].toUpperCase();

    if (AMX.state.training.active) {
        const step = AMX.state.training.scenario.steps[AMX.state.training.step];
        if (step.validate(verb)) {
            AMX.state.training.step++;
            if (AMX.state.training.step >= AMX.state.training.scenario.steps.length) {
                writeLine("SCENARIO COMPLETE!", "ok");
                AMX.state.training.active = false;
            } else {
                writeLine("Correct! Next step:", "ok");
                writeLine(AMX.state.training.scenario.steps[AMX.state.training.step].instruction, "scenario");
            }
        } else {
            writeLine("Incorrect command for this step. Please try again.", "err");
        }
    } else {
        const commandKeys = Object.keys(commands).sort((a, b) => b.length - a.length);
        const action = commandKeys.find(key => verb.startsWith(key));

        if (action) {
            const effectiveArg = s.slice(action.length).trim();
            commands[action](effectiveArg);
        } else {
            writeLine("UNKNOWN COMMAND", "err");
        }
    }
}

function bindUI() {
  const input = $("commandInput");
  const enterBtn = $("btnEnter");
  $("btnTrain").addEventListener("click", () => exec("TRAIN START"));

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
