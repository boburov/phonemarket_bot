# Telefon Bozor — import bot

Collects phone-sale posts from public Telegram channels, lets an admin review
them in a Telegram bot, and uploads approved ones to telefonbozor.uz through
the production API.

```
src/
├─ index.js              # entrypoint: DB -> userbot -> API check -> admin bot
├─ config/               # env, logger, db
├─ constants/brands.js   # brand keywords, sub-brand mapping (Redmi/Poco -> Xiaomi)
├─ models/               # Job, Draft, Seen (bot's own DB)
├─ userbot/              # GramJS client + channel scanner (albums merged)
├─ parser/               # regex parser + Gemini fallback
├─ api/prod.client.js    # production API: login, brands, uploads, phones
├─ services/             # import queue, draft upload/skip/undo/expiry, payload builder
├─ admin/                # grammY admin bot: commands, review cards, edit
└─ scripts/
   ├─ login.js           # one-time userbot login (code arrives in the Telegram app)
   ├─ login-qr.js        # same, via QR (needs a phone camera to approve)
   ├─ setup-prod.js      # one-time: bot seller account + missing brands (owner only)
   └─ dry-run.js         # scan + parse a channel and report; writes and uploads nothing
```

## Setup (once)

1. **Admin bot**: create one with @BotFather → `BOT_TOKEN`. Put the Telegram user IDs of the admins in `ADMIN_IDS` (comma-separated; get yours from @userinfobot).
2. **Userbot account** (a dedicated SIM is safer than your personal account — Telegram may restrict an account it sees scraping): get `api_id` / `api_hash` at https://my.telegram.org → `TG_API_ID`, `TG_API_HASH`.
3. `cp .env.example .env`, fill in the values, then `npm install`.
4. **Production side** — run as the site owner:
   ```bash
   npm run setup:prod -- --yes
   ```
   Asks for your owner login/password (not echoed, not stored), registers the bot's
   seller account with a generated password, adds any brand the parser knows but
   production lacks, then writes `API_LOGIN` / `API_PASSWORD` into `.env` and verifies
   the account can log in. `--yes` takes the defaults for everything else, so the owner
   credentials are the only thing typed; drop it to choose the username and phone. If
   the account already exists, rerun without `--yes` — the password cannot be reset
   through the API, so it has to ask whether to supply it or use a new username.
5. **Userbot session**:
   ```bash
   npm run login
   ```
   Enter the phone, then the code. Note: if that account already has an active
   Telegram session, the code is **not sent by SMS** — it arrives as a message in the
   Telegram app itself (the blue "Telegram" chat). The script prints where it went.
   Paste the resulting `TG_SESSION=...` into `.env`.

## Check the parser before importing anything

```bash
npm run dry-run -- @channel 200            # regex only: free and fast
npm run dry-run -- @channel 200 --gemini   # real pipeline (one API call per unclear post)
```

Scans the channel, parses every post and prints how many were understood, why the
rest were skipped, which fields are usually missing, photo counts, the brand spread
(flagging brands production doesn't have) and sample posts for each outcome. It
creates no drafts, downloads no photos and uploads nothing.

## Run

```bash
npm start                              # local
pm2 start ecosystem.config.cjs         # production (keep instances: 1)
pm2 save
```

## Using it

`/import` → send `@channel` → send a count (1–50). The bot scans up to 500
messages back, skipping posts it has seen before, and shows progress. When it's
done, review cards come one by one:

- ✅ Tasdiqlash — upload photos + create the listing (status `active`)
- ❌ O'tkazib yuborish — skip
- ✏️ Tahrirlash — fix model / brand / price / storage / … before uploading
- ✅ Hammasini tasdiqlash — upload every ready pending draft (asks first)
- 🗑 O'chirish — delete an uploaded listing within 24 hours

Also: `/review` (continue), `/jobs`, `/stats`, `/cancel`.

## Behaviour notes

- One phone per post; multi-phone, buying and ad posts are skipped.
- Regex parses the usual emoji template; Gemini (`GEMINI_MODEL`) is called only when model/brand or price is missing, or the post may not be a sale.
- The parser knows 14 brands; production must have a matching `Brand` for the upload to work, and a `user`-role account cannot create one. `npm run setup:prod` adds the missing ones. Until then those posts fall back to the brand picker on the card.
- IMEI, documents, exchange and Telegram handle go into the description. The source link stays in the bot DB only.
- Pending drafts expire after `DRAFT_TTL_DAYS` (3); downloaded photos are deleted after upload/skip/expiry.
- Duplicates (same seller phone + model) are flagged on the card, not dropped.

## Tests

```bash
npm test
```
