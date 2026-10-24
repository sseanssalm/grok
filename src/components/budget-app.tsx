import { useEffect, useMemo, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel, SelectInput, TextInput } from "@/components/ui/field";
import { ImportXMoney } from "@/components/import-xmoney";
import { PlanPanel } from "@/components/plan-panel";
import {
  ENTRY_KINDS,
  KIND_LABEL,
  categoriesFor,
  centsToInput,
  currentMonth,
  formatDay,
  formatMoney,
  formatMonth,
  formatSigned,
  monthKey,
  netSpent,
  parseDollars,
  remainingEffect,
  shiftMonth,
  spendingByCategory,
  sumKind,
  todayISO,
  useBudget,
  type Kind,
  type Transaction,
  type TransferDirection,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

type Draft = {
  kind: Kind;
  amount: string;
  category: string;
  note: string;
  date: string;
  direction: TransferDirection;
};

function emptyDraft(date: string): Draft {
  return {
    kind: "expense",
    amount: "",
    category: "Groceries",
    note: "",
    date,
    direction: "out",
  };
}

function draftFromTransaction(row: Transaction): Draft {
  return {
    kind: row.kind,
    amount: centsToInput(row.amountCents),
    category: row.category,
    note: row.note,
    date: row.date,
    direction: row.direction === "in" ? "in" : "out",
  };
}

function normalizeDraft(draft: Draft): Omit<Transaction, "id"> | null {
  const amountCents = parseDollars(draft.amount);
  if (amountCents == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null;
  const options = categoriesFor(draft.kind);
  const category = options.includes(draft.category) ? draft.category : options[0];
  const note = draft.note.trim().slice(0, 80);
  const next: Omit<Transaction, "id"> = {
    kind: draft.kind,
    amountCents,
    category,
    note,
    date: draft.date,
  };
  if (draft.kind === "transfer") next.direction = draft.direction === "in" ? "in" : "out";
  return next;
}

function entryDetail(row: Transaction): string {
  if (row.kind === "transfer") {
    const way = row.direction === "in" ? "In" : "Out";
    return `${way} · ${row.category}`;
  }
  if (row.note) return row.category;
  return KIND_LABEL[row.kind];
}

export function BudgetApp() {
  useEffect(() => {
    void Promise.resolve(useBudget.persist.rehydrate());
  }, []);

  return <Ledger />;
}

function Ledger() {
  const transactions = useBudget((state) => state.transactions);
  const goal = useBudget((state) => state.goal);
  const addTransaction = useBudget((state) => state.addTransaction);
  const updateTransaction = useBudget((state) => state.updateTransaction);
  const removeTransaction = useBudget((state) => state.removeTransaction);
  const removeMonth = useBudget((state) => state.removeMonth);
  const setGoal = useBudget((state) => state.setGoal);
  const cash = useBudget((state) => state.cash);

  const [month, setMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(todayISO()));
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalName, setGoalName] = useState(goal.name);
  const [goalAmount, setGoalAmount] = useState(centsToInput(goal.targetCents));
  const [goalError, setGoalError] = useState("");

  const monthRows = useMemo(
    () => transactions.filter((row) => monthKey(row.date) === month),
    [transactions, month],
  );
  const income = sumKind(monthRows, "income");
  const spent = netSpent(monthRows);
  const remaining = income - spent;
  const slices = useMemo(() => spendingByCategory(monthRows), [monthRows]);
  const ordered = useMemo(() => {
    return monthRows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => b.row.date.localeCompare(a.row.date) || b.index - a.index)
      .map((item) => item.row);
  }, [monthRows]);

  const draftCents = parseDollars(draft.amount);
  const draftInView = monthKey(draft.date) === month;
  const projected =
    draftCents == null
      ? null
      : remaining + (draftInView ? remainingEffect(draft.kind, draftCents) : 0);

  function changeKind(kind: Kind) {
    const options = categoriesFor(kind);
    setDraft((current) => ({
      ...current,
      kind,
      category: options.includes(current.category) ? current.category : options[0],
    }));
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const next = normalizeDraft(draft);
    if (!next) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    addTransaction(next);
    setFormError("");
    setDraft((current) => ({ ...current, amount: "", note: "" }));
    setMonth(monthKey(next.date));
    setConfirmClear(false);
  }

  function saveGoal() {
    const targetCents = parseDollars(goalAmount, true);
    if (targetCents == null) {
      setGoalError("Enter a target of zero or more.");
      return;
    }
    const name = goalName.trim().slice(0, 60) || "Savings goal";
    setGoal({ name, targetCents });
    setGoalName(name);
    setGoalAmount(centsToInput(targetCents));
    setGoalError("");
    setGoalOpen(false);
  }

  const covered = Math.max(0, Math.min(remaining, goal.targetCents));
  const ratio = goal.targetCents === 0 ? 0 : covered / goal.targetCents;
  let goalCopy = "Add a target amount.";
  if (goal.targetCents > 0 && remaining <= 0) goalCopy = "Nothing left for this goal.";
  else if (goal.targetCents > 0 && remaining >= goal.targetCents) {
    goalCopy = `Covered, with ${formatMoney(remaining - goal.targetCents)} free.`;
  } else if (goal.targetCents > 0) {
    goalCopy = `${formatMoney(goal.targetCents - remaining)} short of this goal.`;
  }

  let balanceCopy = "Income minus spending this month.";
  if (income === 0 && spent === 0) balanceCopy = "No activity this month.";
  else if (remaining < 0) balanceCopy = "Spending is ahead of income.";
  else if (remaining === 0) balanceCopy = "Income and spending match.";

  const viewingNow = month === currentMonth();

  return (
    <main data-ready="true" className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">Keel</h1>
        <div className="flex items-center">
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-label="Previous month"
            onClick={() => {
              setMonth((value) => shiftMonth(value, -1));
              setConfirmClear(false);
            }}
          >
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </Button>
          <p className="w-40 text-center text-sm font-medium">{formatMonth(month)}</p>
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-label="Next month"
            onClick={() => {
              setMonth((value) => shiftMonth(value, 1));
              setConfirmClear(false);
            }}
          >
            <ChevronRight className="size-5" strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      <ImportXMoney
        onAdded={(nextMonth) => {
          setMonth(nextMonth);
          setConfirmClear(false);
        }}
      />

      {!viewingNow ? (
        <div className="mb-4">
          <Button type="button" variant="quiet" onClick={() => setMonth(currentMonth())}>
            This month
          </Button>
        </div>
      ) : (
        <PlanPanel />
      )}

      <section className="rounded-3xl bg-surface p-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <p className="text-sm text-muted">Left to spend</p>
            <p
              aria-live="polite"
              className={cn(
                "font-display num mt-2 leading-none tracking-tight",
                viewingNow && cash ? "text-3xl" : "text-hero",
                remaining < 0 ? "text-negative" : "text-fg",
              )}
            >
              {remaining < 0 ? `−${formatMoney(remaining)}` : formatMoney(remaining)}
            </p>
            <p className="mt-3 text-sm text-muted">{balanceCopy}</p>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div>
                <dt className="text-sm text-muted">Income</dt>
                <dd className="num mt-1 text-xl font-medium text-positive">+{formatMoney(income)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Spent</dt>
                <dd
                  className={cn(
                    "num mt-1 text-xl font-medium",
                    spent < 0 ? "text-positive" : "text-negative",
                  )}
                >
                  {spent < 0 ? `+${formatMoney(spent)}` : `−${formatMoney(spent)}`}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col justify-end border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted">Savings goal</p>
                <h2 className="mt-1 truncate text-lg font-medium">{goal.name}</h2>
              </div>
              <Button type="button" variant="quiet" onClick={() => setGoalOpen((open) => !open)}>
                {goalOpen ? "Close" : "Edit"}
              </Button>
            </div>
            <p className="num mt-4 text-2xl font-medium">{formatMoney(goal.targetCents)}</p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div className="bar-fill h-full w-full bg-fg" style={{ transform: `scaleX(${ratio})` }} />
            </div>
            <p className="mt-3 text-sm text-muted">
              <span className="num text-fg">{Math.round(ratio * 100)}%</span>
              <span> · {goalCopy}</span>
            </p>
            {goalOpen ? (
              <div className="mt-4 grid gap-3">
                <div>
                  <FieldLabel htmlFor="goal-name">Name</FieldLabel>
                  <TextInput
                    id="goal-name"
                    value={goalName}
                    maxLength={60}
                    onChange={(event) => setGoalName(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="goal-amount">Target</FieldLabel>
                  <TextInput
                    id="goal-amount"
                    inputMode="decimal"
                    value={goalAmount}
                    onChange={(event) => setGoalAmount(event.target.value)}
                  />
                </div>
                {goalError ? (
                  <p role="alert" className="text-sm text-negative">
                    {goalError}
                  </p>
                ) : null}
                <Button type="button" onClick={saveGoal}>
                  Save goal
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <form
          onSubmit={onCreate}
          className="min-w-0 rounded-3xl bg-surface p-6 lg:col-span-5"
        >
          <h2 className="text-lg font-medium">New entry</h2>
          <div className="mt-4">
            <KindPicker kind={draft.kind} onChange={changeKind} />
          </div>
          {draft.kind === "transfer" ? (
            <DirectionPicker
              direction={draft.direction}
              onChange={(direction) => setDraft((current) => ({ ...current, direction }))}
            />
          ) : null}
          <div className="mt-4">
            <FieldLabel htmlFor="amount">Amount</FieldLabel>
            <TextInput
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={draft.amount}
              onChange={(event) => {
                setDraft((current) => ({ ...current, amount: event.target.value }));
                setFormError("");
              }}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <SelectInput
                id="category"
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, category: event.target.value }))
                }
              >
                {categoriesFor(draft.kind).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="date">Date</FieldLabel>
              <TextInput
                id="date"
                type="date"
                value={draft.date}
                onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
              />
            </div>
          </div>
          <div className="mt-3">
            <FieldLabel htmlFor="note">Note</FieldLabel>
            <TextInput
              id="note"
              maxLength={80}
              placeholder="Optional"
              value={draft.note}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </div>
          {draft.kind === "transfer" ? (
            <p className="mt-3 text-sm text-muted">
              Out leaves this balance. In adds to it. Neither counts as spending.
            </p>
          ) : null}
          {draft.kind === "refund" ? (
            <p className="mt-3 text-sm text-muted">Refunds reduce spending in that category.</p>
          ) : null}
          {formError ? (
            <p role="alert" className="mt-3 text-sm text-negative">
              {formError}
            </p>
          ) : projected != null && draft.kind !== "transfer" ? (
            <p className="num mt-3 text-sm text-muted">
              {draftInView
                ? `Left after this: ${projected < 0 ? "−" : ""}${formatMoney(projected)}`
                : `Posts in ${formatMonth(monthKey(draft.date))}. This month stays ${remaining < 0 ? "−" : ""}${formatMoney(remaining)}.`}
            </p>
          ) : null}
          <Button type="submit" className="mt-4 w-full">
            Add {KIND_LABEL[draft.kind].toLowerCase()}
          </Button>
        </form>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:col-span-7">
          <section className="rounded-3xl bg-surface p-6">
            <h2 className="text-lg font-medium">Spending by category</h2>
            {slices.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No spending this month.</p>
            ) : (
              <SpendChart slices={slices} />
            )}
          </section>

          <section className="rounded-3xl bg-surface p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-medium">Entries</h2>
              <p className="num text-sm text-muted">{ordered.length}</p>
            </div>
            {ordered.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Nothing logged for {formatMonth(month)}.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {ordered.map((row) => {
                  const title = row.note || row.category;
                  return (
                    <li key={row.id} className="flex items-center gap-2 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate font-medium">{title}</p>
                          <p
                            className={cn(
                              "num shrink-0 text-base font-medium",
                              row.kind === "income" || row.kind === "refund" ? "text-positive" : "text-fg",
                            )}
                          >
                            {formatSigned(row.amountCents, row.kind)}
                          </p>
                        </div>
                        <p className="truncate text-sm text-muted">
                          <time dateTime={row.date}>{formatDay(row.date)}</time>
                          {" · "}
                          {entryDetail(row)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        aria-label={`Edit ${title}, ${formatSigned(row.amountCents, row.kind)}`}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil className="size-4" strokeWidth={1.75} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {ordered.length > 0 ? (
              <div className="mt-4 border-t border-border pt-4">
                {confirmClear ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted">
                      Remove {ordered.length} {ordered.length === 1 ? "entry" : "entries"} in{" "}
                      {formatMonth(month)}?
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="quiet" onClick={() => setConfirmClear(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => {
                          removeMonth(month);
                          setConfirmClear(false);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="quiet" onClick={() => setConfirmClear(true)}>
                    Clear this month
                  </Button>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <p className="mt-6 text-sm text-subtle">
        Keel never moves money. Entries stay on this device. Synced from X Money for September and
        October.
      </p>

      {editing ? (
        <EditDialog
          key={editing.id}
          row={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={(next) => {
            updateTransaction(editing.id, next);
            setMonth(monthKey(next.date));
            setEditing(null);
          }}
          onDelete={() => {
            removeTransaction(editing.id);
            setEditing(null);
          }}
        />
      ) : null}
    </main>
  );
}

type SpendRow = {
  name: string;
  cents: number;
  label: string;
  shareLabel: string;
};

type CategoryBarProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: { x?: number; y?: number; width?: number; height?: number };
  payload?: SpendRow;
};

function CategoryBar(props: unknown) {
  const { x = 0, y = 0, width = 0, height = 0, background, payload } = props as CategoryBarProps;
  const bandX = background?.x ?? x;
  const bandW = background?.width ?? width;
  const barH = 4;
  const barY = y + height - barH - 4;
  return (
    <g>
      <text
        x={bandX}
        y={y + 16}
        fill="var(--color-muted)"
        fontSize="13"
        fontFamily="IBM Plex Sans, sans-serif"
      >
        {payload?.name}
      </text>
      <text
        x={bandX + bandW}
        y={y + 16}
        textAnchor="end"
        fill="var(--color-fg)"
        fontSize="13"
        fontFamily="IBM Plex Sans, sans-serif"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {payload?.label}
      </text>
      <rect x={bandX} y={barY} width={Math.max(bandW, 0)} height={barH} rx={2} fill="var(--color-raised)" />
      <rect x={x} y={barY} width={Math.max(width, 2)} height={barH} rx={2} fill="var(--color-fg)" />
    </g>
  );
}

function SpendChart({ slices }: { slices: ReturnType<typeof spendingByCategory> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const height = slices.length * 52;
  const data: SpendRow[] = slices.map((slice) => ({
    name: slice.name,
    cents: slice.cents / 100,
    label: formatMoney(slice.cents),
    shareLabel: `${Math.round(slice.share * 100)}%`,
  }));

  return (
    <>
      <div className="mt-2 w-full min-w-0" style={{ height }}>
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={8}>
              <XAxis type="number" hide domain={[0, "dataMax"]} />
              <YAxis type="category" dataKey="name" hide width={0} />
              <Tooltip cursor={{ fill: "transparent" }} wrapperStyle={{ outline: "none" }} content={<SpendTip />} />
              <Bar
                dataKey="cents"
                shape={CategoryBar}
                background={{ fill: "transparent" }}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <ul className="sr-only">
        {slices.map((slice) => (
          <li key={slice.name}>
            {slice.name}: {formatMoney(slice.cents)}, {Math.round(slice.share * 100)}% of spending
          </li>
        ))}
      </ul>
    </>
  );
}

function KindPicker({ kind, onChange }: { kind: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-lg bg-raised p-1"
      role="radiogroup"
      aria-label="Entry type"
    >
      {ENTRY_KINDS.map((option) => {
        const selected = kind === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "h-11 rounded-md text-sm font-medium",
              selected ? "bg-fg text-bg" : "text-muted hover:text-fg",
            )}
            onClick={() => onChange(option)}
          >
            {KIND_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

function DirectionPicker({
  direction,
  onChange,
}: {
  direction: TransferDirection;
  onChange: (direction: TransferDirection) => void;
}) {
  const options: { value: TransferDirection; label: string }[] = [
    { value: "out", label: "Out" },
    { value: "in", label: "In" },
  ];
  return (
    <div
      className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-raised p-1"
      role="radiogroup"
      aria-label="Transfer direction"
    >
      {options.map((option) => {
        const selected = direction === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "h-11 rounded-md text-sm font-medium",
              selected ? "bg-fg text-bg" : "text-muted hover:text-fg",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SpendTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SpendRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row?.name) return null;
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2 text-sm">
      <p className="text-muted">{row.name}</p>
      <p className="num font-medium">
        {row.label} · {row.shareLabel}
      </p>
    </div>
  );
}

function EditDialog({
  row,
  onOpenChange,
  onSave,
  onDelete,
}: {
  row: Transaction;
  onOpenChange: (open: boolean) => void;
  onSave: (next: Omit<Transaction, "id">) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromTransaction(row));
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  function changeKind(kind: Kind) {
    const options = categoriesFor(kind);
    setDraft((current) => ({
      ...current,
      kind,
      category: options.includes(current.category) ? current.category : options[0],
    }));
    setConfirming(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = normalizeDraft(draft);
    if (!next) {
      setError("Enter an amount greater than zero.");
      return;
    }
    onSave(next);
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <Dialog.Content className="dialog-panel fixed inset-x-4 top-4 z-50 mx-auto w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-medium">Edit entry</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="quiet" size="icon" aria-label="Close">
                <X className="size-4" strokeWidth={1.75} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Update the amount, category, or date. Deleting removes it from the balance.
          </Dialog.Description>
          <form onSubmit={onSubmit} className="mt-4">
            <KindPicker kind={draft.kind} onChange={changeKind} />
            {draft.kind === "transfer" ? (
              <DirectionPicker
                direction={draft.direction}
                onChange={(direction) => {
                  setDraft((current) => ({ ...current, direction }));
                  setConfirming(false);
                }}
              />
            ) : null}
            <div className="mt-4">
              <FieldLabel htmlFor="edit-amount">Amount</FieldLabel>
              <TextInput
                id="edit-amount"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, amount: event.target.value }));
                  setError("");
                  setConfirming(false);
                }}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="edit-category">Category</FieldLabel>
                <SelectInput
                  id="edit-category"
                  value={draft.category}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, category: event.target.value }));
                    setConfirming(false);
                  }}
                >
                  {categoriesFor(draft.kind).map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <FieldLabel htmlFor="edit-date">Date</FieldLabel>
                <TextInput
                  id="edit-date"
                  type="date"
                  value={draft.date}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, date: event.target.value }));
                    setConfirming(false);
                  }}
                />
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel htmlFor="edit-note">Note</FieldLabel>
              <TextInput
                id="edit-note"
                maxLength={80}
                value={draft.note}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, note: event.target.value }));
                  setConfirming(false);
                }}
              />
            </div>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-negative">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  if (!confirming) {
                    setConfirming(true);
                    return;
                  }
                  onDelete();
                }}
              >
                {confirming ? "Confirm delete" : "Delete"}
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
