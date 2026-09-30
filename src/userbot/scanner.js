import fs from "node:fs/promises";
import path from "node:path";
import { getClient, withFloodWait } from "./client.js";

const PAGE = 100;

/** "@name", "t.me/name", "https://t.me/s/name/123" -> "name"; null if invalid/private. */
export const parseChannelInput = (input) => {
  const s = String(input || "").trim();
  if (/t\.me\/(\+|joinchat)/i.test(s)) return { error: "private" };
  const m =
    s.match(/^@([a-zA-Z][\w]{3,31})$/) ||
    s.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([a-zA-Z][\w]{3,31})(?:\/\d+)?\/?$/i) ||
    s.match(/^([a-zA-Z][\w]{3,31})$/);
  return m ? { username: m[1] } : { error: "invalid" };
};

/** Resolves a public channel. Throws Error with a user-facing Uzbek message. */
export const resolveChannel = async (username, onWait) => {
  const client = getClient();
  let entity;
  try {
    entity = await withFloodWait(() => client.getEntity(username), onWait);
  } catch {
    throw new Error("Kanal topilmadi. Manzilni tekshiring.");
  }
  if (entity.className !== "Channel") throw new Error("Bu kanal emas (foydalanuvchi yoki bot).");
  if (!entity.username) throw new Error("Faqat ochiq (public) kanallar qo'llab-quvvatlanadi.");
  return entity;
};

const toPost = (group) => {
  const sorted = [...group].sort((a, b) => a.id - b.id);
  const withText = sorted.find((m) => m.message?.trim());
  return {
    messageId: sorted[0].id,
    date: new Date(sorted[0].date * 1000),
    text: withText?.message || "",
    photoMessages: sorted.filter((m) => m.photo),
  };
};

/**
 * Walks channel history newest -> oldest and yields posts (albums merged into
 * one post). Stops after `maxMessages` raw messages.
 */
export async function* scanPosts(entity, { maxMessages, onWait, onScanned, client = getClient() }) {
  let offsetId = 0;
  let scanned = 0;
  let group = [];
  let groupId = null;

  while (scanned < maxMessages) {
    const limit = Math.min(PAGE, maxMessages - scanned);
    const page = await withFloodWait(() => client.getMessages(entity, { limit, offsetId }), onWait);
    if (!page.length) break;

    for (const msg of page) {
      scanned++;
      offsetId = msg.id;
      if (msg.className !== "Message") continue; // service messages

      const gid = msg.groupedId ? String(msg.groupedId) : null;
      if (gid && gid === groupId) {
        group.push(msg);
        continue;
      }
      if (group.length) yield toPost(group);
      group = [msg];
      groupId = gid;
    }
    onScanned?.(scanned);
    // Only an empty page means end of history - Telegram may return short pages.
  }
  if (group.length) yield toPost(group);
}

/** Downloads a post's photos to `dir`; returns saved file paths. Max 8 (one upload call). */
export const downloadPhotos = async (photoMessages, dir, onWait) => {
  const client = getClient();
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  for (const msg of photoMessages.slice(0, 8)) {
    const buf = await withFloodWait(() => client.downloadMedia(msg, {}), onWait);
    if (!buf?.length) continue;
    const file = path.join(dir, `${msg.id}.jpg`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
};
