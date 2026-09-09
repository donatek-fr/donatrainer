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
    { code: "SIN", city: "SINGAPORE", name: "Changi", country: "SG", lat: 1.3644, lon: 103.9915 },
  ],
  airlines: [{ code: "QR", name: "Qatar Airways", numeric: "157" }, { code: "BA", name: "British Airways", numeric: "125" }],
  routes: [["DOH", "LHR", "QR"], ["LHR", "DOH", "QR"], ["DOH", "KWI", "QR"], ["KWI", "DOH", "QR"], ["KWI", "SIN", "QR"], ["SIN", "KWI", "QR"], ["KWI", "SIN", "BA"]],
  countries: [{ code: "QA", name: "QATAR" }, { code: "GB", name: "UNITED KINGDOM" }, { code: "KW", name: "KUWAIT" }, { code: "SG", name: "SINGAPORE" }],
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

// --- GAP-04: YTH no longer requires a title, matching the manual's own NM1JONES/TOM(YTH) example ---
sandbox.exec("IG");
sandbox.exec("NM1JONES/TOM(YTH)");
assert(sandbox.AMX.state.pnr.passengers[0].name === "JONES/TOM", "YTH should parse with no title, name should be JONES/TOM");
assert(sandbox.AMX.state.pnr.passengers[0].type === "YTH", "YTH passenger type should be recorded");

// --- GAP-02: codeshare - buildLeg should only set operatingCarrier when it differs from the marketing carrier ---
const codeshareDate = sandbox.parseDDMMM("15DEC");
const csLeg = sandbox.buildLeg(codeshareDate, "DOH", "LHR", "QR", "BA");
assert(csLeg.operatingCarrier === "BA", "buildLeg should record a different operating carrier as a codeshare");
const nonCsLeg = sandbox.buildLeg(codeshareDate, "DOH", "LHR", "QR", "QR");
assert(!nonCsLeg.operatingCarrier, "buildLeg should not flag a codeshare when operating carrier equals the marketing carrier");

// --- GAP-05: married segments - cancelling one leg of a connection cancels both ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHSIN");
includesLine(sandbox, "CONNECTION VIA KWI", "DOH-SIN should be offered as a one-stop connection via KWI in the test world");
sandbox.exec("SS1Y1");
assert(sandbox.AMX.state.pnr.segments.length === 2, "selling a connection should push both married legs onto the PNR");
assert(sandbox.AMX.state.pnr.segments[0].marriedGroup && sandbox.AMX.state.pnr.segments[0].marriedGroup === sandbox.AMX.state.pnr.segments[1].marriedGroup, "both legs of a connection should share the same marriedGroup id");
sandbox.exec("XE1");
assert(sandbox.AMX.state.pnr.segments.length === 0, "cancelling one married segment should cascade-cancel its linked leg too");
includesLine(sandbox, "MARRIED SEGMENT", "XE should explain that linked married segments were cancelled together");

// --- GAP-06: EMD lifecycle for ancillary services ---
sandbox.exec("IG");
sandbox.exec("SVC EXTRA BAG 45");
const svcAncillary = sandbox.AMX.state.pnr.ancillaries[0];
assert(!!svcAncillary.emdNumber, "SVC should issue an EMD number");
assert(svcAncillary.status === "O", "a freshly issued EMD should be status O");
assert(sandbox.ancillaryTotal(sandbox.AMX.state.pnr) === 45, "an open EMD should count toward the ancillary total");
sandbox.exec("EMDV/L1");
assert(sandbox.AMX.state.pnr.ancillaries[0].status === "V", "EMDV should void the EMD");
assert(sandbox.ancillaryTotal(sandbox.AMX.state.pnr) === 0, "a voided EMD should drop out of the ancillary total");

// --- GAP-07: private/corporate (UNI) fare discount via /R,U ---
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS1Y1");
sandbox.exec("NM1PUBLICFARE/TEST MR");
sandbox.exec("FXP");
const publicFareBase = sandbox.AMX.state.pnr.fare.base;
sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
sandbox.exec("SS1Y1");
sandbox.exec("NM1UNIFARE/TEST MR");
sandbox.exec("FXP/R,U");
const uniFareBase = sandbox.AMX.state.pnr.fare.base;
assert(sandbox.AMX.state.pnr.fare.uniFare === true, "FXP/R,U should flag the fare as a UNI (private/corporate) fare");
approx(uniFareBase / publicFareBase, 0.85, 0.01, "a /R,U fare should price at ~85% of the equivalent public fare");

