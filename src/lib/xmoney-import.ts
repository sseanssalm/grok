import type { Kind, Transaction, TransferDirection } from "./budget.ts";
import { parseISODate } from "./forecast.ts";

export const XMONEY_IMPORT_MAX_CHARS = 1_000_000;
export const XMONEY_IMPORT_MAX_ROWS = 5_000;

export type ImportResult = {
  error?: string;
  rows: Transaction[];
  added: number;
  skippedDuplicates: number;
  skippedInvalid: number;
};

type RawRow = {
  id?: string;
  date?: string;
  amount?: unknown;
  direction?: string;
  counterparty?: string;
  note?: string;
  type?: string;
};

const HEADER_TO_FIELD: Record<string, keyof RawRow> = {
  id: "id",
  transaction_id: "id",
  transactionid: "id",
  date: "date",
  amount: "amount",
  direction: "direction",
  sign: "direction",
  counterparty: "counterparty",
  payee: "counterparty",
  note: "note",
  description: "note",
  memo: "note",
  type: "type",
  kind: "type",
};

export function importXMoney(text: string, existing: readonly Transaction[]): ImportResult {
  const empty = { rows: [], added: 0, skippedDuplicates: 0, skippedInvalid: 0 };
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return { ...empty, error: "This file is empty." };
  if (source.length > XMONEY_IMPORT_MAX_CHARS) {
    return { ...empty, error: "Keel imports files up to 1 MB." };
  }
  const parsed = parseDocument(source);
  if (parsed.error) return { ...empty, error: parsed.error };
  const records = parsed.rows ?? [];
  if (records.length > XMONEY_IMPORT_MAX_ROWS) {
    return { ...empty, error: "Keel imports up to 5000 rows at a time." };
  }

  const externalIds = new Set(
    existing.flatMap((row) => (row.externalId ? [row.externalId] : [])),
  );
  const importKeys = new Set(existing.flatMap((row) => (row.importKey ? [row.importKey] : [])));
  const fallbackSeen = new Set(
    existing.map((row) => fallbackKey(row.date, row.amountCents, partyOf(row.note))),
  );

  const rows: Transaction[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const record of records) {
    const built = toTransaction(record);
    if (!built) {
      skippedInvalid += 1;
      continue;
    }
    if (built.externalId) {
      if (externalIds.has(built.externalId)) {
        skippedDuplicates += 1;
        continue;
      }
      externalIds.add(built.externalId);
      fallbackSeen.add(fallbackKey(built.date, built.amountCents, partyOf(built.note)));
      rows.push(built);
      continue;
    }
    const key = built.importKey ?? "";
    if (importKeys.has(key) || fallbackSeen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    importKeys.add(key);
    fallbackSeen.add(key);
    rows.push(built);
  }

  return { rows, added: rows.length, skippedDuplicates, skippedInvalid };
}

function parseDocument(source: string): { rows?: RawRow[]; error?: string } {
  const trimmed = source.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJson(trimmed);
  return parseCsv(source);
}

function parseJson(source: string): { rows?: RawRow[]; error?: string } {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { error: "This JSON could not be read. Use a transactions array in the X Money format." };
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { transactions?: unknown }).transactions)
      ? (value as { transactions: unknown[] }).transactions
      : null;
  if (!list) {
    return { error: "This JSON needs a transactions array, or it should be an array itself." };
  }
  const rows: RawRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      rows.push({});
      continue;
    }
    rows.push(rawFromRecord(item as Record<string, unknown>));
  }
  return { rows };
}

function rawFromRecord(record: Record<string, unknown>): RawRow {
  const raw: RawRow = {};
  for (const [key, value] of Object.entries(record)) {
    const field = HEADER_TO_FIELD[key.trim().toLowerCase()];
    if (!field || raw[field] !== undefined) continue;
    if (field === "amount") {
      raw.amount = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && field === "id") {
      raw.id = String(value);
      continue;
    }
    if (typeof value === "string") raw[field] = value;
  }
  return raw;
}

