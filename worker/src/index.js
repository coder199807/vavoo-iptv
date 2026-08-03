// HLS-aware proxy for Vavoo IPTV links.
// - GET /play/<id>  -> POSTs mediahubmx-resolve.json, follows the returned signed HLS URL,
//                      rewrites URLs inside the manifest so the client never talks to Vavoo
//                      or the rotating CDN directly.
// - GET /p?u=<url>  -> proxies an HLS-adjacent asset (m3u8/ts/key/aac/m4s/mp4/vtt/...).
//                      Extension whitelisted to prevent open-proxy abuse.
// - GET /health     -> "vavoo-iptv proxy: OK"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

// Chrome fingerprint headers Vavoo's Cloudflare in front of api.vavoo.to sometimes checks.
const CHROME_FP_HEADERS = {
  "sec-ch-ua":
    '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

const UPSTREAM_HEADERS = {
  "user-agent": UA,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,tr;q=0.8",
  origin: "https://vavoo.to",
  referer: "https://vavoo.to/",
};

const RESOLVE_URL = "https://vavoo.to/mediahubmx-resolve.json";
const RESOLVE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "user-agent": UA,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,tr;q=0.8",
  origin: "https://vavoo.to",
  referer: "https://vavoo.to/live",
  ...CHROME_FP_HEADERS,
};

// Vavoo's resolve endpoint returns a "download VYPN" promo stream unless every
// POST carries a valid mediahubmx-signature. The signature is obtained by
// mimicking the Lokke/VYPN mobile client's app-ping call. Signatures are short-
// lived (a few minutes), so we cache one per isolate.
const PING_URLS = [
  "https://www.vavoo.tv/api/app/ping",
  "https://www.lokke.app/api/app/ping",
  "https://vavoo.tv/api/app/ping",
];
const PING_TOKEN =
  "ldCvE092e7gER0rVIajfsXIvRhwlrAzP6_1oEJ4q6HH89Ht24v6NNL_jQJO219hiLOXF2hqEfsUuEWitEIGN4EaHHEHb7Cd7gojc5SQYRFzU3XWo_kMeryAUbcwWnQrnf0-";
const PING_HEADERS = {
  "user-agent": "okhttp/4.11.0",
  accept: "application/json",
  "content-type": "application/json; charset=utf-8",
  "accept-encoding": "gzip",
};
const SIGNATURE_TTL_MS = 5 * 60 * 1000;
/** @type {string | null} */
let cachedSignature = null;
let cachedSignatureExpiresAt = 0;
/** @type {Promise<string | null> | null} */
let inflightSignature = null;

function buildPingPayload() {
  const now = Date.now();
  const uniqueId = (crypto.randomUUID?.() || "")
    .replace(/-/g, "")
    .slice(0, 16) || "a1b2c3d4e5f60718";
  return {
    token: PING_TOKEN,
    reason: "app-blur",
    locale: "de",
    theme: "dark",
    metadata: {
      device: {
        type: "Handset",
        brand: "google",
        model: "Nexus",
        name: "21081111RG",
        uniqueId,
      },
      os: {
        name: "android",
        version: "7.1.2",
        abis: ["arm64-v8a"],
        host: "android",
      },
      app: {
        platform: "android",
        version: "1.1.0",
        buildId: "97215000",
        engine: "hbc85",
        signatures: [
          "6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e",
        ],
        installer: "com.android.vending",
      },
      version: { package: "app.lokke.main", binary: "1.1.0", js: "1.1.0" },
      platform: {
        isAndroid: true,
        isIOS: false,
        isTV: false,
        isWeb: false,
        isMobile: true,
        isWebTV: false,
        isElectron: false,
      },
    },
    appFocusTime: 0,
    playerActive: false,
    playDuration: 0,
    devMode: true,
    hasAddon: true,
    castConnected: false,
    package: "app.lokke.main",
    version: "1.1.0",
    process: "app",
    firstAppStart: now - 86400000,
    lastAppStart: now,
    ipLocation: null,
    adblockEnabled: false,
    proxy: {
      supported: ["ss", "openvpn"],
      engine: "openvpn",
      ssVersion: 1,
      enabled: false,
      autoServer: true,
      id: "fi-hel",
    },
    iap: { supported: true },
  };
}

