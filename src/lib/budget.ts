import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { XMONEY_REVISION, XMONEY_TRANSACTIONS } from "@/lib/xmoney-sync";

export type Kind = "income" | "expense" | "transfer" | "refund";

export type TransferDirection = "out" | "in";

export type Transaction = {
  id: string;
  kind: Kind;
  amountCents: number;
  category: string;
  note: string;
  date: string;
  direction?: TransferDirection;
};

export type PaySchedule = {
  amountCents: number;
  cadence: "weekly" | "biweekly" | "monthly" | "semimonthly";
  anchor: string;
};

export type Bill = {
  id: string;
  name: string;
  amountCents: number;
  cadence: "weekly" | "monthly" | "yearly";
  anchor: string;
};

export type CashSnapshot = {
  amountCents: number;
  asOf: string;
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

export const TRANSFER_CATEGORIES = ["Between my accounts", "Cash to another account"] as const;

export const ENTRY_KINDS = ["expense", "income", "refund", "transfer"] as const;

export const KIND_LABEL: Record<Kind, string> = {
  expense: "Expense",
  income: "Income",
  refund: "Refund",
  transfer: "Transfer",
};

export const PAY_CADENCES = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "1st and 15th" },
  { value: "monthly", label: "Monthly" },
] as const;

export const BILL_CADENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

export function categoriesFor(kind: Kind): readonly string[] {
  if (kind === "income") return INCOME_CATEGORIES;
  if (kind === "transfer") return TRANSFER_CATEGORIES;
  return EXPENSE_CATEGORIES;
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
  if (kind === "expense") return `−${body}`;
  if (kind === "transfer") return body;
  return `+${body}`;
}

/** How an entry changes the month's remaining cash. Transfers stay out of that figure. */
export function remainingEffect(kind: Kind, cents: number): number {
  if (kind === "income" || kind === "refund") return cents;
  if (kind === "expense") return -cents;
  return 0;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isISODate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const row = value as Transaction;
  const kindOk =
    row.kind === "income" ||
    row.kind === "expense" ||
    row.kind === "refund" ||
    row.kind === "transfer";
  const directionOk = row.direction === undefined || row.direction === "in" || row.direction === "out";
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    kindOk &&
    directionOk &&
    Number.isInteger(row.amountCents) &&
    row.amountCents > 0 &&
    row.amountCents <= 99_999_999_99 &&
    typeof row.category === "string" &&
    row.category.length > 0 &&
    row.category.length <= 40 &&
    typeof row.note === "string" &&
    row.note.length <= 80 &&
    isISODate(row.date)
  );
}

function isBill(value: unknown): value is Bill {
  if (!value || typeof value !== "object") return false;
  const bill = value as Bill;
  return (
    typeof bill.id === "string" &&
    bill.id.length > 0 &&
    bill.id.length <= 80 &&
    typeof bill.name === "string" &&
    bill.name.trim().length > 0 &&
    bill.name.length <= 60 &&
    Number.isInteger(bill.amountCents) &&
    bill.amountCents > 0 &&
    bill.amountCents <= 99_999_999_99 &&
    (bill.cadence === "weekly" || bill.cadence === "monthly" || bill.cadence === "yearly") &&
    isISODate(bill.anchor)
  );
}

function isPay(value: unknown): value is PaySchedule {
  if (!value || typeof value !== "object") return false;
  const pay = value as PaySchedule;
  return (
    Number.isInteger(pay.amountCents) &&
    pay.amountCents > 0 &&
    pay.amountCents <= 99_999_999_99 &&
    (pay.cadence === "weekly" ||
      pay.cadence === "biweekly" ||
      pay.cadence === "monthly" ||
      pay.cadence === "semimonthly") &&
    isISODate(pay.anchor)
  );
}

function isCash(value: unknown): value is CashSnapshot {
  if (!value || typeof value !== "object") return false;
  const cash = value as CashSnapshot;
  return (
    Number.isInteger(cash.amountCents) &&
    cash.amountCents >= 0 &&
    cash.amountCents <= 99_999_999_99 &&
    isISODate(cash.asOf)
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

const BILL_LIMIT = 24;

type BudgetState = {
  transactions: Transaction[];
  goal: Goal;
  bills: Bill[];
  pay: PaySchedule | null;
  cash: CashSnapshot | null;
  addTransaction: (input: Omit<Transaction, "id">) => void;
  updateTransaction: (id: string, input: Omit<Transaction, "id">) => void;
  removeTransaction: (id: string) => void;
  removeMonth: (month: string) => void;
  setGoal: (goal: Goal) => void;
  addBill: (input: Omit<Bill, "id">) => void;
  removeBill: (id: string) => void;
  setPay: (pay: PaySchedule) => void;
  clearPay: () => void;
  setCash: (cash: CashSnapshot) => void;
  clearCash: () => void;
  xmoneyRevision: number;
};

export const useBudget = create<BudgetState>()(
  persist(
    (set) => ({
      transactions: XMONEY_TRANSACTIONS,
      goal: SEED_GOAL,
      bills: [],
      pay: null,
      cash: null,
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
      addBill: (input) =>
        set((state) => {
          if (state.bills.length >= BILL_LIMIT) return state;
          const name = input.name.trim().slice(0, 60);
          if (!name) return state;
          return { bills: [...state.bills, { ...input, name, id: newId() }] };
        }),
      removeBill: (id) =>
        set((state) => ({ bills: state.bills.filter((bill) => bill.id !== id) })),
      setPay: (pay) => set({ pay }),
      clearPay: () => set({ pay: null }),
      setCash: (cash) => set({ cash }),
      clearCash: () => set({ cash: null }),
    }),
    {
      name: "keel-budget",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        transactions: state.transactions,
        goal: state.goal,
        bills: state.bills,
        pay: state.pay,
        cash: state.cash,
        xmoneyRevision: state.xmoneyRevision,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<BudgetState, "transactions" | "goal" | "bills" | "pay" | "cash" | "xmoneyRevision">
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
        const bills = Array.isArray(saved.bills)
          ? saved.bills.filter(isBill).slice(0, BILL_LIMIT)
          : current.bills;
        return {
          ...current,
          transactions,
          xmoneyRevision,
          goal: isGoal(saved.goal) ? saved.goal : current.goal,
          bills,
          pay: saved.pay == null ? null : isPay(saved.pay) ? saved.pay : current.pay,
          cash: saved.cash == null ? null : isCash(saved.cash) ? saved.cash : current.cash,
        };
      },
    },
  ),
);

export function netSpent(rows: Transaction[]): number {
  return sumKind(rows, "expense") - sumKind(rows, "refund");
}

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
    if (row.kind === "expense") {
      totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountCents);
    } else if (row.kind === "refund") {
      totals.set(row.category, (totals.get(row.category) ?? 0) - row.amountCents);
    }
  }
  for (const [name, cents] of totals) {
    if (cents <= 0) totals.delete(name);
  }
  const spent = [...totals.values()].reduce((total, cents) => total + cents, 0);
  return [...totals.entries()]
    .map(([name, cents]) => ({ name, cents, share: spent === 0 ? 0 : cents / spent }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}
