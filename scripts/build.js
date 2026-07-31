"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";
const GROUP = "Turkey";
const OUTPUT_FILE = path.join(__dirname, "..", "iptv.m3u");
const FETCH_TIMEOUT_MS = 20000;

// Cloudflare Workers proxy base (no trailing slash). Set via GitHub Actions variable.
// Example: PROXY_BASE=https://vavoo-iptv-proxy.example.workers.dev
const PROXY_BASE = (process.env.PROXY_BASE || "").replace(/\/+$/, "");

function toStreamUrl(item) {
  const id = item?.ids?.id;
  if (PROXY_BASE && id) return `${PROXY_BASE}/play/${id}`;
  return item.url;
}

// Vavoo requires browser-like headers or it returns { error: "Validation error" }
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,tr;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  origin: "https://vavoo.to",
  referer: "https://vavoo.to/live",
  dnt: "1",
  "sec-ch-ua":
    '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

function buildBody(cursor) {
  return JSON.stringify({
    language: "de",
    region: "DE",
    catalogId: "iptv",
    id: "",
    adult: false,
    search: "",
    sort: "name",
    filter: { group: GROUP },
    cursor,
  });
}

async function fetchPage(cursor) {
  const body = buildBody(cursor);
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(CATALOG_URL, {
        method: "POST",
        headers: HEADERS,
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data && data.error) {
        throw new Error(`Vavoo error: ${data.error}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      const wait = 1000 * attempt;
      console.warn(
        `Attempt ${attempt} failed (${err.message}). Retrying in ${wait}ms...`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchAll() {
  const items = [];
  let cursor = null;
  let page = 0;
  // Safety cap to avoid infinite loops if the API misbehaves
  const MAX_PAGES = 200;
  do {
    page++;
    const data = await fetchPage(cursor);
    if (Array.isArray(data.items)) items.push(...data.items);
    console.log(
      `Page ${page}: fetched ${data.items?.length ?? 0} items, nextCursor=${data.nextCursor ?? "null"}`
    );
    cursor = data.nextCursor ?? null;
    if (page >= MAX_PAGES) {
      console.warn(`Reached MAX_PAGES (${MAX_PAGES}), stopping.`);
      break;
    }
  } while (cursor !== null && cursor !== undefined);
  return items;
}

// Escape " for tvg-* attributes and strip newlines from the display name
function escapeAttr(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "'");
}

function sanitizeName(name) {
  return String(name ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

function toM3U(items) {
  const lines = ['#EXTM3U url-tvg=""'];
  for (const it of items) {
    if (!it || !it.url) continue;
    const id = it.ids?.id ?? "";
    const name = sanitizeName(it.name);
    const logo = it.logo ?? "";
    const group = it.group ?? GROUP;
    if (!name) continue;
    lines.push(
      `#EXTINF:-1 tvg-id="${escapeAttr(id)}" tvg-name="${escapeAttr(name)}" tvg-logo="${escapeAttr(logo)}" group-title="${escapeAttr(group)}",${name}`
    );
    lines.push(toStreamUrl(it));
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(`Fetching group="${GROUP}" from ${CATALOG_URL} ...`);
  if (PROXY_BASE) {
    console.log(`Using PROXY_BASE=${PROXY_BASE}`);
  } else {
    console.warn(
      "WARNING: PROXY_BASE is empty. Raw vavoo.to URLs will be written; players without VPN may fail."
    );
  }
  const items = await fetchAll();
  console.log(`Total items: ${items.length}`);
  // Deterministic order for clean git diffs
  items.sort((a, b) => {
    const an = String(a.name ?? "").toLocaleLowerCase("tr-TR");
    const bn = String(b.name ?? "").toLocaleLowerCase("tr-TR");
    if (an < bn) return -1;
    if (an > bn) return 1;
    const ai = a.ids?.id ?? "";
    const bi = b.ids?.id ?? "";
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  const m3u = toM3U(items);
  await fs.writeFile(OUTPUT_FILE, m3u, "utf8");
  console.log(`Wrote ${OUTPUT_FILE} (${m3u.length} bytes, ${items.length} channels)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
