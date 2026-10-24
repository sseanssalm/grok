import type { Bill, PaySchedule, Transaction } from "./budget.ts";
import { daysBetween } from "./forecast.ts";
import { isRoutineSpend, isSubscriptionName, isUtilityName, partyKey, partyName } from "./merchants.ts";

export type PayOffer = {
  key: string;
  name: string;
  amountCents: number;
  cadence: PaySchedule["cadence"];
  anchor: string;
  count: number;
};

export type BillOffer = {
  key: string;
  name: string;
  amountCents: number;
  cadence: Bill["cadence"];
  anchor: string;
  count: number;
};

const PAYROLL = /deposit check|payroll|direct dep|paycheck|\bpayday\b|salary|\badp\b|gusto/;

export function paycheckOffers(
  transactions: Transaction[],
  pay: PaySchedule | null,
  dismissed: readonly string[],
): PayOffer[] {
  if (pay) return [];
  const groups = groupByParty(transactions.filter((row) => row.kind === "income"));
  const offers: PayOffer[] = [];
  for (const [key, rows] of groups) {
    if (dismissed.includes(`pay:${key}`)) continue;
    const name = displayName(rows);
    const cluster = tightCluster(rows, 10);
    const minimum = PAYROLL.test(name.toLowerCase()) ? 2 : 3;
    if (cluster.length < minimum) continue;
    const cadence = cadenceFromDates(
      cluster.map((row) => row.date),
      ["weekly", "biweekly", "monthly"],
    );
    if (!cadence) continue;
    const latest = [...cluster].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (!latest) continue;
    offers.push({
      key: `pay:${key}`,
      name,
      amountCents: median(cluster.map((row) => row.amountCents)),
      cadence,
      anchor: latest.date,
      count: cluster.length,
    });
  }
  return offers.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 2);
}

export function billOffers(
  transactions: Transaction[],
  bills: readonly Bill[],
  dismissed: readonly string[],
): BillOffer[] {
  const taken = new Set(bills.map((bill) => partyKey(bill.name)));
  const groups = groupByParty(transactions.filter((row) => row.kind === "expense"));
  const offers: BillOffer[] = [];
  for (const [key, rows] of groups) {
    if (!key || dismissed.includes(`bill:${key}`) || taken.has(key) || isRoutineSpend(key)) continue;
    if (PAYROLL.test(key)) continue;
    const name = displayName(rows);
    const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const subscription = isSubscriptionName(name) || isUtilityName(name);
    const cluster = tightCluster(ordered, 15);
    const source = cluster.length >= 2 ? cluster : subscription ? ordered : [];
    if (source.length < 2) continue;
    const cadence = cadenceFromDates(
      source.map((row) => row.date),
      ["weekly", "biweekly", "monthly", "yearly"],
    );
    if (!cadence) continue;
    const latest = source[source.length - 1] ?? ordered[ordered.length - 1];
    if (!latest) continue;
    const amountCents = subscription && cluster.length < 2 ? latest.amountCents : median(source.map((row) => row.amountCents));
    offers.push({
      key: `bill:${key}`,
      name: name.slice(0, 60),
      amountCents,
      cadence,
      anchor: latest.date,
      count: source.length,
    });
  }
  return offers.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
}

function groupByParty(rows: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const row of rows) {
    const key = partyKey(row.note);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

function displayName(rows: Transaction[]): string {
  const latest = [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return partyName(latest?.note ?? "");
}

function tightCluster(rows: Transaction[], tolerancePercent: number): Transaction[] {
  let best: Transaction[] = [];
  for (const pivot of rows) {
    const group = rows.filter(
      (row) => Math.abs(row.amountCents - pivot.amountCents) * 100 <= pivot.amountCents * tolerancePercent,
    );
    if (group.length > best.length) best = group;
  }
  return best;
}

function cadenceFromDates<T extends "weekly" | "biweekly" | "monthly" | "yearly">(
  dates: string[],
  allowed: readonly T[],
): T | null {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length < 2) return null;
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push(daysBetween(sorted[index - 1] ?? "", sorted[index] ?? ""));
  }
  const mid = median(gaps);
  const cadence =
    mid >= 6 && mid <= 8
      ? "weekly"
      : mid >= 13 && mid <= 16
        ? "biweekly"
        : mid >= 27 && mid <= 33
          ? "monthly"
          : mid >= 350 && mid <= 380
            ? "yearly"
            : null;
  if (!cadence || !allowed.includes(cadence as T)) return null;
  return cadence as T;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  return sorted[mid] ?? 0;
}
