import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");

// dotenv understands no backslash escapes, so a value is written either bare
// (simple characters only) or inside single quotes, which it takes literally.
// A value holding a single quote or a newline cannot be expressed at all.
export const encodeEnvValue = (v) => {
  const s = String(v);
  if (/^[A-Za-z0-9_\-.:/@+=]*$/.test(s)) return s;
  if (!s.includes("'") && !/[\r\n]/.test(s)) return `'${s}'`;
  return null;
};

/**
 * Replace KEY=... in .env, or append it if the key isn't there. Every other line,
 * including comments, is left untouched. Returns the keys that could not be written.
 */
export const setEnvKeys = async (updates) => {
  let text = await fs.readFile(ENV_FILE, "utf8").catch(() => "");
  const unwritable = [];
  for (const [key, value] of Object.entries(updates)) {
    const encoded = encodeEnvValue(value);
    if (encoded === null) {
      unwritable.push(key);
      continue;
    }
    const line = `${key}=${encoded}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    // Function replacement: a literal one would expand `$&`, `$1`, ... inside a secret.
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n*$/, "")}\n${line}\n`;
  }
  if (!text.endsWith("\n")) text += "\n";
  await fs.writeFile(ENV_FILE, text);
  return unwritable;
};
