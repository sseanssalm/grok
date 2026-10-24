import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel, SelectInput, TextInput } from "@/components/ui/field";
import {
  BILL_CADENCES,
  PAY_CADENCES,
  centsToInput,
  formatDay,
  formatMoney,
  parseDollars,
  todayISO,
  useBudget,
  type Bill,
  type PaySchedule,
} from "@/lib/budget";
import { buildForecast, chargeFlags, type ChargeFlag } from "@/lib/forecast";
import { billOffers, paycheckOffers } from "@/lib/inferences";
import { cn } from "@/lib/utils";

const FLAG_LABEL: Record<ChargeFlag["kind"], string> = {
  duplicate: "Duplicate",
  "price-jump": "Price jump",
  trial: "Trial",
  "new-recurring": "New subscription",
};

function cadencePhrase(cadence: string): string {
  if (cadence === "weekly") return "every week";
  if (cadence === "biweekly") return "every 2 weeks";
  if (cadence === "semimonthly") return "on the 1st and 15th";
  if (cadence === "yearly") return "every year";
  return "every month";
}

function signedMoney(cents: number): string {
  return cents < 0 ? `−${formatMoney(cents)}` : formatMoney(cents);
}

function dueLabel(days: number): string {
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function PlanPanel() {
  const transactions = useBudget((state) => state.transactions);
  const bills = useBudget((state) => state.bills);
  const pay = useBudget((state) => state.pay);
  const cash = useBudget((state) => state.cash);
  const addBill = useBudget((state) => state.addBill);
  const removeBill = useBudget((state) => state.removeBill);
  const setPay = useBudget((state) => state.setPay);
  const clearPay = useBudget((state) => state.clearPay);
  const setCash = useBudget((state) => state.setCash);
  const clearCash = useBudget((state) => state.clearCash);
  const dismissedOffers = useBudget((state) => state.dismissedOffers);
  const dismissOffer = useBudget((state) => state.dismissOffer);

  const today = todayISO();
  const forecast = useMemo(
    () => buildForecast(cash, pay, bills, transactions, today),
    [cash, pay, bills, transactions, today],
  );
  const flags = useMemo(() => chargeFlags(transactions, today), [transactions, today]);
  const paySuggestions = useMemo(
    () => paycheckOffers(transactions, pay, dismissedOffers),
    [transactions, pay, dismissedOffers],
  );
  const billSuggestions = useMemo(
    () => billOffers(transactions, bills, dismissedOffers),
    [transactions, bills, dismissedOffers],
  );
  const imported = transactions.some((row) => row.externalId || row.importKey);

  const [cashOpen, setCashOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [confirmBill, setConfirmBill] = useState<string | null>(null);
  const [flagPreference, setFlagPreference] = useState<boolean | null>(null);
  const flagsOpen = flagPreference ?? flags.length <= 3;

  const hero =
    forecast.safeToSpendCents != null
      ? { label: "Safe to spend", cents: forecast.safeToSpendCents }
      : forecast.weekCents != null
        ? { label: "Next 7 days", cents: forecast.weekCents }
        : null;

  let heroCopy = imported
    ? "The import lists transactions, not the account balance. Enter cash on hand and the forecast can use it."
    : "Enter cash on hand to forecast the next 7 days and the coming month.";
  if (forecast.safeToSpendCents != null && forecast.payday) {
    heroCopy = `Before ${formatDay(forecast.payday)}. Bills due sooner are already taken out.`;
  } else if (forecast.weekCents != null) {
    heroCopy = "Add a paycheck to see safe to spend before the next payday.";
  }

  const showWeekStat = forecast.safeToSpendCents != null && forecast.weekCents != null;
  const showMonthStat = forecast.monthCents != null && (showWeekStat || forecast.weekCents != null);

  return (
    <div className="mb-4 grid gap-4">
      <section className="rounded-3xl bg-surface p-6">
        <p className="text-sm text-muted">{hero ? hero.label : "Safe to spend"}</p>
        {hero ? (
          <p
            aria-live="polite"
            className={cn(
              "font-display text-3xl num mt-2 leading-none tracking-tight",
              hero.cents < 0 ? "text-negative" : "text-fg",
            )}
          >
            {signedMoney(hero.cents)}
          </p>
        ) : (
          <p className="mt-2 text-lg font-medium">Cash on hand is not set.</p>
        )}
        <p className="mt-3 text-sm text-muted">{heroCopy}</p>
        {!hero ? (
          <Button type="button" className="mt-4" onClick={() => setCashOpen(true)}>
            Set cash on hand
          </Button>
        ) : null}

        {forecast.shortfallCents != null && forecast.shortfallCents > 0 ? (
          <p role="alert" className="mt-4 rounded-lg bg-raised px-4 py-3 text-sm text-negative">
            {forecast.shortfallScope === "month"
              ? `Short ${formatMoney(forecast.shortfallCents)} for bills in the next 30 days.`
              : `Short ${formatMoney(forecast.shortfallCents)} before payday.`}
          </p>
        ) : null}

        {showWeekStat || (forecast.weekCents != null && forecast.safeToSpendCents == null && forecast.monthCents != null) ? (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-4">
            {showWeekStat && forecast.weekCents != null ? (
              <div>
                <dt className="text-sm text-muted">Next 7 days</dt>
                <dd className={cn("num mt-1 text-xl font-medium", forecast.weekCents < 0 && "text-negative")}>
                  {signedMoney(forecast.weekCents)}
                </dd>
              </div>
            ) : null}
            {showMonthStat && forecast.monthCents != null ? (
              <div className={showWeekStat ? undefined : "col-span-2"}>
                <dt className="text-sm text-muted">Coming month</dt>
                <dd className={cn("num mt-1 text-xl font-medium", forecast.monthCents < 0 && "text-negative")}>
                  {signedMoney(forecast.monthCents)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {paySuggestions.length > 0 || billSuggestions.length > 0 ? (
          <div className="mt-6 border-t border-border pt-4">
            <h2 className="text-lg font-medium">From your history</h2>
            <p className="mt-1 text-sm text-muted">
              Nothing here is added until you accept it. You can remove a bill or paycheck afterward.
            </p>
            <ul className="mt-2 divide-y divide-border">
              {paySuggestions.map((offer) => (
                <li key={offer.key} className="py-3">
                  <p className="font-medium">{offer.name}</p>
                  <p className="text-sm text-muted">
                    {formatMoney(offer.amountCents)} {cadencePhrase(offer.cadence)}, seen {offer.count} times.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setPay({
                          amountCents: offer.amountCents,
                          cadence: offer.cadence,
                          anchor: offer.anchor,
                        });
                        dismissOffer(offer.key);
                      }}
                    >
                      Use paycheck
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => dismissOffer(offer.key)}>
                      Not now
                    </Button>
                  </div>
                </li>
              ))}
              {billSuggestions.map((offer) => (
                <li key={offer.key} className="py-3">
                  <p className="font-medium">{offer.name}</p>
                  <p className="text-sm text-muted">
                    {formatMoney(offer.amountCents)} {cadencePhrase(offer.cadence)}, seen {offer.count} times.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        addBill({
                          name: offer.name,
                          amountCents: offer.amountCents,
                          cadence: offer.cadence,
                          anchor: offer.anchor,
                        });
                        dismissOffer(offer.key);
                      }}
                    >
                      Add bill
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => dismissOffer(offer.key)}>
                      Not now
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 border-t border-border pt-4">
          <h2 className="text-lg font-medium">Upcoming bills</h2>
          <p className="mt-1 text-sm text-muted">
            Log the payment as an expense and use the bill name as the note so it is not counted twice.
          </p>
          {forecast.upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No bills in the next 60 days.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {forecast.upcoming.map((hit) => {
                const warn = hit.days <= 5;
                return (
                  <li key={`${hit.bill.id}-${hit.due}`} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate font-medium">{hit.bill.name}</p>
                          <p className="num shrink-0 font-medium">{formatMoney(hit.bill.amountCents)}</p>
                        </div>
                        <p className={cn("text-sm", warn ? "text-negative" : "text-muted")}>
                          <time dateTime={hit.due}>{formatDay(hit.due)}</time>
                          {warn ? ` · ${dueLabel(hit.days)}` : null}
                        </p>
                      </div>
                      {confirmBill === hit.bill.id ? null : (
                        <Button type="button" variant="quiet" onClick={() => setConfirmBill(hit.bill.id)}>
                          Remove
                        </Button>
                      )}
                    </div>
                    {confirmBill === hit.bill.id ? (
                      <div className="mt-2 flex gap-2">
                        <Button type="button" variant="quiet" onClick={() => setConfirmBill(null)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => {
                            removeBill(hit.bill.id);
                            setConfirmBill(null);
                          }}
                        >
                          Confirm
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {cash || cashOpen ? (
            <Button type="button" variant="quiet" onClick={() => setCashOpen((open) => !open)}>
              {cashOpen ? "Close cash" : "Edit cash"}
            </Button>
          ) : null}
          <Button type="button" variant="quiet" onClick={() => setPayOpen((open) => !open)}>
            {payOpen ? "Close paycheck" : pay ? "Edit paycheck" : "Set paycheck"}
          </Button>
          <Button type="button" variant="quiet" onClick={() => setBillOpen((open) => !open)}>
            {billOpen ? "Close bill" : "Add a bill"}
          </Button>
        </div>

        {cashOpen ? (
          <CashForm
            amount={cash ? centsToInput(cash.amountCents) : ""}
            onSave={(amountCents) => {
              setCash({ amountCents, asOf: today });
              setCashOpen(false);
            }}
            onClear={
              cash
                ? () => {
                    clearCash();
                    setCashOpen(false);
                  }
                : undefined
            }
          />
        ) : null}
        {payOpen ? (
          <PayForm
            pay={pay}
            onSave={(next) => {
              setPay(next);
              setPayOpen(false);
            }}
            onClear={
              pay
                ? () => {
                    clearPay();
                    setPayOpen(false);
                  }
                : undefined
            }
          />
        ) : null}
        {billOpen ? (
          <BillForm
            full={bills.length >= 24}
            onSave={(input) => {
              addBill(input);
              setBillOpen(false);
            }}
          />
        ) : null}
      </section>

      {flags.length > 0 ? (
        <section className="rounded-3xl bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Check these charges</h2>
              <p className="mt-1 text-sm text-muted">
                {flags.length} {flags.length === 1 ? "item" : "items"}. Stores, charging, and restaurants with
                changing totals are left out.
              </p>
            </div>
            <Button type="button" variant="quiet" onClick={() => setFlagPreference(!flagsOpen)}>
              {flagsOpen ? "Hide" : "Show"}
            </Button>
          </div>
          {flagsOpen ? (
          <ul className="mt-2 divide-y divide-border">
            {flags.map((flag) => (
              <li key={`${flag.kind}-${flag.id}`} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate font-medium">{flag.payee}</p>
                  <p className="num shrink-0 font-medium">{formatMoney(flag.amountCents)}</p>
                </div>
                <p className="text-sm text-muted">
                  {FLAG_LABEL[flag.kind]}
                  {" · "}
                  <time dateTime={flag.date}>{formatDay(flag.date)}</time>
                </p>
                <p className="text-sm text-subtle">{flag.detail}</p>
              </li>
            ))}
          </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CashForm({
  amount,
  onSave,
  onClear,
}: {
  amount: string;
  onSave: (amountCents: number) => void;
  onClear?: () => void;
}) {
  const [value, setValue] = useState(amount);
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseDollars(value, true);
    if (cents == null) {
      setError("Enter zero or more.");
      return;
    }
    onSave(cents);
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-border pt-4">
      <div>
        <FieldLabel htmlFor="cash-amount">Cash on hand</FieldLabel>
        <TextInput
          id="cash-amount"
          inputMode="decimal"
          value={value}
          placeholder="0.00"
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
      </div>
      <p className="text-sm text-muted">
        Balance right now. Keel does not add today's entries back into this number.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Save cash</Button>
        {onClear ? (
          <Button type="button" variant="quiet" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function PayForm({
  pay,
  onSave,
  onClear,
}: {
  pay: PaySchedule | null;
  onSave: (pay: PaySchedule) => void;
  onClear?: () => void;
}) {
  const [amount, setAmount] = useState(pay ? centsToInput(pay.amountCents) : "");
  const [cadence, setCadence] = useState<PaySchedule["cadence"]>(pay?.cadence ?? "biweekly");
  const [anchor, setAnchor] = useState(pay?.anchor ?? todayISO());
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parseDollars(amount);
    if (amountCents == null || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      setError("Enter the paycheck amount and the next payday.");
      return;
    }
    onSave({ amountCents, cadence, anchor });
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-border pt-4">
      <div>
        <FieldLabel htmlFor="pay-amount">Paycheck</FieldLabel>
        <TextInput
          id="pay-amount"
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          onChange={(event) => {
            setAmount(event.target.value);
            setError("");
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="pay-cadence">Schedule</FieldLabel>
          <SelectInput
            id="pay-cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as PaySchedule["cadence"])}
          >
            {PAY_CADENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>
        <div>
          <FieldLabel htmlFor="pay-anchor">Next payday</FieldLabel>
          <TextInput
            id="pay-anchor"
            type="date"
            value={anchor}
            onChange={(event) => setAnchor(event.target.value)}
          />
        </div>
      </div>
      <p className="text-sm text-muted">
        Forecasts count this pay. A Paycheck entry within a day of the date is not counted twice.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Save paycheck</Button>
        {onClear ? (
          <Button type="button" variant="quiet" onClick={onClear}>
            Remove schedule
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function BillForm({ full, onSave }: { full: boolean; onSave: (input: Omit<Bill, "id">) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Bill["cadence"]>("monthly");
  const [anchor, setAnchor] = useState(todayISO());
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (full) {
      setError("Keel holds 24 bills.");
      return;
    }
    const amountCents = parseDollars(amount);
    const trimmed = name.trim();
    if (!trimmed || amountCents == null || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      setError("Enter a name, an amount, and the next due date.");
      return;
    }
    onSave({ name: trimmed, amountCents, cadence, anchor });
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-border pt-4">
      <div>
        <FieldLabel htmlFor="bill-name">Bill</FieldLabel>
        <TextInput
          id="bill-name"
          maxLength={60}
          placeholder="Car insurance"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="bill-amount">Amount</FieldLabel>
          <TextInput
            id="bill-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
          />
        </div>
        <div>
          <FieldLabel htmlFor="bill-cadence">Repeats</FieldLabel>
          <SelectInput
            id="bill-cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Bill["cadence"])}
          >
            {BILL_CADENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="bill-anchor">Next due date</FieldLabel>
        <TextInput
          id="bill-anchor"
          type="date"
          value={anchor}
          onChange={(event) => setAnchor(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={full}>
        Save bill
      </Button>
    </form>
  );
}