// --- GAP-08: Company profiles are their own record, distinct from a traveler draft ---
sandbox.exec("IG");
sandbox.exec("PCC/DONABIL SAS");
sandbox.exec("PIN/CORP1");
sandbox.exec("PER");
assert(sandbox.AMX.state.profiles["CORP1"].isCompany === true, "PCC/ should save a profile flagged isCompany");
assert(sandbox.AMX.state.profiles["CORP1"].companyName === "DONABIL SAS", "the company profile should retain its name");

// --- GAP-09: fares vary by travel-month seasonality ---
approx(sandbox.seasonalMultiplier("15DEC"), 1.18, 0.001, "December should price at the peak-season multiplier");
approx(sandbox.seasonalMultiplier("15JAN"), 0.92, 0.001, "January should price at the off-peak multiplier");

// --- GAP-10: currency rates drift slightly (and deterministically) by date instead of being static ---
const rateA = sandbox.dailyRate("USD", "15JAN2025");
const rateASame = sandbox.dailyRate("USD", "15JAN2025");
const rateB = sandbox.dailyRate("USD", "16JAN2025");
assert(rateA === rateASame, "dailyRate should be deterministic for a repeated date");
assert(rateA !== rateB, "dailyRate should drift across different dates");
assert(Math.abs(rateA - rateB) / rateA < 0.05, "dailyRate's day-to-day drift should stay small");

// --- ES / ESD / ESX must not collide when an office id starts with D or X
// (e.g. DOHQR2900) - ESD/ESX are folded into the ES handler for exactly this reason. ---
sandbox.exec("IG");
sandbox.exec("ESDOHQR2900-N");
assert(sandbox.AMX.state.pnr.security.some(s => s.office === "DOHQR2900" && s.mode === "N"), "an office id starting with D must still be parsed as an add, not swallowed by the ESD display shorthand");
sandbox.exec("ESXAB1234-B");
assert(sandbox.AMX.state.pnr.security.some(s => s.office === "XAB1234" && s.mode === "B"), "an office id starting with X must still be parsed as an add, not swallowed by the ESX cancel shorthand");
sandbox.exec("ESD");
includesLine(sandbox, "DOHQR2900", "bare ESD should still display the security elements added above");

// --- GAP-11: PNR security is enforced, not just stored ---
sandbox.exec("IG");
const securedPnr = sandbox.createEmptyPNR();
securedPnr.recordLocator = "SECRT1";
securedPnr.passengers = [{ name: "BLOCKED/TEST", type: "ADT" }];
securedPnr.security = [{ office: sandbox.AMX.state.office, mode: "N" }];
sandbox.savePNR(securedPnr);
sandbox.exec("RTSECRT1");
includesLine(sandbox, "NOT AUTHORIZED", "RT should refuse a PNR with an N security entry for the signed-in office");
assert(!sandbox.AMX.state.pnr || sandbox.AMX.state.pnr.recordLocator !== "SECRT1", "a security-blocked PNR should never become the active PNR");

// --- GAP-12: simulated TIMATIC-style travel information ---
sandbox.exec("TIFVGBQA");
includesLine(sandbox, "VISA", "TIFV should print visa information");

// --- HE topic list is grouped by category, not one flat wall of text ---
sandbox.exec("HE");
includesLine(sandbox, "PNR & BOOKING:", "bare HE should group topics under category headers");

// --- Real-Amadeus-format pass: codeshare colon notation, multi-routing connections, header line ---
assert(sandbox.legToken(csLeg) === `QR:BA${csLeg.operatingFlight}`, "a codeshare leg should print as <MARKETING>:<OPERATING><FLIGHT>, not a marketing flight number plus an asterisk");
assert(sandbox.legToken(nonCsLeg) === `QR ${nonCsLeg.flight}`, "a non-codeshare leg should print as <CARRIER> <FLIGHT> with a space, matching the real display");

sandbox.exec("IG");
sandbox.exec("AN15DECDOHSIN");
const dohSinLines = sandbox.AMX.state.availability.outbound;
assert(dohSinLines.length >= 2, "DOH-SIN has two distinct KWI connection routings (QR and BA on the second leg) in the test world and should surface both as separate lines");
includesLine(sandbox, "CONNECTION VIA KWI", "DOH-SIN should still be offered as a one-stop connection via KWI");

sandbox.exec("IG");
sandbox.exec("AN15DECDOHLHR");
includesLine(sandbox, "HEATHROW.GB", "the availability header should name the destination airport and country, not just repeat the code");
const headerLine = outputLines(sandbox).find(l => l.includes("AMADEUS AVAILABILITY"));
assert(!!headerLine && /\b(SU|MO|TU|WE|TH|FR|SA)\b/.test(headerLine), "the availability header should include a two-letter day-of-week code");

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
