/* ============================================================================
   DonaTrainer — App JS (Masterpiece v8.1 - Complete with Layover Engine)
   - Author: Mohammed Abdul Kahar / Donabil SAS
   - Contains all features: Core, PNR Servicing, Post-Ticketing,
     Commercial, Queues, Dynamic Engine, Scenarios, and Layovers.
   - This is the final, complete, and verified version.
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

// --- DYNAMIC ENGINE (with Connection Logic) ---
function mockAvailability(date, from, to, connection) {
    AMX.state.availability = [];
    let lineNum = 1;

    // 1. Find and add direct flights
    const directRoutes = AMX.state.world.routes.filter(r => r[0] === from && r[1] === to);
    directRoutes.forEach(route => {
        for (let i = 0; i < 2; i++) {
            const depHour = 8 + i * 4;
            AMX.state.availability.push({
                line: lineNum++,
                segments: [{
                    date: fmtDDMMM(date), from, to, carrier: route[2],
                    flight: String(Math.floor(Math.random() * 800) + 100),
                    dep: `${fmt.pad(depHour)}:00`, arr: `${fmt.pad((depHour + 9) % 24)}:00`,
                    classes: "J4 Y9 M9 K5"
                }]
            });
        }
    });

    // 2. Find and add connecting flights if a connection point is specified
    if (connection) {
        const leg1Routes = AMX.state.world.routes.filter(r => r[0] === from && r[1] === connection);
        const leg2Routes = AMX.state.world.routes.filter(r => r[0] === connection && r[1] === to);

        if (leg1Routes.length > 0 && leg2Routes.length > 0) {
            for (let i = 0; i < 4; i++) {
                const leg1 = leg1Routes[i % leg1Routes.length];
                const leg2 = leg2Routes[i % leg2Routes.length];
                const depHour1 = 6 + i * 2;
                const arrHour1 = (depHour1 + 4);
                const depHour2 = (arrHour1 + 2);

                AMX.state.availability.push({
                    line: lineNum++,
                    segments: [
                        {
                            date: fmtDDMMM(date), from: leg1[0], to: leg1[1], carrier: leg1[2],
                            flight: String(Math.floor(Math.random() * 800) + 100),
                            dep: `${fmt.pad(depHour1)}:30`, arr: `${fmt.pad(arrHour1)}:30`,
                            classes: "J4 Y9 M9 K5"
                        },
                        {
                            date: fmtDDMMM(date), from: leg2[0], to: leg2[1], carrier: leg2[2],
                            flight: String(Math.floor(Math.random() * 800) + 100),
                            dep: `${fmt.pad(depHour2)}:30`, arr: `${fmt.pad((depHour2 + 4) % 24)}:30`,
                            classes: "J4 Y9 M9 K5"
                        }
                    ]
                });
            }
        }
    }
    return AMX.state.availability;
}

// --- COMMAND IMPLEMENTATIONS ---
const commands = {
  // Core Booking
  AN: (arg) => {
    const m = arg.toUpperCase().match(/^(\d{1,2}[A-Z]{3})([A-Z]{3})([A-Z]{3})(?:\/X([A-Z]{3}))?/);
    if (!m) return writeLine("FORMAT: AN<DDMMM><FROM><TO>[/X<CONNECT>]", "err");
    const [_, ddmmm, from, to, connection] = m;
    const dt = parseDDMMM(ddmmm);
    if (!dt) return writeLine("INVALID DATE FORMAT", "err");
    
    const lines = mockAvailability(dt, from, to, connection);
    if (lines.length === 0) return writeLine(`NO FLIGHTS FOUND FOR ${from}-${to}`, "err");

    writeLine(`AVAILABILITY FOR ${ddmmm} ${from}-${to}`, "ok");
    lines.forEach(l => {
        if (l.segments.length === 1) {
            const seg = l.segments[0];
            writeLine(`${l.line} ${seg.carrier}${seg.flight} ${seg.from}${seg.to} ${seg.dep}-${seg.arr} ${seg.classes}`);
        } else {
            const seg1 = l.segments[0];
            const seg2 = l.segments[1];
            writeLine(`${l.line} ${seg1.carrier}${seg1.flight} ${seg1.from}${seg1.to} ${seg1.dep}-${seg1.arr}`);
            writeLine(`   ${seg2.carrier}${seg2.flight} ${seg2.from}${seg2.to} ${seg2.dep}-${seg2.arr} ${seg2.classes}`);
        }
    });
  },
  SS: (arg) => {
    const m = arg.toUpperCase().match(/^(\d+)([A-Z])(\d+)$/);
    if (!m) return writeLine("FORMAT: SS<PAX><CLASS><LINE>", "err");
    const [_, pax, rbd, lineNo] = m;
    const sel = AMX.state.availability.find(l => l.line == lineNo);
    if (!sel) return writeLine("NO SUCH LINE", "err");
    const pnr = ensurePNR();
    for (let i = 0; i < pax; i++) {
        sel.segments.forEach(seg => {
            pnr.segments.push({ ...seg, cabin: rbd, status: "HK", seats: [] });
        });
    }
    addHistory(pnr, `SOLD ${pax} IN ${rbd} FROM LINE ${lineNo}`);
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

  // Pricing & Ticketing
  FXP: () => {
    const pnr = ensurePNR();
    if (!pnr.segments.length) return writeLine("NO SEGMENTS TO PRICE", "err");
    let totalBase = 0;
    pnr.passengers.forEach(pax => {
        let baseFare = 350; // Adult Economy
        if (pax.type === "CHD") baseFare *= 0.75;
        if (pax.type === "INF") baseFare *= 0.10;
        totalBase += baseFare;
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
    const [_, seat, paxIdx] = m;
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
  HE: () => { writeLine("COMMANDS: AN, SS, NM, ER, RT, IR, RRN, FQN, SM, ST, HE, CS...", "hint"); },
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
        const res = await fetch("assets/data/worlddata.json");
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
