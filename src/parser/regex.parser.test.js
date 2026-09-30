import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWithRegex, parsePrice } from "./regex.parser.js";

const SAMPLE = `📱Telefon: iPhone13
🛠 Aybi: Yoʻq 
💾 Xotira:128 GB
🔋Batareyka: 82%
❗️Imeyka: Bor
📦 Dokument: Bor
💰 Narxi: 340$
❗️Obmen bormi: Yoʻq 
📍 Manzil: Andijon shaxar, Baliqchi tumani
☎️Telefon: +998 91 480 71 77
📩 Telegram: @Feruzaxanum 

ℹ️ Qo'shimcha:
Kelishamiz, zaryadlovchi bilan`;

test("parses the standard emoji template", () => {
  const { fields, signals } = parseWithRegex(SAMPLE);
  assert.equal(fields.brandName, "Apple");
  assert.equal(fields.model, "iPhone 13");
  assert.equal(fields.storage, 128);
  assert.equal(fields.batteryHealth, 82);
  assert.equal(fields.price, 340);
  assert.equal(fields.currency, "USD");
  assert.equal(fields.imei, "Bor");
  assert.equal(fields.documents, "Bor");
  assert.equal(fields.exchange, "Yo'q");
  assert.equal(fields.defects, "Yoʻq");
  assert.equal(fields.region, "Andijon, Baliqchi tumani");
  assert.equal(fields.contactPhone, "+998914807177");
  assert.equal(fields.telegram, "@Feruzaxanum");
  assert.equal(fields.condition, "used");
  assert.equal(fields.isNegotiable, true);
  assert.match(fields.extra, /zaryadlovchi/);
  assert.deepEqual(signals, { hasModel: true, hasPrice: true, multiple: false, buyPost: false });
});

test("unlabelled post", () => {
  const { fields, signals } = parseWithRegex("Redmi Note 12 Pro 256gb sotiladi\nNarxi 2.5 mln\n90 123 45 67");
  assert.equal(fields.brandName, "Xiaomi");
  assert.equal(fields.model, "Redmi Note 12 Pro");
  assert.equal(fields.storage, 256);
  assert.equal(fields.price, 2_500_000);
  assert.equal(fields.currency, "UZS");
  assert.equal(fields.contactPhone, "+998901234567");
  assert.equal(signals.hasModel, true);
});

test("multi-phone post is flagged", () => {
  const { signals } = parseWithRegex("📱Telefon: iPhone 11\n💰 Narxi: 250$\n\n📱Telefon: iPhone 12\n💰 Narxi: 300$");
  assert.equal(signals.multiple, true);
});

test("price formats", () => {
  assert.deepEqual(parsePrice("1.200$"), { price: 1200, currency: "USD" });
  assert.deepEqual(parsePrice("4 500 000 so'm"), { price: 4500000, currency: "UZS" });
  assert.deepEqual(parsePrice("450 ming"), { price: 450000, currency: "UZS" });
  assert.deepEqual(parsePrice("340"), { price: 340, currency: "USD" });
});

test("unlabelled generic brand line", () => {
  const { fields, signals } = parseWithRegex("📱 Honor X8 6/128\n💰 170$ kelishamiz\n📍 Namangan\n📞 +998 99 111 22 33");
  assert.equal(fields.brandName, "Honor");
  assert.equal(fields.model, "X8");
  assert.equal(fields.price, 170);
  assert.equal(fields.contactPhone, "+998991112233");
  assert.equal(signals.hasModel, true);
});

test("mln with thousands tail", () => {
  assert.deepEqual(parsePrice("2 млн 800 сум"), { price: 2800000, currency: "UZS" });
  const { fields } = parseWithRegex("Samsung A52 128gb. 2 млн 800 сум. 93 555 12 12");
  assert.equal(fields.price, 2800000);
  assert.equal(fields.model, "A52");
});

// --- Cases found by running the parser against a real Tashkent channel ---

