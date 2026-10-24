import type { Bill, CashSnapshot, Kind, PaySchedule, Transaction } from "./budget.ts";
import { isRoutineSpend, isSubscriptionName, partyKey, partyName } from "./merchants.ts";

export type PayCadence = PaySchedule["cadence"];
export type BillCadence = Bill["cadence"];

export type BillHit = {
  bill: Bill;
  due: string;
  days: number;
};

export type ChargeFlag = {
  id: string;
  kind: "duplicate" | "price-jump" | "new-recurring" | "trial";
  payee: string;
  date: string;
  amountCents: number;
  detail: string;
};

export type Forecast = {
  availableCents: number | null;
  payday: string | null;
  safeToSpendCents: number | null;
  weekCents: number | null;
  monthCents: number | null;
  shortfallCents: number | null;
  shortfallScope: "payday" | "month" | null;
  warnings: BillHit[];
  upcoming: BillHit[];
};

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const WARNING_DAYS = 5;
const UPCOMING_DAYS = 60;
const FLAG_WINDOW_DAYS = 60;

export function payeeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseISODate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function addDays(iso: string, days: number): string {
  const parts = parseISODate(iso);
  if (!parts) return iso;
  const next = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${month}-${day}`;
}

export function daysBetween(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return 0;
  const utcA = Date.UTC(a.y, a.m - 1, a.d);
  const utcB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((utcB - utcA) / 86_400_000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoFromParts(year: number, month: number, day: number): string {
  const dim = daysInMonth(year, month);
  const clamped = Math.min(day, dim);
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** Due or pay dates from `from` through `until`, both inclusive. */
export function occurrences(
  cadence: PayCadence | BillCadence,
  anchor: string,
  from: string,
  until: string,
): string[] {
  if (!parseISODate(anchor) || !parseISODate(from) || !parseISODate(until) || until < from) {
    return [];
  }
  if (cadence === "weekly" || cadence === "biweekly") {
    const step = cadence === "weekly" ? 7 : 14;
    let cursor = anchor;
    if (cursor < from) {
      const jump = Math.floor(daysBetween(cursor, from) / step) * step;
      cursor = addDays(cursor, jump);
      if (cursor < from) cursor = addDays(cursor, step);
    }
    const dates: string[] = [];
    let guard = 0;
    while (cursor <= until && guard < 400) {
      dates.push(cursor);
      cursor = addDays(cursor, step);
      guard += 1;
    }
    return dates;
  }
  if (cadence === "semimonthly") {
    const dates: string[] = [];
    const start = parseISODate(from);
    const end = parseISODate(until);
    if (!start || !end) return dates;
    let year = start.y;
    let month = start.m;
    let guard = 0;
    while (guard < 48) {
      for (const day of [1, 15]) {
        const iso = isoFromParts(year, month, day);
        if (iso >= from && iso <= until) dates.push(iso);
      }
      if (isoFromParts(year, month, 15) > until) break;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      if (year > end.y + 1) break;
      guard += 1;
    }
    return dates;
  }
  const parts = parseISODate(anchor);
  if (!parts) return [];
  const step = cadence === "yearly" ? 12 : 1;
  let year = parts.y;
  let month = parts.m;
  const dates: string[] = [];
  let guard = 0;
  while (guard < 240) {
    const iso = isoFromParts(year, month, parts.d);
    if (iso > until) break;
    if (iso >= from) dates.push(iso);
    month += step;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    guard += 1;
  }
  return dates;
}

function loggedNear(
  transactions: Transaction[],
  date: string,
  match: (row: Transaction) => boolean,
  slackDays: number,
): Transaction | undefined {
  return transactions.find(
    (row) => match(row) && Math.abs(daysBetween(date, row.date)) <= slackDays,
  );
}

export function isBillPaid(bill: Bill, due: string, transactions: Transaction[]): boolean {
  const name = payeeKey(bill.name);
  if (!name) return false;
  return Boolean(
    loggedNear(
      transactions,
      due,
      (row) => row.kind === "expense" && payeeKey(row.note) === name,
      3,
    ),
  );
}

function paycheckLogged(transactions: Transaction[], date: string): boolean {
  return Boolean(
    loggedNear(
      transactions,
      date,
      (row) => row.kind === "income" && row.category === "Paycheck",
      1,
    ),
  );
}

export function nextPayday(schedule: PaySchedule | null, today: string): string | null {
  if (!schedule) return null;
  const dates = occurrences(schedule.cadence, schedule.anchor, today, addDays(today, 400));
  return dates.find((date) => date > today) ?? null;
}

function unpaidBills(
  bills: Bill[],
  transactions: Transaction[],
  from: string,
  until: string,
): BillHit[] {
  const hits: BillHit[] = [];
  for (const bill of bills) {
    for (const due of occurrences(bill.cadence, bill.anchor, from, until)) {
      if (isBillPaid(bill, due, transactions)) continue;
      hits.push({ bill, due, days: daysBetween(from, due) });
    }
  }
  return hits.sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

function expectedPayCents(
  schedule: PaySchedule | null,
  transactions: Transaction[],
  after: string,
  until: string,
): number {
  if (!schedule) return 0;
  const from = addDays(after, 1);
  if (from > until) return 0;
  return occurrences(schedule.cadence, schedule.anchor, from, until)
    .filter((date) => !paycheckLogged(transactions, date))
    .reduce((total, _date) => total + schedule.amountCents, 0);
}

function futureLoggedNet(transactions: Transaction[], after: string, until: string): number {
  let net = 0;
  for (const row of transactions) {
    if (row.date <= after || row.date > until) continue;
    if (row.kind === "income" || row.kind === "refund") net += row.amountCents;
    else if (row.kind === "expense") net -= row.amountCents;
    else if (row.kind === "transfer") {
      net += row.direction === "in" ? row.amountCents : -row.amountCents;
    }
  }
  return net;
}

function windowForecast(
  available: number,
  bills: Bill[],
  pay: PaySchedule | null,
  transactions: Transaction[],
  today: string,
  days: number,
): number {
  const until = addDays(today, days);
  const billCents = unpaidBills(bills, transactions, today, until).reduce(
    (total, hit) => total + hit.bill.amountCents,
    0,
  );
  return (
    available +
    expectedPayCents(pay, transactions, today, until) +
    futureLoggedNet(transactions, today, until) -
    billCents
  );
}

export function buildForecast(
  cash: CashSnapshot | null,
  pay: PaySchedule | null,
  bills: Bill[],
  transactions: Transaction[],
  today: string,
): Forecast {
  const upcoming = unpaidBills(bills, transactions, today, addDays(today, UPCOMING_DAYS)).filter(
    (hit, index, all) => all.findIndex((item) => item.bill.id === hit.bill.id) === index,
  );
  const warnings = upcoming.filter((hit) => hit.days >= 0 && hit.days <= WARNING_DAYS);
  const payday = nextPayday(pay, today);
  if (!cash || !Number.isInteger(cash.amountCents)) {
    return {
      availableCents: null,
      payday,
      safeToSpendCents: null,
      weekCents: null,
      monthCents: null,
      shortfallCents: null,
      shortfallScope: null,
      warnings,
      upcoming,
    };
  }
  const available = cash.amountCents;
  const weekCents = windowForecast(available, bills, pay, transactions, today, WEEK_DAYS);
  const monthCents = windowForecast(available, bills, pay, transactions, today, MONTH_DAYS);
  let safeToSpendCents: number | null = null;
  let shortfallCents: number | null = null;
  let shortfallScope: Forecast["shortfallScope"] = null;
  if (payday) {
    const before = addDays(payday, -1);
    const due = before >= today ? unpaidBills(bills, transactions, today, before) : [];
    const billCents = due.reduce((total, hit) => total + hit.bill.amountCents, 0);
    const incoming =
      available +
      expectedPayCents(pay, transactions, today, before) +
      futureLoggedNet(transactions, today, before);
    safeToSpendCents = incoming - billCents;
    if (billCents > incoming) {
      shortfallCents = billCents - incoming;
      shortfallScope = "payday";
    }
  } else {
    const until = addDays(today, MONTH_DAYS);
    const due = unpaidBills(bills, transactions, today, until);
    const billCents = due.reduce((total, hit) => total + hit.bill.amountCents, 0);
    const incoming =
      available +
      expectedPayCents(pay, transactions, today, until) +
      futureLoggedNet(transactions, today, until);
    if (billCents > incoming) {
      shortfallCents = billCents - incoming;
      shortfallScope = "month";
    }
  }
  return {
    availableCents: available,
    payday,
    safeToSpendCents,
    weekCents,
    monthCents,
    shortfallCents,
    shortfallScope,
    warnings,
    upcoming,
  };
}

function withinFlagWindow(date: string, today: string): boolean {
  const days = daysBetween(date, today);
  return days >= 0 && days <= FLAG_WINDOW_DAYS;
}

export function chargeFlags(transactions: Transaction[], today: string): ChargeFlag[] {
  const expenses = transactions.filter((row) => row.kind === "expense" && partyKey(row.note));
  const groups = new Map<string, Transaction[]>();
  for (const row of expenses) {
    const key = partyKey(row.note);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const flags: ChargeFlag[] = [];
  for (const [key, rows] of groups) {
    const ordered = [...rows].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const payee = partyName(ordered[ordered.length - 1]?.note ?? "") || key;
    const routine = isRoutineSpend(payee) || (amountsVary(ordered) && !isSubscriptionName(payee));
    const seen = new Set<string>();
    let duplicated = false;
    for (const row of ordered) {
      const dupKey = `${row.date}:${row.amountCents}`;
      if (seen.has(dupKey) && withinFlagWindow(row.date, today)) {
        duplicated = true;
        flags.push({
          id: row.id,
          kind: "duplicate",
          payee,
          date: row.date,
          amountCents: row.amountCents,
          detail: "Same amount twice on this day.",
        });
      }
      seen.add(dupKey);
    }
    const latest = ordered[ordered.length - 1];
    const previous = ordered[ordered.length - 2];
    if (
      latest &&
      /\btrial\b/i.test(latest.note) &&
      ordered.length === 1 &&
      withinFlagWindow(latest.date, today)
    ) {
      flags.push({
        id: latest.id,
        kind: "trial",
        payee,
        date: latest.date,
        amountCents: latest.amountCents,
        detail: "Trial charge.",
      });
    }
    if (!latest || !previous || !withinFlagWindow(latest.date, today) || routine) continue;
    const jumped =
      latest.amountCents > previous.amountCents &&
      (latest.amountCents - previous.amountCents >= 200 ||
        latest.amountCents * 100 >= previous.amountCents * 125);
    if (jumped) {
      flags.push({
        id: latest.id,
        kind: "price-jump",
        payee,
        date: latest.date,
        amountCents: latest.amountCents,
        detail: `Was ${(previous.amountCents / 100).toFixed(2)}, now ${(latest.amountCents / 100).toFixed(2)}.`,
      });
      continue;
    }
    const close =
      Math.abs(latest.amountCents - previous.amountCents) * 100 <= previous.amountCents * 15;
    const spaced = recurringGap(daysBetween(previous.date, latest.date));
    if (ordered.length === 2 && close && !duplicated && spaced) {
      flags.push({
        id: latest.id,
        kind: "new-recurring",
        payee,
        date: latest.date,
        amountCents: latest.amountCents,
        detail: "Second charge looks like a new subscription.",
      });
    }
  }
  const rank = { duplicate: 0, "price-jump": 1, trial: 2, "new-recurring": 3 };
  return flags.sort(
    (a, b) => b.date.localeCompare(a.date) || rank[a.kind] - rank[b.kind] || a.payee.localeCompare(b.payee),
  );
}

export function countsAsSpending(kind: Kind): boolean {
  return kind === "expense";
}

function amountsVary(rows: Transaction[]): boolean {
  if (rows.length < 3) return false;
  const amounts = rows.map((row) => row.amountCents).sort((a, b) => a - b);
  const mid = amounts[Math.floor(amounts.length / 2)] ?? 0;
  const low = amounts[0] ?? 0;
  const high = amounts[amounts.length - 1] ?? 0;
  if (mid <= 0) return false;
  return (high - low) * 100 > mid * 50;
}

function recurringGap(days: number): boolean {
  return (
    (days >= 6 && days <= 8) ||
    (days >= 13 && days <= 16) ||
    (days >= 27 && days <= 33) ||
    (days >= 350 && days <= 380)
  );
}
