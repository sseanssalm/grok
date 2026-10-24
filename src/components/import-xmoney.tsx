import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney, monthKey, useBudget } from "@/lib/budget";
import { importXMoney } from "@/lib/xmoney-import";

export function ImportXMoney({ onAdded }: { onAdded: (month: string) => void }) {
  const transactions = useBudget((state) => state.transactions);
  const addTransactions = useBudget((state) => state.addTransactions);
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  async function onFile(file: File) {
    if (file.size > 1_000_000) {
      setError("Keel imports files up to 1 MB.");
      setSummary("");
      return;
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      setError("This file could not be read.");
      setSummary("");
      return;
    }
    const result = importXMoney(text, transactions);
    if (result.error) {
      setError(result.error);
      setSummary("");
      return;
    }
    addTransactions(result.rows);
    let balanceNote = "";
    if (result.balance) {
      if (useBudget.getState().cash) {
        balanceNote = ` File balance ${formatMoney(result.balance.amountCents)} was not applied.`;
      } else {
        useBudget.getState().setCashFromImport(result.balance);
        balanceNote = ` Set cash on hand to ${formatMoney(result.balance.amountCents)}.`;
      }
    }
    setError("");
    const duplicateLabel = result.skippedDuplicates === 1 ? "duplicate" : "duplicates";
    const invalid =
      result.skippedInvalid > 0
        ? ` ${result.skippedInvalid} ${result.skippedInvalid === 1 ? "row" : "rows"} could not be read.`
        : "";
    setSummary(`Added ${result.added}. Skipped ${result.skippedDuplicates} ${duplicateLabel}.${invalid}${balanceNote}`);
    const newest = result.rows.reduce((latest, row) => (row.date > latest ? row.date : latest), "");
    if (newest) onAdded(monthKey(newest));
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" variant="quiet" onClick={() => inputRef.current?.click()}>
          Import from X Money
        </Button>
        <p className="text-sm text-muted">Adds new rows only. Nothing is deleted or moved.</p>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-negative">
          {error}
        </p>
      ) : null}
      {summary ? (
        <p aria-live="polite" className="mt-2 text-sm text-fg">
          {summary}
        </p>
      ) : null}
      <input
        ref={inputRef}
        id="xmoney-file"
        className="sr-only"
        type="file"
        accept=".csv,.json,text/csv,text/plain,application/json"
        aria-label="X Money file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </div>
  );
}
