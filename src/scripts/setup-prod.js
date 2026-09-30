// One-time production setup. Must be run by the OWNER of telefonbozor.uz:
//   1. registers the bot's seller account   (POST /auth/register-user - owner only)
//   2. adds the brands the bot can detect but production is missing
//   3. writes API_LOGIN / API_PASSWORD into .env and verifies they work
//
// The owner login/password are asked in the terminal, used for this run only, and
// never written to disk or printed. The bot account's password is generated here.
import "dotenv/config";
import crypto from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { setEnvKeys } from "./lib/env-file.js";

const API_URL = (process.env.API_URL || "https://api.telefonbozor.uz/api").replace(/\/$/, "");

// Brands the bot's parser can detect (src/constants/brands.js). Any of these that
// production lacks would make an otherwise-good post unuploadable.
const WANTED_BRANDS = ["Apple", "Samsung", "Xiaomi", "Google", "OnePlus", "Honor", "Huawei", "Realme", "Tecno", "Infinix", "Vivo", "Oppo", "Nothing", "Motorola"];

// Without a terminal (piped input, CI, tests) stdin is drained once up front:
// a readline interface buffers whatever is available and loses it on close, so
// opening one per prompt would swallow every answer after the first.
let piped = null;
const nextPipedLine = async () => {
  if (!piped) {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    piped = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  return piped.length ? piped.shift() : "";
};

// The terminal is put in raw mode once and stays there for the whole run, so there
// is never a moment where the tty echoes on its own. Leaving and re-entering raw
// mode per prompt left exactly such a gap between the prompts, and anything typed
// or pasted into it appeared on screen - including the password.
// readline is not used at all: closing an interface also drops raw mode.
let rawEntered = false;
const enterRawMode = () => {
  if (!input.isTTY || rawEntered) return;
  input.setRawMode(true);
  rawEntered = true;
};
const restoreTty = () => {
  if (!rawEntered) return;
  input.setRawMode(false);
  rawEntered = false;
};
// Never hand the shell back a terminal stuck in raw mode.
process.on("exit", restoreTty);

// Characters received past the end of one line - a paste delivers every line in a
// single chunk - are held here for the next prompt instead of being dropped.
let pendingInput = "";

// Reads one line from the terminal, echoing the characters itself when `echo` is set.
const readFromTty = (question, { echo }) =>
  new Promise((resolve) => {
    enterRawMode();
    output.write(question);
    let value = "";

    // Returns true once the line is terminated; the rest of `text` is kept for later.
    const consume = (text) => {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          pendingInput = text.slice(i + 1);
          return true;
        }
        if (ch === "\u0003") {
          // Raw mode swallows SIGINT, so quit here instead of throwing a stack trace.
          restoreTty();
          output.write("\n^C Bekor qilindi\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value) {
            value = value.slice(0, -1);
            if (echo) output.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          value += ch;
          if (echo) output.write(ch);
        }
      }
      return false;
    };

    const leftover = pendingInput;
    pendingInput = "";
    if (consume(leftover)) {
      output.write("\n");
      return resolve(value);
    }

    input.resume();
    const onData = (chunk) => {
      if (!consume(chunk.toString("utf8"))) return;
      input.off("data", onData);
      input.pause();
      output.write("\n");
      resolve(value);
    };
    input.on("data", onData);
  });

const ask = async (question) => {
  if (!input.isTTY) {
    const value = await nextPipedLine();
    output.write(`${question}${value}\n`);
    return value.trim();
  }
  return (await readFromTty(question, { echo: true })).trim();
};

const askSecret = async (question) => {
  if (!input.isTTY) {
    const value = await nextPipedLine();
    output.write(`${question}(ko'rsatilmaydi)\n`);
    return value;
  }
  return readFromTty(question, { echo: false });
};

const die = async (msg) => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

const api = async (method, urlPath, { body, token } = {}) => {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(json?.details) ? ` (${json.details.map((d) => d.message).join("; ")})` : "";
    const err = new Error(`${json?.message || `HTTP ${res.status}`}${details}`);
    err.status = res.status;
    throw err;
  }
  return json.data;
};

const strongPassword = () => crypto.randomBytes(18).toString("base64url");

// --yes: accept every default, so the only thing typed is the owner login/password.
const assumeYes = process.argv.includes("--yes") || process.argv.includes("-y");

console.log(`\n🔧 Production sozlash — ${API_URL}\n`);
console.log("Owner hisobingiz kerak. Parol ekranda ko'rinmaydi va hech qayerga saqlanmaydi.");
if (assumeYes) console.log("(--yes: qolgan hamma savolga standart javob olinadi)");
console.log();

// ---- 1. Owner login ----
const ownerLogin = (await ask("Owner login (username yoki telefon): ")).trim();
const ownerPassword = await askSecret("Owner parol: ");
if (!ownerLogin || !ownerPassword) await die("Login va parol kerak.");

let owner;
try {
  owner = await api("POST", "/auth/login", { body: { login: ownerLogin, password: ownerPassword } });
} catch (err) {
  if (err.status === 429) await die("Juda ko'p urinish — 5 daqiqa kuting.");
  await die(
    `Owner login xato: ${err.message}\n\n` +
      "   Tekshiring:\n" +
      "   • Login sifatida username yoki telefon (+998...) ishlaydi.\n" +
      "   • Seed bilan yaratilgan owner'ning username'i oddiy \"owner\" bo'ladi.\n" +
      "   • Google orqali kirgan hisobda parol umuman yo'q (authProvider=google) —\n" +
      "     bunday hisob bilan bu skript ishlamaydi, parolli owner hisobi kerak.",
  );
}
if (owner.user?.role !== "owner") {
  await die(`Bu hisobning roli "${owner.user?.role}" — brend qo'shish va hisob yaratish uchun "owner" kerak.`);
}
const token = owner.accessToken;
console.log(`✅ Owner sifatida kirildi: ${owner.user.username || owner.user.firstName}\n`);

