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

// --- #3 TRF refund, plus TTP's FC/tax fields ---
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
includesLine(sandbox, "REFUND QUOTE", "TRF should print a refund quote");
const refunded = sandbox.AMX.state.pnr.tickets[0].refunded;
assert(refunded === true, "TRF should mark the ticket refunded");
sandbox.exec("TRF/L1");
includesLine(sandbox, "ALREADY REFUNDED", "TRF should refuse a second refund on the same ticket");

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

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