async function fetchSignatureOnce() {
  const body = JSON.stringify(buildPingPayload());
  for (const url of PING_URLS) {
    try {
      const res = await fetchWithTimeoutRetry(
        url,
        { method: "POST", headers: PING_HEADERS, body },
        2
      );
      if (!res || !res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.addonSig === "string" && data.addonSig.length) {
        return data.addonSig;
      }
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function getSignature() {
  const now = Date.now();
  if (cachedSignature && now < cachedSignatureExpiresAt) return cachedSignature;
  if (!inflightSignature) {
    inflightSignature = fetchSignatureOnce()
      .then((sig) => {
        if (sig) {
          cachedSignature = sig;
          cachedSignatureExpiresAt = Date.now() + SIGNATURE_TTL_MS;
        }
        return sig;
      })
      .finally(() => {
        inflightSignature = null;
      });
  }
  return inflightSignature;
}

function invalidateSignature() {
  cachedSignature = null;
  cachedSignatureExpiresAt = 0;
}

// Headers we must NOT forward from upstream to the client.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding", // Workers already decoded gzip/br
  "content-length",
]);

// Only these path extensions can be fetched via /p?u=... — locks the endpoint to HLS traffic.
const ALLOWED_EXTENSIONS = new Set([
  ".m3u8",
  ".ts",
  ".aac",
  ".mp3",
  ".m4s",
  ".mp4",
  ".m4a",
  ".key",
  ".vtt",
  ".webvtt",
  ".jpg",
  ".png",
]);

const REQUEST_TIMEOUT_MS = 15000;
const RETRY_ATTEMPTS = 3;

// -- helpers ---------------------------------------------------------------

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
  };
}

function pathExtension(urlString) {
  try {
    const p = new URL(urlString).pathname.toLowerCase();
    const dot = p.lastIndexOf(".");
    return dot === -1 ? "" : p.slice(dot);
  } catch {
    return "";
  }
}

function isM3U8(contentType, urlPath) {
  const ct = (contentType || "").toLowerCase();
  return (
    ct.includes("mpegurl") ||
    ct.includes("m3u8") ||
    urlPath.toLowerCase().endsWith(".m3u8")
  );
}

function proxifyUrl(absoluteUrl, workerOrigin) {
  return `${workerOrigin}/p?u=${encodeURIComponent(absoluteUrl)}`;
}

function rewriteHLS(text, baseUrl, workerOrigin) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) {
      out.push(raw);
      continue;
    }
    if (raw.startsWith("#")) {
      // Rewrite URI="..." on EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-SESSION-KEY, ...
      const rewritten = raw.replace(/URI="([^"]+)"/g, (_m, u) => {
        try {
          const abs = new URL(u, baseUrl).toString();
          return `URI="${proxifyUrl(abs, workerOrigin)}"`;
        } catch {
          return _m;
        }
      });
      out.push(rewritten);
    } else {
      // Bare URL line: a variant playlist or a media segment
      try {
        const abs = new URL(raw.trim(), baseUrl).toString();
        out.push(proxifyUrl(abs, workerOrigin));
      } catch {
        out.push(raw);
      }
    }
  }
  return out.join("\n");
}

async function fetchWithTimeoutRetry(url, init, attempts = RETRY_ATTEMPTS) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const res = await fetch(url, { ...init, signal });
      // Retry only on 5xx; 4xx propagates (bad id, gone, etc.)
      if (res.status >= 500 && i < attempts) {
        throw new Error(`upstream ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i >= attempts) break;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  throw lastErr;
}

async function resolveStream(id) {
  const body = JSON.stringify({
    language: "de",
    region: "DE",
    catalogId: "iptv",
    id,
    url: `https://vavoo.to/vavoo-iptv/play/${id}`,
    clientVersion: "3.0.2",
  });

  // Try once with the cached signature; if the upstream rejects it (401/403)
  // refresh the signature and retry once. A missing signature would yield the
  // "download VYPN" promo stream, so we only accept URLs that don't point at
  // Vavoo's promo/upsell hosts.
  for (let attempt = 0; attempt < 2; attempt++) {
    const signature = await getSignature();
    /** @type {Record<string, string>} */
    const headers = { ...RESOLVE_HEADERS };
    if (signature) headers["mediahubmx-signature"] = signature;

    const res = await fetchWithTimeoutRetry(RESOLVE_URL, {
      method: "POST",
      headers,
      body,
    });
    if (res.status === 401 || res.status === 403) {
      invalidateSignature();
      continue;
    }
    if (!res.ok) return null;

    let data;
    try {
      data = await res.json();
    } catch {
      return null;
    }
    const arr = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : null;
    const first = arr && arr[0];
    const url =
      first && typeof first.url === "string" ? first.url : null;
    if (!url) return null;
    if (isPromoUrl(url)) {
      invalidateSignature();
      continue;
    }
    return url;
  }
  return null;
}