function parseCsv(source: string): { rows?: RawRow[]; error?: string } {
  const table = parseCsvTable(source);
  if (!table) return { error: "This CSV has an unfinished quoted field." };
  if (table.length === 0) return { error: "This file is empty." };
  const headers = table[0].map((cell) => cell.trim().toLowerCase());
  const columns = new Map<keyof RawRow, number>();
  headers.forEach((header, index) => {
    const field = HEADER_TO_FIELD[header];
    if (field && !columns.has(field)) columns.set(field, index);
  });
  if (!columns.has("date") || !columns.has("amount")) {
    return { error: "This CSV needs a header row with date and amount." };
  }
  const rows: RawRow[] = [];
  for (const cells of table.slice(1)) {
    const read = (field: keyof RawRow) => {
      const index = columns.get(field);
      if (index == null) return "";
      return cells[index] ?? "";
    };
    rows.push({
      id: read("id"),
      date: read("date"),
      amount: read("amount"),
      direction: read("direction"),
      counterparty: read("counterparty"),
      note: read("note"),
      type: read("type"),
    });
  }
  return { rows };
}

function parseCsvTable(source: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (inQuotes) return null;
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function toTransaction(raw: RawRow): Transaction | null {
  const date = raw.date?.trim() ?? "";
  if (!parseISODate(date)) return null;
  const amount = parseAmount(raw.amount);
  if (!amount) return null;
  const externalId = readExternalId(raw.id);
  if (externalId === null) return null;
  const direction = readDirection(raw.direction);
  if (direction === null) return null;
  const kind = resolveKind(raw.type, direction, amount.negative);
  if (!kind) return null;
  const counterparty = cleanText(raw.counterparty ?? "");
  const description = cleanText(raw.note ?? "");
  const party = counterparty || description;
  const note = buildNote(counterparty, description);
  const transferDirection: TransferDirection | undefined =
    kind === "transfer" ? (direction ?? (amount.negative ? "out" : "in")) : undefined;
  const row: Transaction = {
    id: externalId ? stableId(externalId) : fallbackId(date, amount.cents, party),
    kind,
    amountCents: amount.cents,
    category: categoryFor(kind, `${counterparty} ${description}`),
    note,
    date,
    ...(transferDirection ? { direction: transferDirection } : {}),
    ...(externalId ? { externalId } : { importKey: fallbackKey(date, amount.cents, party) }),
  };
  return row;
}

function resolveKind(
  type: string | undefined,
  direction: TransferDirection | undefined,
  negative: boolean,
): Kind | null {
  const named = type?.trim().toLowerCase() ?? "";
  if (named) {
    if (named === "expense" || named === "income" || named === "transfer" || named === "refund") {
      return named;
    }
    return null;
  }
  if (direction === "out" || (!direction && negative)) return "expense";
  if (direction === "in" || !negative) return "income";
  return null;
}

function categoryFor(kind: Kind, text: string): string {
  if (kind === "income") return "Other";
  if (kind !== "transfer") return "Other";
  return /\b(cash|atm)\b/i.test(text) ? "Cash to another account" : "Between my accounts";
}

function buildNote(counterparty: string, description: string): string {
  if (counterparty && description && counterparty.toLowerCase() !== description.toLowerCase()) {
    return `${counterparty} — ${description}`.slice(0, 80);
  }
  return (counterparty || description).slice(0, 80);
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function partyOf(note: string): string {
  const [head] = note.split(" — ");
  return normalizeParty(head ?? "");
}

function normalizeParty(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function fallbackKey(date: string, amountCents: number, counterparty: string): string {
  return `${date}|${amountCents}|${normalizeParty(counterparty).slice(0, 80)}`;
}

function readExternalId(value: string | undefined): string | null | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 128 || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function readDirection(value: string | undefined): TransferDirection | null | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "in" || trimmed === "out") return trimmed;
  return null;
}

function parseAmount(value: unknown): { cents: number; negative: boolean } | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return null;
    const cents = Math.round(Math.abs(value) * 100);
    if (!Number.isInteger(cents) || cents <= 0 || cents > 99_999_999_99) return null;
    const scaled = Math.abs(value) * 100;
    if (Math.abs(scaled - cents) > 0.001) return null;
    return { cents, negative: value < 0 };
  }
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[$,\s]/g, "");
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("+")) text = text.slice(1);
  else if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (cents <= 0 || cents > 99_999_999_99) return null;
  return { cents, negative };
}

function stableId(externalId: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/.test(externalId)) return `xm:${externalId}`;
  return `xm:${hashId(externalId)}`;
}

function fallbackId(date: string, cents: number, party: string): string {
  const slug = normalizeParty(party)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `xmf:${date}:${cents}:${slug}:${hashId(fallbackKey(date, cents, party))}`;
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
