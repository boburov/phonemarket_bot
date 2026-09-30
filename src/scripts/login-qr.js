// Userbot login via QR code - no SMS/app code needed.
// Scan with the Telegram app: Settings -> Devices -> Link Desktop Device.
// Prints the session string to put into .env as TG_SESSION.
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import qrcode from "qrcode-terminal";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { setEnvKeys } from "./lib/env-file.js";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) {
  console.error("❌ .env da TG_API_ID va TG_API_HASH bo'lishi kerak (https://my.telegram.org)");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
client.setLogLevel("none");

await client.connect();

console.log("\n📱 Telefoningizda: Telegram → Sozlamalar → Qurilmalar → \"Kompyuterni ulash\" (Link Desktop Device)");
console.log("   va quyidagi QR kodni skanerlang. QR har ~30 soniyada yangilanadi.\n");

try {
  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async ({ token }) => {
        const url = `tg://login?token=${Buffer.from(token).toString("base64url")}`;
        console.clear();
        console.log("📱 Telegram → Sozlamalar → Qurilmalar → Kompyuterni ulash → skanerlang:\n");
        qrcode.generate(url, { small: true });
        console.log("\n(Terminal oynasini kattaroq qiling, QR to'liq ko'rinsin)");
      },
      password: async (hint) => rl.question(`\n2FA (bulutli) parol${hint ? ` (maslahat: ${hint})` : ""}: `),
      onError: async (err) => {
        console.error("⚠️", err.errorMessage || err.message);
        return true; // stop on error
      },
    },
  );
} catch (err) {
  console.error(`\n❌ ${err.errorMessage || err.message}\n`);
  rl.close();
  await client.disconnect().catch(() => {});
  process.exit(1);
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
  console.log("💾 TG_SESSION .env ga yozildi.");
  console.log("\nTayyor. Endi:  npm run dry-run -- @kanal 200\n");
}

rl.close();
await client.disconnect();
process.exit(0);
