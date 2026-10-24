import assert from "node:assert/strict";
import test from "node:test";
import type { Bill, PaySchedule, Transaction } from "./budget.ts";
import {
  addDays,
  buildForecast,
  chargeFlags,
  daysBetween,
  isBillPaid,
  nextPayday,
  occurrences,
} from "./forecast.ts";

const TODAY = "2026-10-24";

function tx(partial: Omit<Transaction, "id"> & { id?: string }): Transaction {
  return {
    id: partial.id ?? `${partial.kind}-${partial.date}-${partial.amountCents}-${partial.note}`,
    kind: partial.kind,
    amountCents: partial.amountCents,
    category: partial.category,
    note: partial.note,
    date: partial.date,
    direction: partial.direction,
  };
}

test("weekly and biweekly dates step from the anchor", () => {
  assert.deepEqual(occurrences("weekly", "2026-10-01", "2026-10-24", "2026-11-06"), [
    "2026-10-29",
    "2026-11-05",
  ]);
  assert.deepEqual(occurrences("biweekly", "2026-10-02", TODAY, "2026-11-15"), [
    "2026-10-30",
    "2026-11-13",
  ]);
});

test("monthly clamps short months and semimonthly uses the 1st and 15th", () => {
  assert.deepEqual(occurrences("monthly", "2026-01-31", "2026-02-01", "2026-03-31"), [
    "2026-02-28",
    "2026-03-31",
  ]);
  assert.deepEqual(occurrences("semimonthly", "2026-10-03", TODAY, "2026-11-16"), [
    "2026-11-01",
    "2026-11-15",
  ]);
});

test("next payday is the first date after today", () => {
  const pay: PaySchedule = { amountCents: 200000, cadence: "biweekly", anchor: "2026-10-16" };
  assert.equal(nextPayday(pay, TODAY), "2026-10-30");
  assert.equal(nextPayday(pay, "2026-10-30"), "2026-11-13");
});

test("a logged note marks that bill paid", () => {
  const bill: Bill = {
    id: "ins",
    name: "Car insurance",
    amountCents: 18000,
    cadence: "monthly",
    anchor: "2026-10-28",
  };
  const paid = [tx({ kind: "expense", amountCents: 18000, category: "Transport", note: "Car insurance", date: "2026-10-27" })];
  assert.equal(isBillPaid(bill, "2026-10-28", paid), true);
  assert.equal(isBillPaid(bill, "2026-10-28", []), false);
});

test("safe to spend subtracts bills due before payday and ignores transfers", () => {
  const pay: PaySchedule = { amountCents: 200000, cadence: "biweekly", anchor: "2026-10-30" };
  const rent: Bill = {
    id: "rent",
    name: "Rent",
    amountCents: 150000,
    cadence: "monthly",
    anchor: "2026-10-28",
  };
  const later: Bill = {
    id: "phone",
    name: "Phone",
    amountCents: 8000,
    cadence: "monthly",
    anchor: "2026-11-04",
  };
  const forecast = buildForecast(
    { amountCents: 220000, asOf: TODAY },
    pay,
    [rent, later],
    [
      tx({
        kind: "transfer",
        amountCents: 5000,
        category: "Cash to another account",
        note: "ATM",
        date: TODAY,
        direction: "out",
      }),
    ],
    TODAY,
  );
  assert.equal(forecast.payday, "2026-10-30");
  assert.equal(forecast.safeToSpendCents, 70000);
  assert.equal(forecast.shortfallCents, null);
  assert.equal(forecast.warnings.some((hit) => hit.bill.id === "rent"), true);
  assert.equal(daysBetween(TODAY, "2026-10-28"), 4);
});

test("shortfall is the dollar gap when bills beat cash and pay", () => {
  const pay: PaySchedule = { amountCents: 100000, cadence: "monthly", anchor: "2026-11-15" };
  const insurance: Bill = {
    id: "ins",
    name: "Car insurance",
    amountCents: 180000,
    cadence: "yearly",
    anchor: "2026-10-28",
  };
  const forecast = buildForecast({ amountCents: 40000, asOf: TODAY }, pay, [insurance], [], TODAY);
  assert.equal(forecast.safeToSpendCents, -140000);
  assert.equal(forecast.shortfallCents, 140000);
  assert.equal(forecast.shortfallScope, "payday");
});

test("seven-day and month forecasts count a paycheck inside the window", () => {
  const pay: PaySchedule = { amountCents: 200000, cadence: "biweekly", anchor: "2026-10-30" };
  const forecast = buildForecast({ amountCents: 50000, asOf: TODAY }, pay, [], [], TODAY);
  assert.equal(forecast.weekCents, 250000);
  // Oct 30 and Nov 13 both fall inside the 30-day window.
  assert.equal(forecast.monthCents, 450000);
});

test("a logged paycheck is not counted twice", () => {
  const pay: PaySchedule = { amountCents: 200000, cadence: "biweekly", anchor: "2026-10-30" };
  const forecast = buildForecast(
    { amountCents: 50000, asOf: TODAY },
    pay,
    [],
    [tx({ kind: "income", amountCents: 200000, category: "Paycheck", note: "Work", date: "2026-10-30" })],
    TODAY,
  );
  assert.equal(forecast.weekCents, 250000);
});

test("flags only duplicates, price jumps, new repeats, and trials", () => {
  const rows = [
    tx({ id: "a", kind: "expense", amountCents: 999, category: "Fun", note: "Stream", date: "2026-09-01" }),
    tx({ id: "b", kind: "expense", amountCents: 3198, category: "Fun", note: "Stream", date: "2026-10-01" }),
    tx({ id: "c1", kind: "expense", amountCents: 1200, category: "Dining", note: "Cafe", date: "2026-10-20" }),
    tx({ id: "c2", kind: "expense", amountCents: 1200, category: "Dining", note: "Cafe", date: "2026-10-20" }),
    tx({ id: "n1", kind: "expense", amountCents: 1500, category: "Fun", note: "News box", date: "2026-09-20" }),
    tx({ id: "n2", kind: "expense", amountCents: 1500, category: "Fun", note: "News box", date: "2026-10-20" }),
    tx({ id: "t", kind: "expense", amountCents: 100, category: "Fun", note: "Photo trial", date: "2026-10-22" }),
    tx({ id: "old", kind: "expense", amountCents: 400, category: "Fun", note: "Old twice", date: "2026-01-01" }),
    tx({ id: "old2", kind: "expense", amountCents: 400, category: "Fun", note: "Old twice", date: "2026-02-01" }),
    tx({
      id: "steady",
      kind: "expense",
      amountCents: 999,
      category: "Fun",
      note: "Steady",
      date: "2026-08-01",
    }),
    tx({ id: "steady2", kind: "expense", amountCents: 999, category: "Fun", note: "Steady", date: "2026-09-01" }),
    tx({ id: "steady3", kind: "expense", amountCents: 999, category: "Fun", note: "Steady", date: "2026-10-01" }),
  ];
  const flags = chargeFlags(rows, TODAY);
  const byKind = (kind: string) => flags.filter((flag) => flag.kind === kind).map((flag) => flag.id);
  assert.deepEqual(byKind("price-jump"), ["b"]);
  assert.deepEqual(byKind("duplicate"), ["c2"]);
  assert.deepEqual(byKind("new-recurring"), ["n2"]);
  assert.deepEqual(byKind("trial"), ["t"]);
  assert.equal(flags.some((flag) => flag.payee === "Steady" || flag.payee === "Old twice"), false);
});

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-10-24", 30), "2026-11-23");
});
