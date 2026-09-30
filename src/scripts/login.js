// One-time userbot login: asks phone / code / 2FA password in the terminal,
// then prints the session string to put into .env as TG_SESSION.
// Only needs TG_API_ID and TG_API_HASH - not the rest of the bot config.
// Shows WHERE Telegram sent the code (app / SMS / email / ...) and allows resending.
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { setEnvKeys } from "./lib/env-file.js";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) {
  console.error("❌ .env da TG_API_ID va TG_API_HASH bo'lishi kerak (https://my.telegram.org)");
  process.exit(1);
}

// "200020446" / "99 891..." -> "+998200020446"
const normalizePhone = (raw) => {
  const digits = String(raw).replace(/\D+/g, "");
  return digits.length === 9 ? `+998${digits}` : `+${digits}`;
};

const describeCodeType = (type) => {
  switch (type?.className) {
    case "auth.SentCodeTypeApp":
      return "📱 Telegram ilovasiga: shu akkaunt ochiq turgan telefon/kompyuterda \"Telegram\" (ko'k belgili) chatini oching";
    case "auth.SentCodeTypeSms":
    case "auth.SentCodeTypeSmsWord":
    case "auth.SentCodeTypeSmsPhrase":
    case "auth.SentCodeTypeFirebaseSms":
      return "✉️ SMS orqali";
    case "auth.SentCodeTypeCall":
      return "📞 Qo'ng'iroq orqali (kodni aytib beradi)";
    case "auth.SentCodeTypeFlashCall":
    case "auth.SentCodeTypeMissedCall":
      return `📞 Qo'ng'iroq: kod - kelgan raqamning oxirgi raqamlari${type.prefix ? ` (prefiks ${type.prefix})` : ""}`;
    case "auth.SentCodeTypeEmailCode":
      return `📧 Login email ga: ${type.emailPattern}`;
    case "auth.SentCodeTypeFragmentSms":
      return `💎 Fragment orqali: ${type.url}`;
    case "auth.SentCodeTypeSetUpEmailRequired":
      return "⚠️ Telegram avval LOGIN EMAIL o'rnatishni talab qilyapti";
    default:
      return type?.className || "noma'lum";
  }
};

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);
const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
client.setLogLevel("none"); // hide GramJS background noise (TIMEOUT etc.)

const fail = async (msg) => {
  console.error(`\n❌ ${msg}\n`);
  rl.close();
  await client.disconnect().catch(() => {});
  process.exit(1);
};

const explain = (err) => {
  const m = err.errorMessage || err.message;
  if (m?.startsWith("FLOOD_WAIT")) return `Juda ko'p urinish. ${err.seconds} soniya (~${Math.ceil(err.seconds / 60)} daqiqa) kuting.`;
  if (m === "PHONE_NUMBER_INVALID") return "Telefon raqam noto'g'ri. +998XXXXXXXXX ko'rinishida yozing.";
  if (m === "PHONE_NUMBER_BANNED") return "Bu raqam Telegram tomonidan bloklangan.";
  if (m === "API_ID_INVALID") return "TG_API_ID / TG_API_HASH noto'g'ri (my.telegram.org dan qayta oling).";
  return m;
};

await client.connect();

const phone = normalizePhone(await ask("Telefon raqam (+998...): "));
let sent;
try {
  sent = await client.invoke(
    new Api.auth.SendCode({ phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}) }),
  );
} catch (err) {
  await fail(explain(err));
}

if (sent.className === "auth.SentCodeSuccess") {
  console.log("✅ Kod kerak bo'lmadi - kirildi.");
} else {
  let hash = sent.phoneCodeHash;
  const show = (s) => {
    console.log(`\nKod yuborildi → ${describeCodeType(s.type)}`);
    if (s.type?.className === "auth.SentCodeTypeSetUpEmailRequired") {
      console.log(
        "   Telegram ilovasida: Sozlamalar → Maxfiylik va xavfsizlik → Login email - email qo'shing,\n" +
          "   keyin `npm run login` ni qayta ishga tushiring.",
      );
    }
    if (s.nextType) console.log(`   Kelmasa \"r\" yozing → keyingisi: ${describeCodeType(s.nextType)}`);
    else console.log(`   Kelmasa \"r\" yozib qayta yuborishingiz mumkin.`);
  };
  show(sent);

  for (;;) {
    const answer = (await ask("\nKodni kiriting (yoki r = qayta yuborish, q = chiqish): ")).trim();
    if (answer.toLowerCase() === "q") await fail("Bekor qilindi");
    if (answer.toLowerCase() === "r") {
      try {
        const again = await client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash: hash }));
        hash = again.phoneCodeHash;
        show(again);
      } catch (err) {
        console.log(`⚠️ ${explain(err)}`);
      }
      continue;
    }
    const code = answer.replace(/\D+/g, "");
    if (!code) continue;
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: hash, phoneCode: code }));
      break;
    } catch (err) {
      const m = err.errorMessage;
      if (m === "SESSION_PASSWORD_NEEDED") {
        await client.signInWithPassword(
          { apiId, apiHash },
          {
            password: () => ask("2FA (bulutli) parol: "),
            onError: async (e) => {
              console.log(`⚠️ ${explain(e)}`);
              return false; // ask again
            },
          },
        );
        break;
      }
      if (m === "PHONE_CODE_INVALID") {
        console.log("⚠️ Kod noto'g'ri. Eng OXIRGI kelgan kodni kiriting.");
        continue;
      }
      if (m === "PHONE_CODE_EXPIRED") {
        console.log("⚠️ Kod eskirdi. \"r\" yozib yangisini oling.");
        continue;
      }
      await fail(explain(err));
    }
  }
}

const me = await client.getMe();
console.log(`\n✅ Kirildi: @${me.username || me.firstName} (${me.id})`);

const session = client.session.save();
const unwritable = await setEnvKeys({ TG_SESSION: session }).catch((err) => {
  console.error(`⚠️  .env ga yozib bo'lmadi: ${err.message}`);
  return ["TG_SESSION"];
});

if (unwritable.includes("TG_SESSION")) {
  console.log("\n.env faylga o'zingiz qo'shing (hech kimga bermang!):\n");
  console.log(`TG_SESSION=${session}\n`);
} else {
  console.log("💾 TG_SESSION .env ga yozildi (ko'rsatilmaydi — bu sessiya kaliti).");
  console.log("\nTayyor. Endi kanalni sinab ko'rish mumkin:");
  console.log("   npm run dry-run -- @kanal 200\n");
}

rl.close();
await client.disconnect();
process.exit(0);
