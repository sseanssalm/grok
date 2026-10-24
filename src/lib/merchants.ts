import type { Kind, Transaction } from "./budget.ts";

export function partyName(note: string): string {
  const [head] = note.split(" — ");
  return (head ?? note).trim().replace(/\s+/g, " ");
}

export function partyKey(note: string): string {
  return partyName(note).toLowerCase();
}

/** Stores, charging, restaurants, and card payments whose totals normally change. */
export function isRoutineSpend(note: string): boolean {
  const text = partyKey(note);
  return [
    /\bwal[- ]?mart\b/,
    /\btarget\b/,
    /\bcostco\b/,
    /\bkroger\b/,
    /\bsafeway\b/,
    /\balbertsons?\b/,
    /\bwinco\b/,
    /\bsmiths?\b/,
    /\btrader joe/,
    /\bwhole foods\b/,
    /\baldi\b/,
    /\bdollar tree\b/,
    /\bdollar general\b/,
    /\bfamily dollar\b/,
    /\b7-?eleven\b/,
    /\bcircle k\b/,
    /\bshell\b/,
    /\bchevron\b/,
    /\bexxon\b/,
    /\bmobil\b/,
    /\bvalero\b/,
    /\barco\b/,
    /\bmaverik\b/,
    /\bsupercharger\b/,
    /\bchargepoint\b/,
    /\beVgo\b/i,
    /\belectrify\b/,
    /\btaco bell\b/,
    /\bmcdonald/,
    /\bwendy/,
    /\bburger king\b/,
    /\bchick-fil-a\b/,
    /\bchipotle\b/,
    /\bsubway\b/,
    /\bdomino/,
    /\bpizza hut\b/,
    /\bstarbucks\b/,
    /\bdutch bros\b/,
    /\bdunkin/,
    /\bdairy queen\b/,
    /\bcold stone\b/,
    /\bfat tuesday\b/,
    /\bin-?n-?out\b/,
    /\bfive guys\b/,
    /\bpanera\b/,
    /\buber\b/,
    /\blyft\b/,
    /\bdoordash\b/,
    /\bgrubhub\b/,
    /\binstacart\b/,
    /\bwalgreens\b/,
    /\bcvs\b/,
    /\bamazon\b/,
    /\bamzn\b/,
    /\bamex\b/,
    /\bamerican express\b/,
    /\bgolden gate\b/,
  ].some((pattern) => pattern.test(text));
}

export function isSubscriptionName(note: string): boolean {
  return /google one|youtube|netflix|spotify|hulu|disney|icloud|hbo|nintendo|playstation|xbox|adobe|microsoft 365|prime video/.test(
    partyKey(note),
  );
}

export function isUtilityName(note: string): boolean {
  return /energy|electric|utility|comcast|xfinity|verizon|t-mobile|at&t|century.?link|waste management/.test(
    partyKey(note),
  );
}

export function suggestExpenseCategory(note: string): string | null {
  const text = `${note}`.toLowerCase();
  if (/supercharger|chargepoint|\beVgo\b|electrify|chevron|\bshell\b|exxon|\bmobil\b|valero|\bgas\b|golden gate|\btesla\b|\buber\b|\blyft\b/i.test(text)) {
    return "Transport";
  }
  if (/wal[- ]?mart|kroger|safeway|albertson|winco|smith'?s|trader joe|whole foods|\baldi\b|costco/.test(text)) {
    return "Groceries";
  }
  if (
    /taco bell|mcdonald|wendy|burger king|chick-fil-a|chipotle|subway|domino|pizza|starbucks|dutch bros|dunkin|dairy queen|cold stone|fat tuesday|in-?n-?out|five guys|panera|grill|\bcafe\b|coffee|restaurant/.test(
      text,
    )
  ) {
    return "Dining";
  }
  if (/walgreens|\bcvs\b|pharmacy|rite aid/.test(text)) return "Health";
  if (/nv energy|energy|electric|utility|comcast|xfinity|verizon|t-mobile|at&t/.test(text)) return "Utilities";
  if (/youtube|google one|netflix|spotify|hulu|disney|icloud|hbo|nintendo|playstation|xbox/.test(text)) return "Fun";
  if (/dollar tree|dollar general|\bamazon\b|\bamzn\b|\btarget\b/.test(text)) return "Shopping";
  if (/\brent\b|mortgage|apartment/.test(text)) return "Housing";
  return null;
}

export function suggestIncomeCategory(note: string): string | null {
  if (/deposit check|payroll|direct dep|paycheck|\bpayday\b|salary|\badp\b|gusto/.test(note.toLowerCase())) return "Paycheck";
  return null;
}

export function suggestLedgerCategory(kind: Kind, note: string): string | null {
  if (kind === "income") return suggestIncomeCategory(note);
  if (kind === "expense" || kind === "refund") return suggestExpenseCategory(note);
  return null;
}

export function recategorizeImported(
  transactions: Transaction[],
  locked: boolean,
  undoPending: boolean,
): { transactions: Transaction[]; undo: { id: string; category: string }[] } | null {
  if (locked || undoPending) return null;
  const undo: { id: string; category: string }[] = [];
  let changed = false;
  const next = transactions.map((row) => {
    if ((!row.externalId && !row.importKey) || row.category !== "Other") return row;
    const category = suggestLedgerCategory(row.kind, row.note);
    if (!category || category === row.category) return row;
    undo.push({ id: row.id, category: row.category });
    changed = true;
    return { ...row, category };
  });
  if (!changed) return null;
  return { transactions: next, undo };
}