// ---- 2. Missing brands ----
const existing = await api("GET", "/brands");
const have = new Set(existing.map((b) => b.name.toLowerCase()));
const missing = WANTED_BRANDS.filter((n) => !have.has(n.toLowerCase()));

if (!missing.length) {
  console.log(`🏷  Brendlar: hammasi bor (${existing.length} ta) — qo'shish kerak emas.\n`);
} else {
  console.log(`🏷  Production'da yo'q brendlar (${missing.length} ta): ${missing.join(", ")}`);
  const go = assumeYes ? "ha" : (await ask("   Qo'shamizmi? (ha/yo'q): ")).toLowerCase();
  if (/^(ha|h|yes|y)$/.test(go)) {
    let order = Math.max(0, ...existing.map((b) => Number(b.order) || 0));
    for (const name of missing) {
      try {
        await api("POST", "/brands", { body: { name, order: ++order }, token });
        console.log(`   ✅ ${name}`);
      } catch (err) {
        console.log(`   ⚠️  ${name} — ${err.message}`);
      }
    }
  } else {
    console.log("   ⏭  O'tkazib yuborildi. Bu brendlardagi postlar yuklanmaydi.");
  }
  console.log();
}

// ---- 3. Bot seller account ----
console.log("👤 Botning sotuvchi hisobi");
const defaultUsername = process.env.API_LOGIN || "telefonbozor_bot";
const defaultPhone = "+998900000001";
let username = assumeYes ? defaultUsername : (await ask(`   Username [${defaultUsername}]: `)) || defaultUsername;
const phone = assumeYes
  ? defaultPhone
  : (await ask(`   Telefon raqam (haqiqiy SIM bo'lishi shart emas, faqat takrorlanmasin) [${defaultPhone}]: `)) || defaultPhone;
if (assumeYes) console.log(`   username: ${username}, telefon: ${phone}`);

let password = strongPassword();
let created = false;

for (;;) {
  try {
    await api("POST", "/auth/register-user", {
      token,
      body: { firstName: "Telefon Bozor", lastName: "Bot", username, phone, password, role: "user" },
    });
    created = true;
    console.log(`   ✅ Hisob yaratildi: ${username} (parol .env ga yozildi)`);
    break;
  } catch (err) {
    const msg = err.message.toLowerCase();
    const duplicate = /band|mavjud|exist|duplicate|E11000/i.test(msg) || err.status === 409;
    if (!duplicate) await die(`Hisob yaratilmadi: ${err.message}`);

    console.log(`   ⚠️  "${username}" (yoki bu telefon) allaqachon mavjud.`);
    console.log("      Owner ham boshqa hisobning parolini API orqali tiklay olmaydi, shuning uchun:");
    console.log("      1 = mavjud hisobning parolini o'zim kiritaman");
    console.log("      2 = boshqa username bilan yangi hisob yarataman");
    if (assumeYes) {
      await die(
        "Bu yerda tanlov kerak, --yes bilan o'zim hal qilmayman (keraksiz hisob yaratib qo'yishim mumkin).\n" +
          "   --yes siz qayta ishga tushiring:  npm run setup:prod",
      );
    }
    const choice = await ask("      Tanlang (1/2): ");

    if (choice === "1") {
      password = await askSecret(`      "${username}" hisobining paroli: `);
      if (!password) await die("Parol kiritilmadi.");
      break;
    }
    if (choice === "2") {
      username = (await ask("      Yangi username: ")).trim();
      if (!username) await die("Username kiritilmadi.");
      password = strongPassword();
      continue;
    }
    await die("Bekor qilindi.");
  }
}

// ---- 4. Verify the bot account actually works ----
let check;
try {
  check = await api("POST", "/auth/login", { body: { login: username, password } });
} catch (err) {
  await die(
    `Bot hisobi bilan kirib bo'lmadi: ${err.message}\n` +
      (created ? "   Hisob yaratildi, lekin login ishlamadi — serverni tekshiring." : "   Kiritgan parolingiz to'g'ri emas shekilli."),
  );
}
console.log(`   ✅ Bot hisobi bilan login tekshirildi (rol: ${check.user?.role})`);
if (check.user?.role !== "user") {
  console.log(`   ⚠️  Diqqat: rol "${check.user?.role}" — kutilgani "user".`);
}

// ---- 5. Save to .env ----
const unwritable = await setEnvKeys({ API_LOGIN: username, API_PASSWORD: password });
console.log(`\n💾 .env yangilandi: API_LOGIN=${username}`);
if (unwritable.includes("API_PASSWORD")) {
  console.log(
    "⚠️  API_PASSWORD .env ga yozilmadi: parolda bitta tirnoq (') yoki qator uzilishi bor,\n" +
      "    dotenv bunday qiymatni o'qiy olmaydi. .env dagi API_PASSWORD ni qo'lda to'ldiring,\n" +
      "    yoki bunday belgisiz parol tanlang.",
  );
} else {
  console.log("   API_PASSWORD=(yozildi, ko'rsatilmaydi)");
}

const brandsNow = await api("GET", "/brands");
console.log(`\n✅ Tayyor. Production'da ${brandsNow.length} ta brend, bot hisobi ishlayapti.`);
console.log("   Keyingi qadam:  npm run login   (userbot sessiyasi uchun)\n");

process.exit(0);