// Recognise the upsell/promo asset Vavoo serves when it doesn't accept the
// signature ("Willst du kostenlos weiterschauen? Lade die VYPN App herunter.").
function isPromoUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("vypn") ||
      host.includes("lokke") ||
      host.includes("promo") ||
      host.includes("upsell")
    );
  } catch {
    return false;
  }
}

// Forward client's Range / conditional headers so segment seeks and byte-range playlists work.
function buildProxyHeaders(request) {
  const headers = { ...UPSTREAM_HEADERS };
  const forwardable = ["range", "if-none-match", "if-modified-since"];
  for (const name of forwardable) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  return headers;
}

async function proxy(request, targetUrl, workerOrigin) {
  const upstream = await fetchWithTimeoutRetry(targetUrl, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: buildProxyHeaders(request),
    redirect: "follow",
  });

  const finalUrl = upstream.url || targetUrl;
  const ct = upstream.headers.get("content-type") || "";
  const finalPath = (() => {
    try {
      return new URL(finalUrl).pathname;
    } catch {
      return "";
    }
  })();

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) respHeaders.set(k, v);
  }
  for (const [k, v] of Object.entries(corsHeaders())) respHeaders.set(k, v);

  if (isM3U8(ct, finalPath)) {
    const text = await upstream.text();
    const rewritten = rewriteHLS(text, finalUrl, workerOrigin);
    respHeaders.set("content-type", "application/vnd.apple.mpegurl");
    respHeaders.set("cache-control", "no-store");
    return new Response(rewritten, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

async function handle(request) {
  const url = new URL(request.url);
  const workerOrigin = `${url.protocol}//${url.host}`;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: corsHeaders(),
    });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("vavoo-iptv proxy: OK", {
      status: 200,
      headers: { "content-type": "text/plain", ...corsHeaders() },
    });
  }

  if (url.pathname.startsWith("/play/")) {
    const id = url.pathname.slice("/play/".length);
    if (!/^[a-f0-9]{8,64}$/i.test(id)) {
      return new Response("bad id", { status: 400, headers: corsHeaders() });
    }
    const resolved = await resolveStream(id);
    if (!resolved) {
      return new Response("resolve failed", {
        status: 502,
        headers: corsHeaders(),
      });
    }
    return proxy(request, resolved, workerOrigin);
  }

  if (url.pathname === "/p") {
    const raw = url.searchParams.get("u");
    if (!raw) {
      return new Response("missing u", { status: 400, headers: corsHeaders() });
    }
    let target;
    try {
      target = new URL(raw);
    } catch {
      return new Response("bad u", { status: 400, headers: corsHeaders() });
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return new Response("bad scheme", {
        status: 400,
        headers: corsHeaders(),
      });
    }
    // Lock the endpoint to HLS-adjacent assets.
    const ext = pathExtension(target.toString());
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new Response("disallowed asset", {
        status: 403,
        headers: corsHeaders(),
      });
    }
    return proxy(request, target.toString(), workerOrigin);
  }

  return new Response("not found", { status: 404, headers: corsHeaders() });
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (err) {
      const msg = err && err.message ? err.message : "unknown";
      const status = err && err.name === "TimeoutError" ? 504 : 502;
      return new Response(`proxy error: ${msg}`, {
        status,
        headers: corsHeaders(),
      });
    }
  },
};
