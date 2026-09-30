// Dry run: scans a channel, parses every post and prints a report.
// Writes NOTHING - no Mongo documents, no photo downloads, no uploads to production.
// Its only job is to show how the parser behaves on real posts before the first import.
//
//   npm run dry-run -- @kanal [xabar_soni] [--gemini] [--samples 3]
//
// Gemini is OFF by default: the point of the first run is the free regex baseline.
// Add --gemini to measure the real pipeline (costs money, one API call per unclear post).
import "dotenv/config";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (args[i] === "--samples") i++; // takes a value
    continue;
  }
  positional.push(args[i]);
}

const channelInput = positional[0];
const maxMessages = Number(positional[1] || 200);
const sampleCount = Number(opt("samples", 3));
const useGemini = flag("gemini");

if (!channelInput) {
  console.error("Ishlatilishi:  npm run dry-run -- @kanal [xabar_soni] [--gemini] [--samples 3]");
  process.exit(1);
}
// env.js freezes the config at import time, so this must happen before it loads.
if (!useGemini) process.env.GEMINI_API_KEY = "";

const { startUserbot, stopUserbot } = await import("../userbot/client.js");
const { parseChannelInput, resolveChannel, scanPosts } = await import("../userbot/scanner.js");
const { parsePost } = await import("../parser/index.js");
const { getBrands } = await import("../api/prod.client.js");

const parsed = parseChannelInput(channelInput);
if (parsed.error) {
  console.error(parsed.error === "private" ? "❌ Yopiq kanal qo'llab-quvvatlanmaydi." : "❌ Kanal manzili noto'g'ri.");
  process.exit(1);
}

const pct = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
const pad = (s, n) => String(s).padEnd(n);
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

const REASONS = {
  multiple: "ko'p telefonli post",
  unparsed: "tushunib bo'lmadi",
  not_sale: "sotuv e'loni emas",
  empty: "matn yo'q / juda qisqa",
};

const TRACKED = ["model", "price", "storage", "ram", "batteryHealth", "color", "region", "contactPhone", "telegram", "imei", "documents", "exchange", "defects"];

console.log(`\n🔍 Dry-run: ${channelInput} — ${maxMessages} xabar, Gemini: ${useGemini ? "YONIQ" : "o'chirilgan"}`);
console.log("   Hech narsa yuklanmaydi, hech narsa saqlanmaydi.\n");

try {
  await startUserbot();
} catch (err) {
  console.error(`❌ ${err.message}\n`);
  process.exit(1);
}

let entity;
try {
  entity = await resolveChannel(parsed.username);
} catch (err) {
  console.error(`❌ ${err.message}`);
  await stopUserbot();
  process.exit(1);
}
console.log(`📡 Kanal: ${entity.title} (@${entity.username})\n`);

let posts = 0;
let ok = 0;
let scannedTotal = 0;
const reasons = new Map();
const parsedBy = new Map();
const brands = new Map();
const missingBrandHits = new Map();
const fieldHits = new Map();
const samples = new Map();
let withPhotos = 0;
let photoTotal = 0;
let okWithoutPhotos = 0;

const prodBrands = new Set((await getBrands()).map((b) => b.name.toLowerCase()));

const stream = scanPosts(entity, {
  maxMessages,
  onScanned: (n) => {
    scannedTotal = n;
    process.stdout.write(`\r   skanerlandi: ${n} xabar, ${posts} post, ${ok} yaroqli   `);
  },
});

for await (const post of stream) {
  posts++;
  if (post.photoMessages.length) {
    withPhotos++;
    photoTotal += post.photoMessages.length;
  }

  const result = await parsePost(post.text);
  if (!result.ok) {
    bump(reasons, result.reason);
    const list = samples.get(result.reason) || [];
    if (list.length < sampleCount) {
      list.push({ id: post.messageId, text: post.text });
      samples.set(result.reason, list);
    }
    continue;
  }

  ok++;
  bump(parsedBy, result.parsedBy);
  if (!post.photoMessages.length) okWithoutPhotos++;

  const f = result.fields;
  for (const key of TRACKED) {
    const v = f[key];
    if (v !== null && v !== undefined && v !== "") bump(fieldHits, key);
  }

  const brand = f.brandName || "(aniqlanmadi)";
  bump(brands, brand);
  if (f.brandName && !prodBrands.has(f.brandName.toLowerCase())) bump(missingBrandHits, f.brandName);

  const okList = samples.get("__ok") || [];
  if (okList.length < sampleCount) {
    okList.push({ id: post.messageId, fields: f, by: result.parsedBy, photos: post.photoMessages.length });
    samples.set("__ok", okList);
  }
}