test("mln tail written without a space", () => {
  // "3mln670" is 3 670 000, not 3 000 000: the suffix must not swallow the tail.
  assert.deepEqual(parsePrice("3mln670"), { price: 3670000, currency: "UZS" });
  assert.deepEqual(parsePrice("3mln670 kelishiladi"), { price: 3670000, currency: "UZS" });
  assert.deepEqual(parsePrice("4.5 mln"), { price: 4500000, currency: "UZS" });
});

test("so'm spelled with õ / ō", () => {
  assert.deepEqual(parsePrice("680,000 sõm"), { price: 680000, currency: "UZS" });
  assert.deepEqual(parsePrice("3,650,000 sōm"), { price: 3650000, currency: "UZS" });
});

test("grouped number with no currency word at all", () => {
  const { fields } = parseWithRegex("📲 Iphone 12 Pro\n💵 3.500.000✅\n📞 978622282");
  assert.equal(fields.price, 3500000);
  assert.equal(fields.currency, "UZS");
  // A phone number must never be read as a price.
  assert.equal(fields.contactPhone, "+998978622282");
});

test("Cyrillic brand keywords match", () => {
  // These were dead patterns: JS \b is defined over [A-Za-z0-9_] only.
  assert.equal(parseWithRegex("айфон 13 pro 128gb 300$ 901234567").fields.brandName, "Apple");
  assert.equal(parseWithRegex("самсунг galaxy A51 150$ 901234567").fields.brandName, "Samsung");
  assert.equal(parseWithRegex("Редми Note 12 200$ 901234567").fields.brandName, "Xiaomi");
});

test("labels separated by a space instead of a colon", () => {
  const { fields, signals } = parseWithRegex(
    "📲 Nomi va modeli 15pro\n💾 Xotirasi 128\n🌈 Rangi titan\n💰 Narxi 1.490.000\n📞 Tel 990190478\n🇺🇿 #Toshkent, Yunusobod",
  );
  assert.equal(fields.model, "15 Pro"); // prettifyModel splits "15pro"
  assert.equal(fields.storage, 128);
  assert.equal(fields.color, "titan");
  assert.equal(fields.price, 1490000);
  assert.equal(fields.contactPhone, "+998990190478");
  assert.equal(fields.region, "Toshkent, Yunusobod");
  assert.equal(signals.multiple, false); // the space-label pass must not inflate counts
});

test("a phone number never becomes the model", () => {
  // Produced listings titled "Apple 994661141" before the letter check was added.
  const { fields } = parseWithRegex("📱 iPhone 12\n💾 128 GB\n💰 239$\n📞 Tel 994661141");
  assert.equal(fields.model, "iPhone 12");
  assert.equal(fields.contactPhone, "+998994661141");
});

test("region is canonicalised, districts are not invented", () => {
  const region = (t) => parseWithRegex(t).fields.region;
  assert.equal(region("iPhone 11 200$ 901234567\n🚩 Manzil nomi Toshkent"), "Toshkent");
  assert.equal(region("iPhone 11 200$ 901234567\nТошкент шахар"), "Toshkent");
  assert.equal(region("iPhone 11 200$ 901234567\n#Toshkent, Yunusobod"), "Toshkent, Yunusobod");
  // "Shaxar", "Telegram", "Jiddiy" are not districts.
  assert.equal(region("iPhone 11 200$ 901234567\n📍 Toshkent Shaxar"), "Toshkent");
  assert.equal(region("iPhone 11 200$ 901234567\n📍 Toshkent\n📩 Telegram @sotuvchi"), "Toshkent");
  // A bare Tashkent district implies the city, so the site's "Toshkent" filter finds it.
  assert.equal(region("iPhone 11 200$ 901234567\n📍 Manzil: Chilonzor. Dastavka xizmati bor."), "Toshkent, Chilonzor");
});

test("emoji glued to a word still reveals the brand", () => {
  // clean() used to delete emoji, turning "#srochno📱Samsung" into "#srochnoSamsung".
  const { fields, signals } = parseWithRegex("#srochno📱Samsung A 36 5G\n💰3mln670 kelishiladi\n📞 331173125");
  assert.equal(fields.brandName, "Samsung");
  assert.equal(fields.price, 3670000);
  assert.equal(signals.hasModel, true);
});
