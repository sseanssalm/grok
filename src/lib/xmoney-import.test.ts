import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "./budget.ts";
import { countsAsSpending } from "./forecast.ts";
import { importXMoney } from "./xmoney-import.ts";

const csv = `id,date,amount,direction,counterparty,note,type
xm_cafe,2026-10-24,-12.00,out,Cafe,Lunch,expense
xm_pay,2026-10-30,2000.00,in,Work,Payday,income
xm_move,2026-10-24,50.00,out,Checking,Move,transfer
xm_back,2026-10-22,5.00,in,Market,Return,refund
`;

function manual(partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "amountCents">): Transaction {
  return {
    kind: "expense",
    category: "Groceries",
    note: "Market",
    ...partial,
  };
}

test("csv maps expenses, income, transfers, and refunds", () => {
  const result = importXMoney(csv, []);
  assert.equal(result.error, undefined);
  assert.equal(result.added, 4);
  assert.equal(result.skippedDuplicates, 0);
  const byId = Object.fromEntries(result.rows.map((row) => [row.externalId, row]));
  assert.equal(byId.xm_cafe.kind, "expense");
  assert.equal(byId.xm_cafe.amountCents, 1200);
  assert.equal(byId.xm_cafe.note, "Cafe — Lunch");
  assert.equal(byId.xm_cafe.id, "xm:xm_cafe");
  assert.equal(countsAsSpending(byId.xm_cafe.kind), true);
  assert.equal(byId.xm_pay.kind, "income");
  assert.equal(byId.xm_pay.category, "Paycheck");
  assert.equal(byId.xm_cafe.category, "Dining");
  assert.equal(byId.xm_pay.amountCents, 200000);
  assert.equal(byId.xm_move.kind, "transfer");
  assert.equal(byId.xm_move.direction, "out");
  assert.equal(byId.xm_move.category, "Between my accounts");
  assert.equal(countsAsSpending(byId.xm_move.kind), false);
  assert.equal(byId.xm_back.kind, "refund");
  assert.equal(byId.xm_back.amountCents, 500);
  assert.equal(byId.xm_back.direction, undefined);
});

test("json array and description alias import the same way", () => {
  const json = JSON.stringify([
    {
      transactionId: "atm-1",
      date: "2026-10-24",
      amount: -40,
      direction: "out",
      payee: "ATM",
      description: "Cash",
      kind: "transfer",
    },
  ]);
  const result = importXMoney(json, []);
  assert.equal(result.added, 1);
  const row = result.rows[0];
  assert.equal(row?.kind, "transfer");
  assert.equal(row?.direction, "out");
  assert.equal(row?.category, "Cash to another account");
  assert.equal(row?.externalId, "atm-1");
  assert.equal(row?.note, "ATM — Cash");
});

test("reimporting the same or an overlapping file adds nothing already stored", () => {
  const first = importXMoney(csv, []);
  const again = importXMoney(csv, first.rows);
  assert.equal(again.added, 0);
  assert.equal(again.skippedDuplicates, 4);
  assert.deepEqual(again.rows, []);
  const overlap = `id,date,amount,direction,counterparty,note,type
xm_cafe,2026-10-24,-99.00,out,Cafe,Changed,expense
xm_new,2026-11-01,-8.00,out,News,Box,expense
`;
  const second = importXMoney(overlap, first.rows);
  assert.equal(second.added, 1);
  assert.equal(second.skippedDuplicates, 1);
  assert.equal(second.rows[0]?.externalId, "xm_new");
  assert.equal(second.rows[0]?.amountCents, 800);
  assert.equal(first.rows.find((row) => row.externalId === "xm_cafe")?.amountCents, 1200);
});

test("a row with no id uses date, amount, and counterparty", () => {
  const file = `date,amount,counterparty
2026-10-24,18.00,Car insurance
2026-10-24,18.00,Car insurance
2026-10-24,18.00,Phone
`;
  const first = importXMoney(file, []);
  assert.equal(first.added, 2);
  assert.equal(first.skippedDuplicates, 1);
  assert.ok(first.rows.every((row) => row.importKey && !row.externalId));
  const manualRow = manual({
    id: "hand",
    date: "2026-10-25",
    amountCents: 900,
    note: "Pharmacy",
  });
  const follow = `date,amount,counterparty,note
2026-10-24,18.00,Car insurance,October
2026-10-25,9.00,Pharmacy,Rx
2026-10-25,9.00,Bookstore,Novel
`;
  const second = importXMoney(follow, [...first.rows, manualRow]);
  assert.equal(second.added, 1);
  assert.equal(second.skippedDuplicates, 2);
  assert.equal(second.rows[0]?.note.startsWith("Bookstore"), true);
  assert.equal(manualRow.amountCents, 900);
  assert.equal(manualRow.note, "Pharmacy");
});

test("an id does not overwrite a hand-entered row", () => {
  const hand = manual({ id: "hand", date: "2026-10-24", amountCents: 1200, note: "Cafe" });
  const file = `id,date,amount,counterparty,type
xm_cafe,2026-10-24,12.00,Cafe,expense
`;
  const result = importXMoney(file, [hand]);
  assert.equal(result.added, 1);
  assert.equal(result.rows[0]?.externalId, "xm_cafe");
  assert.equal(hand.id, "hand");
  assert.equal(hand.note, "Cafe");
});

test("direction wins when the sign disagrees, and type wins over both", () => {
  const file = `id,date,amount,direction,counterparty,type
a,2026-10-01,15.00,out,Store,
b,2026-10-02,-15.00,in,Store,income
c,2026-10-03,-4.00,,Store,refund
`;
  const result = importXMoney(file, []);
  assert.equal(result.added, 3);
  assert.equal(result.rows[0]?.kind, "expense");
  assert.equal(result.rows[1]?.kind, "income");
  assert.equal(result.rows[1]?.amountCents, 1500);
  assert.equal(result.rows[2]?.kind, "refund");
  assert.equal(result.rows[2]?.amountCents, 400);
});

test("quoted commas, invalid rows, and a missing header", () => {
  const file = `id,date,amount,counterparty
"smith, 1",2026-10-24,"$1,234.50","Smith, Pat"
bad,2026-02-31,10.00,Nope
zero,2026-10-24,0.00,Zero
`;
  const result = importXMoney(file, []);
  assert.equal(result.added, 1);
  assert.equal(result.skippedInvalid, 2);
  assert.equal(result.rows[0]?.note, "Smith, Pat");
  assert.equal(result.rows[0]?.amountCents, 123450);
  const broken = importXMoney("hello,world\n1,2\n", []);
  assert.equal(broken.error, "This CSV needs a header row with date and amount.");
  assert.equal(broken.added, 0);
});

test("a transactions object is accepted and a non-array object is not", () => {
  const wrapped = importXMoney(
    JSON.stringify({
      transactions: [{ id: "xm_1", date: "2026-10-24", amount: "-9.99", counterparty: "Stream" }],
    }),
    [],
  );
  assert.equal(wrapped.added, 1);
  assert.equal(wrapped.rows[0]?.kind, "expense");
  const wrong = importXMoney(JSON.stringify({ rows: [] }), []);
  assert.match(wrong.error ?? "", /transactions array/);
});
