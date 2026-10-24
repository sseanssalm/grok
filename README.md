# Keel

Keel is a personal financing ledger. It keeps a month of income, spending, refunds, and transfers, and compares what is left with a savings goal. On the current month it also forecasts safe-to-spend from cash on hand, a paycheck schedule, and bills you enter by hand (rent, car insurance, and the rest). A warning appears five days before each bill. If incoming money will not cover those bills, Keel shows the dollar gap. Transfers between your own accounts, including cash moved to fund another account, stay out of spending. Refunds reduce spending in the original category. Charge notes can flag a new repeat, a trial, a price jump, or a same-day duplicate. Keel never moves money, and it does not connect to X Money. Transactions from X Money come in through a file import. Everything stays on the device — the website uses browser storage, and the Android app uses the same storage inside its WebView. There is no account and no server API. Encrypting that on-device storage was skipped: there are no bank credentials to protect, and a key stored next to the data would not be real protection.

## Import from X Money

Keel cannot sign in to X Money. Export the transactions elsewhere, save a UTF-8 CSV or JSON file in the format below, then choose **Import from X Money** in Keel. On Android that button opens the system file picker. The import only adds rows. It does not edit, delete, or replace manual entries or earlier imports, and it does not move money. Afterward Keel shows how many rows were added and how many were skipped as duplicates.

Limits: 1 MB and 5,000 data rows. Amounts are decimal dollars (not cents). Dates are `YYYY-MM-DD`. A row with a bad date, an unreadable amount, an unknown `type`, or an unknown `direction` is skipped and counted as unreadable. The rest of the file still imports.

### Identity

- When `id` is present, that X Money transaction id is the identity. Importing the same id again — in the same file or a later overlapping file — adds nothing and does not change the row already in Keel, even if the amount or note differs.
- When `id` is blank, the identity is `date` + amount in cents + counterparty (lowercase, extra space collapsed). The description is used only if counterparty is blank. A hand-entered note that equals that counterparty, or an earlier import of the same triple, counts as the same row and is skipped.
- An `id` is never merged into a hand-entered row. Include ids whenever X Money has them so a later file cannot repeat those transactions, and so a hand-entered line is left untouched.

### Fields

CSV header, in this order:

```csv
id,date,amount,direction,counterparty,note,type
```

JSON is either a bare array or `{ "transactions": [ ... ] }` with the same field names. These alternate names are accepted for the same fields: `transaction_id` or `transactionId`; `sign` for direction; `payee` for counterparty; `description` or `memo` for note; `kind` for type.

| Field | Required | Values |
| --- | --- | --- |
| `id` | No | X Money transaction id, up to 128 characters. |
| `date` | Yes | `YYYY-MM-DD`. |
| `amount` | Yes | Decimal dollars. A leading `-`, or parentheses, marks money out. `$` and thousands commas are allowed. Zero is rejected. |
| `direction` | No | `in` or `out`. If it disagrees with the sign, direction wins. |
| `counterparty` | No | Payee or account name, shown on the row. Up to 80 characters. |
| `note` | No | Description. When both this and counterparty are set, the entry note is `counterparty — note`. |
| `type` | No | `expense`, `income`, `transfer`, or `refund`. When set, this wins over direction and sign. When omitted, `out` or a negative amount is an expense and anything else is income. |

`transfer` is stored as a transfer, so it is not spending. `out` leaves this balance and `in` adds to it. If direction is omitted, a negative amount is `out` and a positive amount is `in`. Counterparty or note text that contains “cash” or “ATM” uses the category **Cash to another account**; other transfers use **Between my accounts**. `refund` is stored as a refund and reduces spending. Imported income and expenses use the category **Other** (a paycheck is not assumed). Categories can be edited afterward; the X Money id stays on the row.

```csv
id,date,amount,direction,counterparty,note,type
xm_cafe,2026-10-24,-12.00,out,Cafe,Lunch,expense
xm_move,2026-10-24,50.00,out,Checking,Move,transfer
xm_back,2026-10-22,5.00,in,Market,Return,refund
```

```json
{
  "transactions": [
    {
      "id": "xm_cafe",
      "date": "2026-10-24",
      "amount": "-12.00",
      "direction": "out",
      "counterparty": "Cafe",
      "note": "Lunch",
      "type": "expense"
    }
  ]
}
```

## Web app

