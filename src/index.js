import env from "./config/env.js";
import logger from "./config/logger.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { startUserbot, stopUserbot } from "./userbot/client.js";
import { checkApi } from "./api/prod.client.js";
import { createAdminBot } from "./admin/bot.js";
import { recoverJobs } from "./services/import.service.js";
import { expireOldDrafts } from "./services/draft.service.js";
import { geminiEnabled } from "./parser/gemini.parser.js";

const main = async () => {
  if (!env.ADMIN_IDS.length) throw new Error("ADMIN_IDS bo'sh - kamida bitta admin ID kerak");

  await connectDB();
  await startUserbot();

  const brands = await checkApi();
  logger.info({ brands }, "Production API ulandi");
  if (!geminiEnabled()) logger.warn("GEMINI_API_KEY yo'q - faqat regex parser ishlaydi");

  const bot = createAdminBot();
  await bot.api.setMyCommands([
    { command: "import", description: "Kanaldan e'lon yig'ish" },
    { command: "review", description: "Ko'rib chiqishni davom ettirish" },
    { command: "jobs", description: "Oxirgi importlar" },
    { command: "stats", description: "Statistika" },
    { command: "cancel", description: "Bekor qilish" },
  ]);

  await recoverJobs();
  await expireOldDrafts();
  const expiryTimer = setInterval(() => expireOldDrafts().catch((e) => logger.error(e.message)), 3_600_000);

  const shutdown = async (signal) => {
    logger.info({ signal }, "To'xtatilmoqda…");
    clearInterval(expiryTimer);
    await bot.stop().catch(() => {});
    await stopUserbot();
    await disconnectDB();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  bot.start({
    drop_pending_updates: true,
    onStart: (me) => logger.info(`Admin bot ishga tushdi: @${me.username}`),
  });
};

main().catch((err) => {
  logger.fatal({ err: err.message }, "Ishga tushmadi");
  process.exit(1);
});
