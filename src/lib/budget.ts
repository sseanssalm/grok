import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { XMONEY_REVISION, XMONEY_TRANSACTIONS } from "@/lib/xmoney-sync";

export type Kind = "income" | "expense";

export type Transaction = {
  id: string;
  kind: Kind;
  amountCents: number;
  category: string;
  note: string;
  date: string;
};

export type Goal = {
  name: string;
  targetCents: number;
};

export const EXPENSE_CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Health",
  "Fun",
  "Shopping",
  "Other",
] as const;

export const INCOME_CATEGORIES = ["Paycheck", "Freelance", "Refund", "Other"] as const;

export function categoriesFor(kind: Kind): readonly string[] {
  return kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(cents: number): string {
  return money.format(Math.abs(cents) / 100);
}

export function formatSigned(cents: number, kind: Kind): string {
  const body = formatMoney(cents);
  return kind === "expense" ? `−${body}` : `+${body}`;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseDollars(raw: string, allowZero = false): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isInteger(cents)) return null;
  if (cents < 0 || cents > 99_999_999_99) return null;
  if (!allowZero && cents === 0) return null;
  return cents;
}

export function todayISO(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function currentMonth(now = new Date()): string {
  return monthKey(todayISO(now));
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const SEED_GOAL: Goal = { name: "Emergency cushion", targetCents: 400000 };

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const row = value as Transaction;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    (row.kind === "income" || row.kind === "expense") &&
    Number.isInteger(row.amountCents) &&
    row.amountCents > 0 &&
    row.amountCents <= 99_999_999_99 &&
    typeof row.category === "string" &&
    row.category.length > 0 &&
    row.category.length <= 40 &&
    typeof row.note === "string" &&
    row.note.length <= 80 &&
    typeof row.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.date)
  );
}

function isGoal(value: unknown): value is Goal {
  if (!value || typeof value !== "object") return false;
  const goal = value as Goal;
  return (
    typeof goal.name === "string" &&
    goal.name.length <= 60 &&
    Number.isInteger(goal.targetCents) &&
    goal.targetCents >= 0 &&
    goal.targetCents <= 99_999_999_99
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type BudgetState = {
  transactions: Transaction[];
  goal: Goal;
  addTransaction: (input: Omit<Transaction, "id">) => void;
  updateTransaction: (id: string, input: Omit<Transaction, "id">) => void;
  removeTransaction: (id: string) => void;
  removeMonth: (month: string) => void;
  setGoal: (goal: Goal) => void;
  xmoneyRevision: number;
};

export const useBudget = create<BudgetState>()(
  persist(
    (set) => ({
      transactions: XMONEY_TRANSACTIONS,
      goal: SEED_GOAL,
      xmoneyRevision: XMONEY_REVISION,
      addTransaction: (input) =>
        set((state) => ({ transactions: [...state.transactions, { ...input, id: newId() }] })),
      updateTransaction: (id, input) =>
        set((state) => ({
          transactions: state.transactions.map((row) => (row.id === id ? { ...input, id } : row)),
        })),
      removeTransaction: (id) =>
        set((state) => ({ transactions: state.transactions.filter((row) => row.id !== id) })),
      removeMonth: (month) =>
        set((state) => ({
          transactions: state.transactions.filter((row) => monthKey(row.date) !== month),
        })),
      setGoal: (goal) => set({ goal }),
    }),
    {
      name: "keel-budget",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        transactions: state.transactions,
        goal: state.goal,
        xmoneyRevision: state.xmoneyRevision,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<BudgetState, "transactions" | "goal" | "xmoneyRevision">
        >;
        let transactions = current.transactions;
        if (Array.isArray(saved.transactions)) {
          const clean = saved.transactions.filter(isTransaction);
          if (saved.transactions.length === 0 || clean.length > 0) transactions = clean;
        }
        transactions = transactions.filter((row) => !row.id.startsWith("seed-"));
        let xmoneyRevision = typeof saved.xmoneyRevision === "number" ? saved.xmoneyRevision : 0;
        if (xmoneyRevision !== XMONEY_REVISION) {
          const ids = new Set(transactions.map((row) => row.id));
          transactions = [
            ...transactions,
            ...XMONEY_TRANSACTIONS.filter((row) => !ids.has(row.id)),
          ];
          xmoneyRevision = XMONEY_REVISION;
        }
        return {
          ...current,
          transactions,
          xmoneyRevision,
          goal: isGoal(saved.goal) ? saved.goal : current.goal,
        };
      },
    },
  ),
);

export function sumKind(rows: Transaction[], kind: Kind): number {
  return rows.reduce((total, row) => (row.kind === kind ? total + row.amountCents : total), 0);
}

export type CategorySlice = {
  name: string;
  cents: number;
  share: number;
};

export function spendingByCategory(rows: Transaction[]): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "expense") continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountCents);
  }
  const spent = [...totals.values()].reduce((total, cents) => total + cents, 0);
  return [...totals.entries()]
    .map(([name, cents]) => ({ name, cents, share: spent === 0 ? 0 : cents / spent }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}
