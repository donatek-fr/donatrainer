/* ============================================================================
   DonaTrainer — plain-Node test harness (no install, no bundler)
   Run with: node tests/run.js

   Loads public/assets/js/app.js unmodified into a small vm sandbox that
   stubs just enough of document/window/localStorage for it to run outside
   a browser, then exercises the real command dispatcher (window.exec) and
   a handful of pure helper functions directly.
============================================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}

function fakeEl() {
  const el = {
    textContent: "", innerHTML: "", value: "", className: "",
    style: {}, scrollTop: 0, scrollHeight: 0,
    _children: [],
    appendChild(child) { el._children.push(child); },
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
  };
  return el;
}

function makeSandbox() {
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = fakeEl()),
    createElement: () => fakeEl(),
    addEventListener: () => {},
    body: { classList: { contains: () => false } },
  };
  const sandbox = {
    document,
    localStorage: makeLocalStorage(),
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
    fetch: async () => ({ ok: false }),
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function load(sandbox) {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "js", "app.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "app.js" });
}

function outputLines(sandbox) {
  return sandbox.document.getElementById("output")._children.map((c) => c.textContent || c.innerHTML || "");
}
function lastLine(sandbox) {
  const lines = outputLines(sandbox);
  return lines[lines.length - 1] || "";
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", msg); }
}
function approx(a, b, eps, msg) { assert(Math.abs(a - b) < eps, `${msg} (got ${a}, expected ~${b})`); }
function includesLine(sandbox, substr, msg) {
  assert(outputLines(sandbox).some((l) => l.includes(substr)), `${msg} (expected a line containing "${substr}")`);
}

const sandbox = makeSandbox();
load(sandbox);

// Seed a minimal, deterministic world so pricing/availability tests are stable.
sandbox.AMX.state.world = {
  airports: [
    { code: "DOH", city: "DOHA", name: "Hamad", country: "QA", lat: 25.2609, lon: 51.6138 },
    { code: "LHR", city: "LONDON", name: "Heathrow", country: "GB", lat: 51.4700, lon: -0.4543 },
    { code: "KWI", city: "KUWAIT CITY", name: "Kuwait Intl", country: "KW", lat: 29.2266, lon: 47.9689 },
  ],
  airlines: [{ code: "QR", name: "Qatar Airways", numeric: "157" }],
  routes: [["DOH", "LHR", "QR"], ["LHR", "DOH", "QR"], ["DOH", "KWI", "QR"], ["KWI", "DOH", "QR"]],
  countries: [{ code: "QA", name: "QATAR" }, { code: "GB", name: "UNITED KINGDOM" }],
};

// --- #11 haversine sanity ---
const dist = sandbox.haversineKm(25.2609, 51.6138, 51.4700, -0.4543);
approx(dist, 5240, 200, "DOH-LHR great-circle distance");

// --- #11 stable schedule: same AN query twice returns identical flights ---
sandbox.newPNR();
sandbox.exec("AN15DECDOHLHR");
const first = JSON.stringify(sandbox.AMX.state.availability.outbound);
sandbox.exec("AN15DECDOHLHR");
const second = JSON.stringify(sandbox.AMX.state.availability.outbound);
assert(first === second, "repeating the same AN query should return the same flight schedule");

// --- fare scales with distance & class (long-haul J costs far more than a KWI hop in K) ---
sandbox.exec("SS1J1");
sandbox.exec("NM1LONGHAUL/TEST MR");
sandbox.exec("FXP");
const longFare = sandbox.AMX.state.pnr.fare.total;
sandbox.exec("IG");
sandbox.exec("AN15DECDOHKWI");
sandbox.exec("SS1K1");
sandbox.exec("NM1SHORTHAUL/TEST MR");
sandbox.exec("FXP");
const shortFare = sandbox.AMX.state.pnr.fare.total;
assert(longFare > shortFare * 3, `long-haul J fare (${longFare}) should dwarf a short K-class hop (${shortFare})`);

// --- #1 NM group entries ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS2Y1");
sandbox.exec("NM2SMITH/JOHN MR/JANE MRS");
assert(sandbox.AMX.state.pnr.passengers.length === 2, "NM2 should add two passengers");
assert(sandbox.AMX.state.pnr.passengers[0].name === "SMITH/JOHN MR", "first passenger name/title");
assert(sandbox.AMX.state.pnr.passengers[1].name === "SMITH/JANE MRS", "second passenger name/title");

// --- #3 automated refund (TRF -> TRFU -> TRFP), plus TTP's FC/tax fields ---
sandbox.exec("AP 33-123456789");
sandbox.exec("TKOK");
sandbox.exec("RF TEST");
sandbox.exec("FXP");
sandbox.exec("FV QR");
sandbox.exec("FP CASH");
sandbox.exec("TTP");
includesLine(sandbox, "FC DOH QR LHR", "TTP output should include a fare-calculation (FC) line");
includesLine(sandbox, "FB ", "TTP output should include a fare-basis (FB) line");
sandbox.exec("TRF/L1");
includesLine(sandbox, "REFUND RECORD OPENED", "TRF should open a refund record, not process it immediately");
assert(sandbox.AMX.state.pnr.tickets[0].status !== "R", "TRF alone should not yet mark the ticket refunded");
sandbox.exec("TRFU/CP10A");
sandbox.exec("TRFP");
includesLine(sandbox, "OK - REFUND PROCESSED", "TRFP should finalize the refund");
const refundedStatus = sandbox.AMX.state.pnr.tickets[0].status;
assert(refundedStatus === "R", "TRFP should mark the ticket status R (refunded)");
sandbox.exec("TRF/L1");
includesLine(sandbox, "ALREADY REFUNDED", "TRF should refuse to open a second refund on an already-refunded ticket");

// --- #5 FQD currency conversion ---
sandbox.exec("FQDDOHLHR/CUSD");
const usdLine = outputLines(sandbox).find((l) => /USD/.test(l));
assert(!!usdLine, "FQD/CUSD should print USD-denominated fares");

// --- #7 "did you mean" suggestion on a near-miss, and no false positive on a real cryptic entry ---
sandbox.exec("TKO");
includesLine(sandbox, "DID YOU MEAN: TKOK", "a near-miss typo should suggest the real command");
const beforeLen = outputLines(sandbox).length;
sandbox.exec("AN15DECDOHLHR");
const noSpuriousSuggestion = !outputLines(sandbox).slice(beforeLen).some((l) => l.startsWith("DID YOU MEAN"));
assert(noSpuriousSuggestion, "a real (long) cryptic entry should never trigger a spurious suggestion");

// --- #10 error boundary: a throwing command should not crash the process ---
// `commands` is declared with `const`, so (like in a real browser script) it
// never becomes a sandbox property - only `function`-declared helpers do.
// Break one of those instead (haversineKm, used deep inside AN) and confirm
// dispatchCommand's try/catch reports it instead of throwing out to Node.
const origHaversine = sandbox.haversineKm;
sandbox.haversineKm = () => { throw new Error("test explosion"); };
let threw = false;
try { sandbox.exec("AN20DECDOHLHR"); } catch (e) { threw = true; }
sandbox.haversineKm = origHaversine;
assert(!threw, "a throwing command handler should be caught, not propagate");
includesLine(sandbox, "SYSTEM ERROR", "a caught command error should print a visible message");

// --- #6 progress tracking persists across a fresh TRAIN listing ---
sandbox.markScenarioComplete("The One-Way Request");
sandbox.exec("TRAIN");
includesLine(sandbox, "The One-Way Request [DONE]", "a completed scenario should show [DONE] in the TRAIN listing");

// --- SVC/FXA rename: the old ancillary shorthand must not collide with the
// real Amadeus FXA (Best Buy fare list) command any more. ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS1Y1");
sandbox.exec("NM1RENAME/TEST MR");
sandbox.exec("SVC CHECKED BAG 35");
assert(sandbox.AMX.state.pnr.ancillaries.some((a) => a.type === "SVC" && a.price === 35), "SVC should add an ancillary service");
sandbox.exec("IG");
sandbox.exec("FXA");
includesLine(sandbox, "NO SEGMENTS TO PRICE", "with no active PNR/segments, FXA should behave as the real Best Buy fare-list command, not the old ancillary shorthand");

// --- TWX void (renamed from the invented TRDC) ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS1Y1");
sandbox.exec("NM1VOIDME/TEST MR");
sandbox.exec("AP 33-123456789");
sandbox.exec("TKOK");
sandbox.exec("RF TEST");
sandbox.exec("FXP");
sandbox.exec("FV QR");
sandbox.exec("FP CASH");
sandbox.exec("TTP");
sandbox.exec("TWD");
sandbox.exec("TWX");
includesLine(sandbox, "OK-ETKT UPDATED SAC-", "TWX should print a SAC settlement code like a real void");
assert(sandbox.AMX.state.pnr.tickets[0].status === "V", "TWX should set the ticket status to V (void)");
sandbox.exec("TWX");
includesLine(sandbox, "ALREADY VOID", "TWX should refuse to void an already-void ticket");

// --- Reissue flow: SB rebook -> FXP re-price -> FO*L<n> -> TTK/T<amt> -> TTP ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS1Y1");
sandbox.exec("NM1REISSUE/TEST MR");
sandbox.exec("AP 33-123456789");
sandbox.exec("TKOK");
sandbox.exec("RF TEST");
sandbox.exec("FXP");
sandbox.exec("FV QR");
sandbox.exec("FP CASH");
sandbox.exec("TTP");
const originalTicketNumber = sandbox.AMX.state.pnr.tickets[0].number;
sandbox.exec("SBY1");
sandbox.exec("FXP");
sandbox.exec("FO*L1");
sandbox.exec("TTK/T50");
sandbox.exec("TTP");
const pnrAfterReissue = sandbox.AMX.state.pnr;
assert(pnrAfterReissue.tickets[0].status === "E", "the original ticket should flip to status E (exchanged) after a reissue");
assert(pnrAfterReissue.tickets[1] && pnrAfterReissue.tickets[1].reissueOf === originalTicketNumber, "the new ticket should record reissueOf pointing at the original ticket number");
includesLine(sandbox, "REISSUE - ADDITIONAL COLLECTION", "TTP should print the additional collection amount on a reissue");

// --- DD day-of-week (uses an explicit 4-digit year so the assertion is stable regardless of when the suite runs) ---
sandbox.exec("DD15DEC2025");
const expectedDow = ["SUN","MON","TUE","WED","THU","FRI","SAT"][new Date(Date.UTC(2025, 11, 15)).getUTCDay()];
includesLine(sandbox, expectedDow, `DD15DEC2025 should report ${expectedDow} as the day of week`);

// --- RT element filters (RTN, RTA, ...) must never shadow a real 6-character
// record locator that happens to start with the same letter. ---
const filterablePnr = sandbox.createEmptyPNR();
filterablePnr.recordLocator = "NABCDE";
filterablePnr.passengers = [{ name: "FILTERTEST/RT", type: "ADT" }];
sandbox.savePNR(filterablePnr);
sandbox.exec("IG");
sandbox.exec("RTNABCDE");
assert(sandbox.AMX.state.pnr && sandbox.AMX.state.pnr.recordLocator === "NABCDE", "a locator starting with a filter-code letter (N) must still retrieve normally, not be swallowed by the RT element-filter branch");

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