process.stdout.write("\r" + " ".repeat(60) + "\r");

// ---------- Report ----------
console.log("═".repeat(58));
console.log(`📊 NATIJA — ${scannedTotal} xabar skanerlandi, ${posts} post topildi\n`);
console.log(`✅ Yaroqli:     ${pad(ok, 5)} (${pct(ok, posts)})`);
for (const [by, n] of [...parsedBy].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${pad(by === "regex" ? "regex bilan" : "Gemini bilan", 18)} ${n}`);
}
const skipped = posts - ok;
console.log(`\n❌ O'tkazildi:  ${pad(skipped, 5)} (${pct(skipped, posts)})`);
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${pad(`${reason} — ${REASONS[reason] || ""}`, 38)} ${pad(n, 5)} ${pct(n, posts)}`);
}

if (ok) {
  console.log(`\n📋 Maydonlar to'liqligi (${ok} yaroqli postdan):`);
  for (const key of TRACKED) {
    const n = fieldHits.get(key) || 0;
    const mark = ["model", "price"].includes(key) && n < ok ? "  ⚠️ majburiy!" : "";
    console.log(`   ${pad(key, 16)} ${pad(n, 5)} ${pad(pct(n, ok), 5)}${mark}`);
  }
}

console.log(`\n🖼 Rasmlar: ${withPhotos}/${posts} postda bor (jami ${photoTotal}, o'rtacha ${withPhotos ? (photoTotal / withPhotos).toFixed(1) : 0})`);
console.log(`   Yaroqlilardan ${okWithoutPhotos} tasi rasmsiz — ular "rasmsiz yuklanadi" ogohlantirishi bilan ketadi.`);

if (brands.size) {
  console.log("\n🏷 Brendlar:");
  for (const [name, n] of [...brands].sort((a, b) => b[1] - a[1])) {
    const missing = missingBrandHits.has(name) ? "  ❌ production'da YO'Q — yuklanmaydi" : "";
    console.log(`   ${pad(name, 16)} ${pad(n, 5)}${missing}`);
  }
  const lost = [...missingBrandHits.values()].reduce((a, b) => a + b, 0);
  if (lost) console.log(`\n   ⚠️  ${lost} ta yaroqli post brendi production'da yo'qligi uchun yuklanmaydi.`);
}

const okSamples = samples.get("__ok") || [];
if (okSamples.length) {
  console.log(`\n${"─".repeat(58)}\n✅ Muvaffaqiyatli namunalar:\n`);
  for (const s of okSamples) {
    const f = s.fields;
    console.log(`   #${s.id} (${s.by}, ${s.photos} rasm)`);
    console.log(`     ${f.brandName || "?"} ${f.model || "?"} — ${f.price ?? "?"} ${f.currency || ""}`);
    console.log(`     xotira ${f.storage ?? "-"}GB · batareya ${f.batteryHealth ?? "-"}% · ${f.region || "hudud yo'q"} · ${f.contactPhone || "raqam yo'q"}\n`);
  }
}

for (const [reason, list] of samples) {
  if (reason === "__ok" || !list.length) continue;
  console.log(`${"─".repeat(58)}\n❌ "${reason}" namunalari (${REASONS[reason] || ""}):\n`);
  for (const s of list) {
    const text = s.text.replace(/\s*\n\s*/g, " ⏎ ").slice(0, 280);
    console.log(`   #${s.id}: ${text || "(matn yo'q)"}\n`);
  }
}

console.log("═".repeat(58));
if (!useGemini) console.log("ℹ️  Gemini o'chirilgan edi — real ko'rsatkich uchun: --gemini");
console.log("ℹ️  Hech narsa saqlanmadi va yuklanmadi.\n");

await stopUserbot();
process.exit(0);
