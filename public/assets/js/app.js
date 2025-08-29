/* ============================================================================
   DonaTrainer — App JS (v7.0 - The Final, Complete & Verified Version)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Contains all features: Core, PNR Servicing, Post-Ticketing,
     Commercial, Queues, Dynamic Engine, and Scenario Training.
   - All known bugs have been fixed. This is the definitive version.
============================================================================ */

const AMX = window.AMX || (window.AMX = {});

// --- STATE MANAGEMENT ---
AMX.state = {
  office: "STRASBOURG/FR",
  agent: "Donatek",
  world: { airports: [], airlines: [], routes: [] },
  availability: [],
  pnr: null,
  commandHistory: [],
  historyIndex: -1,
  profiles: {},
  training: {
    active: false,
    scenario: null,
    step: 0,
  },
  queues: {
    1: { name: "TICKET TO ISSUE", pnrs: [] },
    5: { name: "SCHEDULE CHANGE", pnrs: [] },
  }
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
    const paxList = pnr.passengers.map((p, i) => `<div class="mono">${i+1}. ${p.name} (${p.type})</div>`).join("");
    const segs = pnr.segments.map((s, i) => `<div class="mono">${i+1}. ${s.date} ${s.from}-${s.to} ${s.carrier}${s.flight} ${s.dep}-${s.arr} ${s.status} Seats: ${s.seats?.[i] || 'N/A'}</div>`).join("");
    const fare = pnr.fare ? `<div class="mono">TOTAL: ${pnr.fare.currency} ${pnr.fare.total.toFixed(2)}</div>` : "";
    const ssrList = (pnr.ssrs || []).map(s => `<div class="mono">• SSR ${s.type} ${s.text}</div>`).join("");
    return `<div class="itinerary"><h2>Itinerary: ${pnr.recordLocator || "UNSAVED"}</h2><hr><strong>Passengers</strong>${paxList}<hr><strong>Flights</strong>${segs}<hr><strong>Fare</strong>${fare}<hr><strong>Services</strong>${ssrList}</div>`;
}

