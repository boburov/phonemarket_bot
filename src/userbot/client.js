import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { FloodWaitError } from "telegram/errors/index.js";
import env from "../config/env.js";
import logger from "../config/logger.js";

let client = null;

// GramJS sleeps by itself for flood waits below this; longer ones reach withFloodWait.
const FLOOD_AUTO_SLEEP = 60;

export const createClient = (session = env.TG_SESSION) =>
  new TelegramClient(new StringSession(session), env.TG_API_ID, env.TG_API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: FLOOD_AUTO_SLEEP,
  });

export const startUserbot = async () => {
  if (!env.TG_SESSION) throw new Error("TG_SESSION bo'sh - avval `npm run login` ni ishga tushiring");
  client = createClient();
  client.setLogLevel("error");
  await client.connect();
  if (!(await client.checkAuthorization())) {
    throw new Error("Userbot sessiyasi yaroqsiz - `npm run login` ni qayta ishga tushiring");
  }
  const me = await client.getMe();
  logger.info({ username: me.username, id: String(me.id) }, "Userbot ulandi");
  return client;
};

export const getClient = () => {
  if (!client) throw new Error("Userbot ishga tushmagan");
  return client;
};

export const stopUserbot = async () => {
  if (client) await client.disconnect().catch(() => {});
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a userbot call; on a long FloodWait waits it out (telling the admin via
 * onWait) and retries. Decided: FloodWait is handled automatically + reported.
 */
export const withFloodWait = async (fn, onWait = async () => {}) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof FloodWaitError)) throw err;
      const seconds = err.seconds + 5;
      logger.warn({ seconds }, "FloodWait");
      await onWait(seconds);
      await sleep(seconds * 1000);
    }
  }
  throw new Error("FloodWait: juda ko'p urinish");
};
