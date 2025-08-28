/* ============================================================================
   DonaTrainer — App JS (v6.2 - Final Bug Fixes)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Contains all features: Core, PNR Servicing, Post-Ticketing,
     Commercial, Queues, Dynamic Engine, and Scenario Training.
   - FIXED: AP/APE command parsing bug.
   - FIXED: ITR/P print dialog reliability.
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
    const segs = pnr.segments.map((s, i) => `<div class="mono">${i+1}. ${s.date} ${s.from}-${s.to} ${s.carrier}${s.flight} ${s.dep}-${s.arr} ${s.status}</div>`).join("");
    const fare = pnr.fare ? `<div class="mono">TOTAL: ${pnr.fare.currency} ${pnr.fare.total.toFixed(2)}</div>` : "";
    const ancillaries = (pnr.ancillaries || []).map(a => `<div class="mono">• ${a.service} - ${a.price.toFixed(2)} EUR</div>`).join("");
    return `<div class="itinerary"><h2>Itinerary: ${pnr.recordLocator}</h2><hr><strong>Passengers</strong>${paxList}<hr><strong>Flights</strong>${segs}<hr><strong>Fare</strong>${fare}<hr><strong>Services</strong>${ancillaries}</div>`;
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
function saveProfile(profile) { if (profile?.name) localStorage.setItem(`profile_${profile.name.toUpperCase()}`, JSON.stringify(profile)); }
function loadProfile(name) { const data = localStorage.getItem(`profile_${name.toUpperCase()}`); return data ? JSON.parse(data) : null; }
function randomLocator() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// --- COMMAND IMPLEMENTATIONS ---
const commands = {
  // Core Booking
  AN: (arg) => {
    const m = arg.toUpperCase().match(/^(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})/);
    if (!m) return writeLine("FORMAT: AN<DDMMM><FROM><TO>", "err");
    writeLine(`AVAILABILITY FOR ${m[1]} ${m[2]}-${m[3]}`, "ok");
    AMX.state.availability = [
        { line: 1, carrier: "LH", flight: "400", from: m[2], to: m[3], date: m[1], dep: "0800", arr: "1000", classes: "J4 Y9 M9 K5" },
        { line: 2, carrier: "BA", flight: "282", from: m[2], to: m[3], date: m[1], dep: "1030", arr: "1230", classes: "C4 W7 Y9" },
    ];
    AMX.state.availability.forEach(l => writeLine(`${l.line} ${l.carrier}${l.flight} ${l.from}${l.to} ${l.dep}-${l.arr} ${l.classes}`));
  },
  SS: (arg) => {
    const m = arg.toUpperCase().match(/^(\d+)([A-Z])(\d+)$/);
    if (!m) return writeLine("FORMAT: SS<PAX><CLASS><LINE>", "err");
    const [_, pax, rbd, lineNo] = m;
    const sel = AMX.state.availability.find(l => l.line == lineNo);
    if (!sel) return writeLine("NO SUCH LINE", "err");
    const pnr = ensurePNR();
    for (let i = 0; i < pax; i++) {
        pnr.segments.push({ ...sel, cabin: rbd, status: "HK" });
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
  IG: () => commands.IR(), // Alias for IR
  RH: () => { const pnr = ensurePNR(); (pnr.history || []).forEach(h => writeLine(h, "hint")); },
  NU: (arg) => {
    const pnr = ensurePNR();
    const m = arg.match(/^(\d+)\/(\d+)(.*)$/);
    if (!m) return writeLine("FORMAT: NU<PAX>/<FIELD> <NEW VALUE>", "err");
    const [_, paxIdx, fieldIdx, value] = m;
    const pax = pnr.passengers[parseInt(paxIdx) - 1];
    if (!pax) return writeLine("PASSENGER NOT FOUND", "err");
    if (parseInt(fieldIdx) === 1) {
        addHistory(pnr, `UPDATED PAX ${paxIdx} NAME`);
        pax.name = value.trim();
        writeLine(`PAX ${paxIdx} NAME UPDATED`, "ok");
    } else {
        writeLine("CAN ONLY UPDATE NAME (FIELD 1)", "err");
    }
  },
  RM: (arg) => { ensurePNR().remarks.push(arg.trim()); addHistory(ensurePNR(), `ADDED RM`); writeLine("REMARK ADDED", "ok"); },
  XE: (arg) => {
    const pnr = ensurePNR();
    const elNum = parseInt(arg.trim(), 10);
    if (isNaN(elNum) || !pnr.segments[elNum - 1]) return writeLine("INVALID ELEMENT", "err");
    const seg = pnr.segments.splice(elNum - 1, 1)[0];
    addHistory(pnr, `CANCELLED SEG ${elNum}: ${seg.carrier}${seg.flight}`);
    writeLine(`SEGMENT ${elNum} CANCELLED`, "ok");
  },
  SP: (arg) => {
    const pnr = ensurePNR();
    const paxIndices = arg.split(',').map(n => parseInt(n.trim(), 10) - 1);
    if (paxIndices.some(isNaN) || paxIndices.length >= pnr.passengers.length) return writeLine("INVALID PAX TO SPLIT", "err");
    const newPnr = newPNR();
    const splitPax = [];
    paxIndices.reverse().forEach(i => { if (pnr.passengers[i]) splitPax.unshift(pnr.passengers.splice(i, 1)[0]); });
    if (splitPax.length === 0) return writeLine("NO VALID PAX TO SPLIT", "err");
    newPnr.passengers = splitPax;
    newPnr.segments = JSON.parse(JSON.stringify(pnr.segments));
    newPnr.recordLocator = randomLocator();
    addHistory(pnr, `SPLIT PAX TO PNR ${newPnr.recordLocator}`);
    addHistory(newPnr, `SPLIT FROM PNR ${pnr.recordLocator}`);
    savePNR(pnr);
    savePNR(newPnr);
    AMX.state.pnr = newPnr;
    writeLine(`SPLIT ${splitPax.length} PAX TO NEW PNR: ${newPnr.recordLocator}`, "ok");
    writeHTML(renderItineraryHTML(newPnr));
  },

  // Pricing & Ticketing
  FXP: () => { const pnr = ensurePNR(); pnr.fare = { currency: "EUR", total: 350.55 }; addHistory(pnr, "PRICED PNR"); writeLine("PRICED: EUR 350.55", "ok"); },
  FQN: () => { writeLine("FARE RULES: CHANGES EUR 150. NON-REFUNDABLE.", "hint"); },
  TTP: () => { const pnr = ensurePNR(); if (!pnr.fare) return writeLine("PRICE FIRST", "err"); pnr.ticketed = true; addHistory(pnr, "TICKETED PNR"); savePNR(pnr); writeLine("TICKETS ISSUED", "ok"); },
  TWX: () => { const pnr = ensurePNR(); if (!pnr.ticketed) return writeLine("NOT TICKETED", "err"); pnr.status = "VOIDED"; pnr.ticketed = false; addHistory(pnr, "VOIDED TICKET"); savePNR(pnr); writeLine("TICKET VOIDED", "ok"); },
  TRF: () => { const pnr = ensurePNR(); if (!pnr.ticketed) return writeLine("NOT TICKETED", "err"); pnr.status = "REFUNDED"; pnr.ticketed = false; addHistory(pnr, "REFUNDED TICKET"); savePNR(pnr); writeLine("TICKET REFUNDED", "ok"); },
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

  // Commercial & Advanced
  PROFILE: (arg) => {
    const parts = arg.split(' ');
    const action = parts.shift().toUpperCase();
    const name = parts.join(' ');
    if (action === 'CREATE') {
        const profile = { name, fqtv: "LH123456789", docs: "P/GB/123/GB/01JAN80/M" };
        saveProfile(profile);
        writeLine(`PROFILE CREATED FOR ${name}`, "ok");
    } else if (action === 'LOAD') {
        const profile = loadProfile(name);
        if (profile) {
            const pnr = ensurePNR();
            pnr.passengers.push({ name: profile.name, type: "ADT" });
            pnr.ssrs.push({ type: "FQTV", text: profile.fqtv });
            pnr.ssrs.push({ type: "DOCS", text: profile.docs });
            writeLine(`PROFILE ${name} LOADED INTO PNR`, "ok");
        } else {
            writeLine("PROFILE NOT FOUND", "err");
        }
    }
  },
  FXA: () => { writeLine("ANCILLARY SERVICES: 1. EXTRA BAG - 50.00 EUR", "hint"); },
  FXK: () => { const pnr = ensurePNR(); if (!pnr.ancillaries) pnr.ancillaries = []; pnr.ancillaries.push({ service: "EXTRA BAG", price: 50.00 }); addHistory(pnr, "ADDED ANCILLARY"); writeLine("EXTRA BAG ADDED", "ok"); },
  "TTP/EMD": () => { addHistory(ensurePNR(), "ISSUED EMD"); writeLine("EMD ISSUED", "ok"); },
  FCM: (arg) => {
    const pnr = ensurePNR();
    if (!pnr.fare) return writeLine("PRICE FIRST", "err");
    const m = arg.toUpperCase().match(/^(A|P)(\d+)$/);
    if (!m) return writeLine("FORMAT: FCM-A<AMT> or FCM-P<PERCENT>", "err");
    if (m[1] === 'A') pnr.fare.total += parseInt(m[2]);
    if (m[1] === 'P') pnr.fare.total *= (1 + parseInt(m[2]) / 100);
    addHistory(pnr, `ADDED MARKUP ${arg}`);
    writeLine("MARKUP ADDED. NEW TOTAL: " + pnr.fare.total.toFixed(2), "ok");
  },
  QP: (arg) => { const pnr = ensurePNR(); if (!pnr.recordLocator) return writeLine("PNR MUST BE SAVED", "err"); const qNum = arg.split('/')[0]; if (!AMX.state.queues[qNum]) return writeLine("QUEUE NOT FOUND", "err"); AMX.state.queues[qNum].pnrs.push(pnr.recordLocator); addHistory(pnr, `QUEUED TO Q${qNum}`); writeLine(`PNR PLACED ON QUEUE ${qNum}`, "ok"); },
  QT: () => { Object.entries(AMX.state.queues).forEach(([qNum, q]) => writeLine(`Q ${qNum} - ${q.name} - ${q.pnrs.length} PNRs`, "hint")); },
  QS: (arg) => { const q = AMX.state.queues[arg]; if (!q) return writeLine("QUEUE NOT FOUND", "err"); if (q.pnrs.length === 0) return writeLine(`QUEUE ${arg} IS EMPTY`, "ok"); commands.RT(q.pnrs.shift()); },

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
  HE: () => { writeLine("COMMANDS: AN, SS, NM, ER, RT, IR, IG, RH, NU, RM, XE, SP, FXP, FQN, TTP, TWX, TRF, ITR/P, PROFILE, FXA, FXK, TTP/EMD, FCM, QP, QT, QS, CS, HE", "hint"); },
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

// --- DYNAMIC ENGINE ---
function initDynamicEngine() {
    const ticker = $("ticker-content");
    if (ticker) {
        const messages = ["BA ALERT: FOG AT LHR MAY CAUSE DELAYS", "QR PROMO: 20% OFF FLIGHTS TO DOHA", "LH POLICY: NEW BAGGAGE FEES APPLY FROM 01SEP"];
        ticker.textContent = messages.join(' +++ ');
    }
    setInterval(() => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith("pnr_"));
        if (keys.length > 0) {
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            const pnr = JSON.parse(localStorage.getItem(randomKey));
            if (pnr.segments.length > 0 && pnr.segments[0].status === "HK") {
                pnr.segments[0].status = "UN";
                addHistory(pnr, "SYS: FLIGHT CANCELLED BY AIRLINE");
                localStorage.setItem(randomKey, JSON.stringify(pnr));
                writeLine(`IROPS ALERT: FLIGHT ON PNR ${pnr.recordLocator} HAS BEEN CANCELLED.`, "err");
            }
        }
    }, 60000);
}

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
        // *** PARSER FIX STARTS HERE ***
        // Find the longest matching command key to avoid ambiguity (e.g., 'APE' vs 'AP')
        const commandKeys = Object.keys(commands).sort((a, b) => b.length - a.length);
        const action = commandKeys.find(key => verb.startsWith(key));
        
        if (action) {
            const effectiveArg = s.slice(action.length).trim();
            commands[action](effectiveArg);
        } else {
            writeLine("UNKNOWN COMMAND", "err");
        }
        // *** PARSER FIX ENDS HERE ***
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
  initDynamicEngine();
  writeLine('"As you start to walk on the way, the way appears." - Rumi', "ok");
  writeLine("This isn't just a simulator. It's a dojo for your fingers, a gym for your GDS muscle memory.", "hint");
  writeLine("Type HE for help or click Scenario Training to begin.", "hint");
});
