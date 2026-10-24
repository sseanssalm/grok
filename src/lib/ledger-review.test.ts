import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "./budget.ts";
import { billOffers, paycheckOffers } from "./inferences.ts";
import { recategorizeImported, suggestLedgerCategory } from "./merchants.ts";
import { importXMoney } from "./xmoney-import.ts";

function expense(partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "amountCents" | "note">): Transaction {
  return {
    kind: "expense",
    category: "Other",
    ...partial,
  };
}

test("merchant names map to ledger categories", () => {
  assert.equal(suggestLedgerCategory("expense", "Walmart — WALMART.COM"), "Groceries");
  assert.equal(suggestLedgerCategory("expense", "Tesla Supercharger — US"), "Transport");
  assert.equal(suggestLedgerCategory("expense", "Taco Bell — TACO BELL"), "Dining");
  assert.equal(suggestLedgerCategory("expense", "McDonald's"), "Dining");
  assert.equal(suggestLedgerCategory("expense", "Dutch Bros Coffee"), "Dining");
  assert.equal(suggestLedgerCategory("expense", "Google One"), "Fun");
  assert.equal(suggestLedgerCategory("expense", "YouTube — YouTubePremium"), "Fun");
  assert.equal(suggestLedgerCategory("expense", "Uber — trip"), "Transport");
  assert.equal(suggestLedgerCategory("income", "Deposit Check — payroll"), "Paycheck");
  assert.equal(suggestLedgerCategory("income", "Work — Payday"), "Paycheck");
  assert.equal(suggestLedgerCategory("expense", "Something new"), null);
});

test("imported Other rows can be categorized and the previous category kept for undo", () => {
  const rows = [
    expense({ id: "hand", date: "2026-10-01", amountCents: 100, note: "Walmart", category: "Other" }),
    expense({
      id: "xm:1",
      externalId: "1",
      date: "2026-10-02",
      amountCents: 200,
      note: "Walmart — store",
      category: "Other",
    }),
    expense({
      id: "xm:2",
      externalId: "2",
      date: "2026-10-03",
      amountCents: 300,
      note: "Tesla Supercharger",
      category: "Transport",
    }),
  ];
  const swept = recategorizeImported(rows, false, false);
  assert.equal(swept?.undo.length, 1);
  assert.equal(swept?.undo[0]?.id, "xm:1");
  assert.equal(swept?.transactions.find((row) => row.id === "xm:1")?.category, "Groceries");
  assert.equal(swept?.transactions.find((row) => row.id === "hand")?.category, "Other");
  assert.equal(swept?.transactions.find((row) => row.id === "xm:2")?.category, "Transport");
  assert.equal(recategorizeImported(rows, true, false), null);
});

test("deposit checks become a paycheck offer and subscriptions become bills", () => {
  const rows = [
    expense({
      id: "p1",
      kind: "income",
      date: "2026-10-09",
      amountCents: 11766,
      note: "Deposit Check",
      category: "Paycheck",
    }),
    expense({
      id: "p2",
      kind: "income",
      date: "2026-10-23",
      amountCents: 11766,
      note: "Deposit Check",
      category: "Paycheck",
    }),
    expense({ id: "g1", date: "2026-09-23", amountCents: 838, note: "Google One" }),
    expense({ id: "g2", date: "2026-10-23", amountCents: 3198, note: "Google One" }),
    expense({ id: "y1", date: "2026-09-20", amountCents: 1399, note: "YouTube Premium" }),
    expense({ id: "y2", date: "2026-10-20", amountCents: 1399, note: "YouTube Premium" }),
    expense({ id: "w1", date: "2026-09-01", amountCents: 2000, note: "Walmart" }),
    expense({ id: "w2", date: "2026-10-01", amountCents: 6400, note: "Walmart" }),
    expense({ id: "out", kind: "expense", date: "2026-10-23", amountCents: 11766, note: "Deposit Check" }),
    expense({ id: "out2", kind: "expense", date: "2026-10-09", amountCents: 11766, note: "Deposit Check" }),
  ];
  const pay = paycheckOffers(rows, null, []);
  assert.equal(pay.length, 1);
  assert.equal(pay[0]?.name, "Deposit Check");
  assert.equal(pay[0]?.amountCents, 11766);
  assert.equal(pay[0]?.cadence, "biweekly");
  assert.equal(paycheckOffers(rows, { amountCents: 11766, cadence: "biweekly", anchor: "2026-10-23" }, []).length, 0);

  const bills = billOffers(rows, [], []);
  const names = bills.map((offer) => offer.name).sort();
  assert.deepEqual(names, ["Google One", "YouTube Premium"]);
  assert.equal(bills.find((offer) => offer.name === "Google One")?.amountCents, 3198);
  assert.equal(bills.find((offer) => offer.name === "YouTube Premium")?.amountCents, 1399);
  assert.equal(billOffers(rows, [{ id: "b", name: "YouTube Premium", amountCents: 1399, cadence: "monthly", anchor: "2026-10-20" }], []).some((offer) => offer.name === "YouTube Premium"), false);
});

test("a file balance is returned and does not depend on adding rows again", () => {
  const csv = `id,date,amount,counterparty,balance
xm_1,2026-10-20,-12.00,Walmart,1500.00
xm_2,2026-10-24,-4.00,Taco Bell,820.25
`;
  const result = importXMoney(csv, []);
  assert.equal(result.added, 2);
  assert.equal(result.rows[0]?.category, "Groceries");
  assert.equal(result.rows[1]?.category, "Dining");
  assert.deepEqual(result.balance, { amountCents: 82025, asOf: "2026-10-24" });
  const again = importXMoney(csv, result.rows);
  assert.equal(again.added, 0);
  assert.equal(again.skippedDuplicates, 2);
  assert.deepEqual(again.balance, { amountCents: 82025, asOf: "2026-10-24" });
});