The site is a [TanStack Start](https://tanstack.com/start) app (React, Vite, Nitro) aimed at Vercel.

```sh
npm install
npm run dev
```

The dev server listens on port **8080**.

```sh
npm run build    # production web build (Vercel / Nitro)
npm run typecheck
```

No API keys are required. Auth is off (`VITE_AUTH_ENABLED` is `false` in `.grok/app-env.json`). `DATABASE_URL` is not used; `npm run build` skips migrations when it is unset. The optional X Money seed list in `src/lib/xmoney-sync.ts` is empty in this repository. X Money transactions enter through the file import above, not through that list.

## Android app

The Android app is the same ledger in a [Capacitor](https://capacitorjs.com/) 8 WebView.

| | |
| --- | --- |
| App name | Keel |
| Application id | `com.sseanssalm.keel` |
| Min / target SDK | 24 / 36 |

`npm run build` stays the server build for the website. A phone cannot host that server, and the ledger does not need it, so Android uses a separate static bundle of `BudgetApp`:

- `vite.android.config.ts` writes `dist/android`
- `npm run android:sync` copies that bundle into the native project

Entry for the website: `src/routes/index.tsx`. Entry for Android: `android-shell/main.tsx` (same `BudgetApp` component).

### Build a debug APK

You need Node.js 22, JDK 21 (17 or newer also works), and the Android SDK with platform **36** and build-tools **36**. Point the SDK at Gradle with `ANDROID_HOME` or a gitignored `android/local.properties`:

```
sdk.dir=/path/to/Android/Sdk
```

Then:

```sh
npm install
npm run android:debug
```

That builds the static bundle, refreshes launcher icons, syncs Capacitor, and runs `assembleDebug`. The APK is:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

It is signed with the Android debug keystore. It is for sideloading and local testing, not Play Store release.

Install it on a device with USB debugging (or an emulator that `adb` can see):

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Uninstalling Keel clears the ledger. Entries do not sync between the website and the app.

### Run it in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) with Android SDK 36.
2. From the repository root, install dependencies and copy the web bundle into the native project:

   ```sh
   npm install
   npm run android:sync
   ```

   `android/app/src/main/assets/public` is gitignored. If you skip this step, Gradle stops in `preBuild` and tells you to run `npm run android:sync`.

3. In Android Studio choose **File → Open** and select the **`android`** directory, not the repository root.
4. Wait for Gradle sync. If it cannot find the SDK, create `android/local.properties` with `sdk.dir` as above (Android Studio usually writes this for you). Do not commit that file.
5. Select the **app** configuration and a device or emulator, then **Run**.

After you change the ledger UI, run `npm run android:sync` again and rebuild the app in Android Studio so the WebView picks up the new bundle.

`npm run android:open` asks the Capacitor CLI to open the `android` project in Android Studio when the `studio` command is on your `PATH`.

### Icon

The launcher icon is the Keel **K** from `resources/icon.svg` (the same mark as `public/favicon.svg`), on `#0C0D0F`. `npm run android:icons` redraws the mipmaps. `npm run android:sync` runs that step.

Type in the Android bundle is IBM Plex Sans and Newsreader, shipped under the SIL Open Font License 1.1. The license texts are `android-shell/fonts/IBM-Plex-OFL.txt` and `android-shell/fonts/Newsreader-OFL.txt`.

## Google AI Studio

[Google AI Studio](https://aistudio.google.com) Build can import this repository and preview the **web** app. It does not produce the Android APK — that stays in Android Studio, using the steps above.

1. Open [AI Studio Build](https://aistudio.google.com) (Build mode).
2. In the prompt box, open the **+** menu and choose **Import from GitHub**.
3. Pick this repository, or paste its GitHub URL, and import it.
4. AI Studio reads the project and starts a preview. Keel does not need an API key, a database, or sign-in. The screen that matters is the ledger mounted from `src/routes/index.tsx`.

AI Studio sometimes rewrites files so the project fits its own runner. If you turn on GitHub sync, review the diff before pushing, and do not force-push over `main` — a force push replaces that branch. Use a separate branch or a fork if you want AI Studio to keep its own copy. The `android/` project is for Android Studio; AI Studio’s preview is the website.

Official notes: [Build apps in Google AI Studio](https://ai.google.dev/gemini-api/docs/aistudio-build-mode) and [Sync your AI Studio apps with GitHub](https://aistudio.google.com/learn/sync-your-ai-studio-apps-with-github).