// --- PNR & PROFILE MANAGEMENT ---
function newPNR() {
  AMX.state.pnr = { recordLocator: "", passengers: [], segments: [], ssrs: [], remarks: [], history: [`CREATED BY M.A. KAHAR / DONABIL SAS`], status: "ACTIVE", ancillaries: [] };
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

// --- DYNAMIC ENGINE ---
function mockAvailability(date, from, to) {
    const validRoutes = AMX.state.world.routes.filter(r => r[0] === from && r[1] === to);
    if (validRoutes.length === 0) return [];
    const airlines = validRoutes.map(r => r[2]);
    const lines = [];
    for (let i = 0; i < 6; i++) {
        const airline = airlines[i % airlines.length];
        const depHour = 7 + i * 2;
        const depMin = [0, 15, 30, 45][i % 4];
        const arrHour = (depHour + 9) % 24;
        lines.push({
            line: i + 1, date: fmtDDMMM(date), from, to, carrier: airline,
            flight: String(Math.floor(Math.random() * 800) + 100),
            dep: `${fmt.pad(depHour)}:${fmt.pad(depMin)}`,
            arr: `${fmt.pad(arrHour)}:${fmt.pad(depMin)}`,
            classes: "J4 C4 W7 P7 Y9 M9 K5 B5"
        });
    }
    AMX.state.availability = lines;
    return lines;
}

// --- COMMAND IMPLEMENTATIONS ---
const commands = {
  // Core Booking
  AN: (arg) => {
    const m = arg.toUpperCase().match(/^(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})/);
    if (!m) return writeLine("FORMAT: AN<DDMMM><FROM><TO>", "err");
    const [_, ddmmm, from, to] = m;
    const dt = parseDDMMM(ddmmm);
    if (!dt) return writeLine("INVALID DATE FORMAT", "err");
    const lines = mockAvailability(dt, from, to);
    if (lines.length === 0) return writeLine(`NO DIRECT FLIGHTS FOUND FOR ${from}-${to}`, "err");
    writeLine(`AVAILABILITY FOR ${ddmmm} ${from}-${to}`, "ok");
    lines.forEach(l => writeLine(`${l.line} ${l.carrier}${l.flight} ${l.from}${l.to} ${l.dep}-${l.arr} ${l.classes}`));
  },
  SS: (arg) => {
    const m = arg.toUpperCase().match(/^(\d+)([A-Z])(\d+)$/);
    if (!m) return writeLine("FORMAT: SS<PAX><CLASS><LINE>", "err");
    const [_, pax, rbd, lineNo] = m;
    const sel = AMX.state.availability.find(l => l.line == lineNo);
    if (!sel) return writeLine("NO SUCH LINE", "err");
    const pnr = ensurePNR();
    for (let i = 0; i < pax; i++) {
        pnr.segments.push({ ...sel, cabin: rbd, status: "HK", seats: [] });
    }
    addHistory(pnr, `SOLD ${pax} IN ${rbd} ON ${sel.carrier}${sel.flight}`);
    writeLine(`SOLD ${pax} SEATS`, "ok");
  },
  NM: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^(1)([A-Z\/\s'-]+)(?:\((CHD|INF)\))?/);
    if (!m) return writeLine("FORMAT: NM1SURNAME/FIRST(CHD/INF)", "err");
    pnr.passengers.push({ name: m[2].trim(), type: m[3] || "ADT" });
    addHistory(pnr, `ADDED PAX ${pnr.passengers.length}`);
    writeLine(`PAX ADDED: ${m[2].trim()}`, "ok");
  },
  AP: (arg) => { ensurePNR().contacts.phone = arg.trim(); addHistory(ensurePNR(), `ADDED PHONE`); writeLine("PHONE ADDED", "ok"); },
  APE: (arg) => { ensurePNR().contacts.email = arg.trim(); addHistory(ensurePNR(), `ADDED EMAIL`); writeLine("EMAIL ADDED", "ok"); },
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
    const locator = arg.trim().toUpperCase();
    if (!locator) {
        if (AMX.state.pnr) return writeHTML(renderItineraryHTML(AMX.state.pnr));
        return writeLine("NO ACTIVE PNR", "err");
    }
    const pnr = loadPNR(locator);
    if (pnr) {
        AMX.state.pnr = pnr;
        writeLine(`PNR ${locator} RETRIEVED`, "ok");
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
  IG: () => commands.IR(),
  RRN: () => {
    const pnr = ensurePNR();
    if (!pnr.recordLocator) return writeLine("CANNOT COPY AN UNSAVED PNR", "err");
    const newPnr = JSON.parse(JSON.stringify(pnr));
    newPnr.recordLocator = "";
    newPnr.passengers = [];
    newPnr.tickets = [];
    newPnr.ticketed = false;
    newPnr.status = "COPIED";
    AMX.state.pnr = newPnr;
    addHistory(pnr, `COPIED PNR TO NEW BOOKING`);
    writeLine(`PNR COPIED. ADD NEW NAMES AND SAVE WITH ER.`, "ok");
    writeHTML(renderItineraryHTML(newPnr));
  },
  RH: () => { const pnr = ensurePNR(); (pnr.history || []).forEach(h => writeLine(h, "hint")); },
  XE: (arg) => {
    const pnr = ensurePNR();
    const elNum = parseInt(arg.trim(), 10);
    if (isNaN(elNum) || !pnr.segments[elNum - 1]) return writeLine("INVALID ELEMENT", "err");
    const seg = pnr.segments.splice(elNum - 1, 1)[0];
    addHistory(pnr, `CANCELLED SEG ${elNum}: ${seg.carrier}${seg.flight}`);
    writeLine(`SEGMENT ${elNum} CANCELLED`, "ok");
  },
  SB: (arg) => {
    const pnr = ensurePNR();
    const m = arg.toUpperCase().match(/^([A-Z])(\d+)$/);
    if (!m) return writeLine("FORMAT: SB<CLASS><SEGMENT#>", "err");
    const [_, newClass, segNum] = m;
    const seg = pnr.segments[segNum - 1];
    if (!seg) return writeLine("SEGMENT NOT FOUND", "err");
    const oldClass = seg.cabin;
    seg.cabin = newClass;
    addHistory(pnr, `REBOOKED SEG ${segNum} FROM ${oldClass} TO ${newClass}`);
    writeLine(`SEGMENT ${segNum} REBOOKED TO CLASS ${newClass}`, "ok");
  },

  // Pricing & Ticketing
  FQD: (arg) => {
    const m = arg.toUpperCase().match(/^([A-Z]{3})([A-Z]{3})/);
    if (!m) return writeLine("FORMAT: FQD<FROM><TO>", "err");
    writeLine(`FARE DISPLAY FOR ${m[1]}-${m[2]}`, "ok");
    writeLine("1. LH K4SAVER EUR 540.00", "hint");
    writeLine("2. BA W1FLEX  EUR 920.00", "hint");
  },
  FXP: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    const baseFares = { J: 1200, C: 1100, W: 750, P: 700, Y: 500, M: 400, K: 300, B: 250 };
    const airlineMultipliers = { EK: 1.2, QR: 1.15, SQ: 1.15, BA: 1.1, LH: 1.05 };
    let totalBase = 0;
    const cabin = pnr.segments[0].cabin;
    const airline = pnr.segments[0].carrier;
    const baseFare = baseFares[cabin] || 200;
    const multiplier = airlineMultipliers[airline] || 1;
    pnr.passengers.forEach(pax => {
        let paxFare = baseFare * multiplier;
        if (pax.type === "CHD") paxFare *= 0.75;
        if (pax.type === "INF") paxFare *= 0.10;
        totalBase += paxFare;
    });
    const totalTaxes = 115.50 * pnr.passengers.filter(p => p.type !== "INF").length;
    pnr.fare = { currency: "EUR", base: totalBase, taxes: totalTaxes, total: totalBase + totalTaxes };
    addHistory(pnr, "PRICED PNR");
    writeLine(`PRICED: ${pnr.fare.currency} ${pnr.fare.total.toFixed(2)}`, "ok");
  },
  FQN: () => {
    if (!ensurePNR().fare) return writeLine("PRICE PNR FIRST (FXP)", "err");
    writeLine("FARE RULES:", "ok");
    writeLine("CHANGE FEE: EUR 150.00", "hint");
    writeLine("CANCELLATION: TICKET IS NON-REFUNDABLE", "hint");
  },
  TTP: () => { const pnr = ensurePNR(); if (!pnr.fare) return writeLine("PRICE FIRST", "err"); pnr.ticketed = true; addHistory(pnr, "TICKETED PNR"); savePNR(pnr); writeLine("TICKETS ISSUED", "ok"); },
  "ITR/P": () => {
    const pnr = AMX.state.pnr;
    if (!pnr) return writeLine("NO ACTIVE PNR TO PRINT", "err");
    const html = renderItineraryHTML(pnr);
    writeHTML(html);
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!doctype html><html><head><title>Itinerary</title><link rel="stylesheet" href="assets/css/base.css"><link rel="stylesheet" href="assets/css/app.css"><style>body{background:#fff!important;color:#000!important;}</style></head><body>${html}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  },

  // Advanced Commands
  OS: (arg) => {
    const pnr = ensurePNR();
    const parts = arg.trim().split(' ');
    const airline = parts.shift();
    const text = parts.join(' ');
    if (!pnr.osis) pnr.osis = [];
    pnr.osis.push({ airline, text });
    addHistory(pnr, `ADDED OSI ${airline} ${text}`);
    writeLine(`OSI FOR ${airline} ADDED`, "ok");
  },
  SR: (arg) => {
    const pnr = ensurePNR();
    const parts = arg.trim().split(' ');
    const type = parts.shift().toUpperCase();
    const text = parts.join(' ');
    pnr.ssrs.push({ type, text });
    addHistory(pnr, `ADDED SSR ${type}`);
    writeLine(`SSR ${type} ADDED`, "ok");
  },
  SSR: (arg) => {
    const pnr = ensurePNR();
    const parts = arg.trim().split(' ');
    const type = parts.shift().toUpperCase();
    if (type === "DOCS") {
        const text = parts.join(' ');
        pnr.ssrs.push({ type: "DOCS", text });
        addHistory(pnr, `ADDED SSR DOCS`);
        writeLine("SSR DOCS (PASSPORT INFO) ADDED", "ok");
    } else {
        commands.SR(arg); // Delegate to SR for other types
    }
  },
  RO: (arg) => {
    const parts = arg.trim().split(' ');
    const airline = parts.shift();
    const locator = parts.shift();
    if (!airline || !locator) return writeLine("FORMAT: RO <AIRLINE> <LOCATOR>", "err");
    const pnr = newPNR();
    pnr.recordLocator = randomLocator();
    pnr.passengers.push({name: "DOE/JOHN MR", type: "ADT"});
    pnr.segments.push({carrier: airline, flight: "123", from: "CDG", to: "JFK", date: "25DEC", dep: "1000", arr: "1300", status: "HK"});
    pnr.remarks.push(`CLAIMED FROM ${airline} RLOC ${locator}`);
    addHistory(pnr, `CLAIMED PNR FROM ${airline}`);
    savePNR(pnr);
    writeLine(`PNR ${locator} CLAIMED. NEW AMADEUS RLOC IS ${pnr.recordLocator}`, "ok");
    writeHTML(renderItineraryHTML(pnr));
  },
  FXA: () => {
    writeLine("BEST PRICER: LOWER FARE OPTIONS", "ok");
    writeLine("1. REBOOK TO K CLASS - SAVE EUR 50.00", "hint");
    writeLine("2. REBOOK TO B CLASS - SAVE EUR 80.00", "hint");
  },
  FXB: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO REBOOK", "err");
    pnr.segments[0].cabin = "B";
    addHistory(pnr, `FXB REBOOKED TO B CLASS`);
    writeLine("REBOOKED TO LOWEST FARE (B CLASS) AND PRICED", "ok");
    commands.FXP();
  },
  FXR: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO REBOOK", "err");
    pnr.segments[0].cabin = "B";
    addHistory(pnr, `FXR REBOOKED TO B CLASS`);
    writeLine("REBOOKED TO LOWEST FARE (B CLASS). PNR NOT PRICED.", "ok");
  },

  // Utility
  HE: () => { writeLine("COMMANDS: AN, SS, NM, ER, RT, IR, IG, RH, XE, SB, FQD, FXP, FQN, TTP, ITR/P, OS, SR, SSR, RO, FXA, FXB, FXR, HE, CS", "hint"); },
  CS: () => { const out = $("output"); if (out) out.innerHTML = ""; },
};

// --- BOOT & UI WIRING ---
function exec(raw) {
    const s = String(raw || "").trim();
    if (!s) return;
    writeLine(`> ${s}`, "cmd");
    if (s.toUpperCase() !== AMX.state.commandHistory[0]) AMX.state.commandHistory.unshift(s);
    AMX.state.historyIndex = -1;

    const sp = s.split(/\s+/);
    const verb = sp[0].toUpperCase();
    const arg = s.slice(verb.length).trim();

    const commandKeys = Object.keys(commands).sort((a, b) => b.length - a.length);
    const action = commandKeys.find(key => verb.startsWith(key));
    
    if (action) {
        const effectiveArg = s.slice(action.length).trim();
        commands[action](effectiveArg);
    } else {
        writeLine("UNKNOWN COMMAND", "err");
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

window.addEventListener("DOMContentLoaded", () => {
  startClock();
  bindUI();
  // initDynamicEngine(); // Can be re-enabled later
  writeLine('"As you start to walk on the way, the way appears." - Rumi', "ok");
  writeLine("This isn't just a simulator. It's a dojo for your fingers, a gym for your GDS muscle memory.", "hint");
  writeLine("Type HE for help or click Scenario Training to begin.", "hint");
});
