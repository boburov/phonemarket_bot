import fs from "node:fs/promises";
import path from "node:path";
import env from "../config/env.js";
import logger from "../config/logger.js";

// Client for the production API (telefonbozor). Logs in as the bot's seller
// account, caches the access token and re-logs in on 401 (token TTL is 15m;
// login is rate-limited to 20 per 5 min, so never log in per request).

let accessToken = null;
let loginPromise = null;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const login = async () => {
  const res = await fetch(`${env.API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: env.API_LOGIN, password: env.API_PASSWORD }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.accessToken) {
    throw new ApiError(res.status, `Login xato: ${json?.message || res.status}`);
  }
  logger.info("Production API: login OK");
  return json.data.accessToken;
};

const ensureToken = async (force = false) => {
  if (accessToken && !force) return accessToken;
  // Share one login between concurrent callers.
  loginPromise ??= login().finally(() => (loginPromise = null));
  accessToken = await loginPromise;
  return accessToken;
};

const request = async (method, url, { body, auth = true, isForm = false } = {}) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${await ensureToken(attempt > 0)}`;
    if (body && !isForm) headers["content-type"] = "application/json";

    const res = await fetch(`${env.API_URL}${url}`, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 && auth && attempt === 0) continue; // token expired - re-login once
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json?.message || `HTTP ${res.status}`);
    return json.data;
  }
  throw new ApiError(401, "Avtorizatsiya xatosi");
};

// ---- Brands (public) - cached 10 min ----
let brandsCache = { at: 0, list: [] };

export const getBrands = async () => {
  if (Date.now() - brandsCache.at < 10 * 60_000 && brandsCache.list.length) return brandsCache.list;
  const list = await request("GET", "/brands", { auth: false });
  brandsCache = { at: Date.now(), list: (list || []).filter((b) => b.isActive !== false) };
  return brandsCache.list;
};

export const findBrandId = async (brandName) => {
  if (!brandName) return null;
  const brands = await getBrands();
  const n = brandName.toLowerCase();
  const hit = brands.find((b) => b.name.toLowerCase() === n || b.slug === n);
  return hit ? String(hit._id) : null;
};

// ---- Uploads: max 8 files per call, field "files" ----
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export const uploadImages = async (filePaths) => {
  const form = new FormData();
  let count = 0;
  for (const p of filePaths.slice(0, 8)) {
    const buf = await fs.readFile(p).catch(() => null);
    if (!buf) continue; // photo cleaned up - upload the rest
    count++;
    const type = MIME[path.extname(p).toLowerCase()] || "image/jpeg";
    form.append("files", new Blob([buf], { type }), path.basename(p));
  }
  if (!count) return [];
  const data = await request("POST", "/uploads?folder=phones", { body: form, isForm: true });
  return data?.urls || [];
};

export const createPhone = (payload) => request("POST", "/phones", { body: payload });

export const deletePhone = (id) => request("DELETE", `/phones/${id}`);

export const listingUrl = (id) => `${env.SITE_URL}/phones/${id}`;

// Startup check: verifies credentials without touching listings.
export const checkApi = async () => {
  await ensureToken(true);
  const brands = await getBrands();
  return brands.map((b) => b.name);
};
