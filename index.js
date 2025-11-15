const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const app = express();

// ===============================
//   NEU ITEM DATABASE LOADING
// ===============================
let NEU_DB = {};
try {
  NEU_DB = JSON.parse(fs.readFileSync("./items_merged.json", "utf8"));
  console.log("Loaded NEU DB with", Object.keys(NEU_DB).length, "items");
} catch (e) {
  console.error("Failed to load NEU DB:", e);
  NEU_DB = {};
}

// Normalize item identifier using NEU DB
function normalizeIdentifier(input) {
  if (!input) return null;
  const query = input.toLowerCase().trim();

  // direct id match
  if (NEU_DB[query.toUpperCase()]) return query.toUpperCase();

  // exact name match
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase() === query) return id;
  }

  // partial name match
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase().includes(query)) return id;
  }

  return null;
}

// ===============================
//       SAFE JSON FETCH
// ===============================
async function safeJsonFetch(url, retries = 3) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 404) return null;
      if (!response.ok) throw new Error("HTTP " + response.status);

      const text = await response.text();
      if (!text || text.trim().length < 2) throw new Error("Empty JSON");

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      console.log(`Fetch attempt ${i + 1} failed for ${url}:`, err.toString());
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  throw lastError;
}

// ===============================
//    HYPIXEL FORUM SCRAPER
// ===============================
const SB_FORUM_BASE = "https://hypixel.net/forums/skyblock-patch-notes.158";
const SB_FORUM_ROOT = "https://hypixel.net";

// Extract patch version from title
function extractVersionFromTitle(title) {
  if (!title) return null;
  const m = title.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

// Fetch a page of patchnote threads (page 1..15)
async function fetchForumListing(page = 1) {
  const url = page === 1
    ? `${SB_FORUM_BASE}/`
    : `${SB_FORUM_BASE}/page-${page}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch forum listing: HTTP " + res.status);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const threads = [];
  const seen = new Set();

  $('a[href^="/threads/"]').each((i, el) => {
    const href = $(el).attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);

    const title = $(el).text().trim();
    if (!title) return;

    const urlFull = href.startsWith("http")
      ? href
      : SB_FORUM_ROOT + href;

    threads.push({
      title,
      url: urlFull,
      version: extractVersionFromTitle(title)
    });
  });

  return threads;
}

// Fetch full text of the patch
async function fetchPatchBody(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch patch thread: HTTP " + res.status);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  let body = $(".bbWrapper").first().text().trim();
  if (!body) body = $("#content").text().trim();

  return body || null;
}

// Search threads across multiple forum pages
async function searchPatchThreads({ search, limit = 10, pageMax = 15 }) {
  const term = (search || "").toLowerCase();
  const results = [];

  for (let page = 1; page <= pageMax && results.length < limit; page++) {
    const threads = await fetchForumListing(page);

    for (const t of threads) {
      const titleLower = t.title.toLowerCase();

      if (
        !term ||
        titleLower.includes(term) ||
        (t.version && t.version.toLowerCase().includes(term))
      ) {
        results.push(t);
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}

// ===============================
//         EXPRESS APP
// ===============================
app.use(express.static(__dirname));

// Test endpoint
app.get("/", (req, res) => {
  res.send("SkyBlock API is running.");
});


// ===============================
//        GET /api/item
// ===============================
app.get("/api/item", async (req, res) => {
  const rawInput = req.query.identifier;
  if (!rawInput) {
    return res.status(400).json({ error: "Missing 'identifier' query parameter" });
  }

  const id = normalizeIdentifier(rawInput);
  if (!id) {
    return res.status(404).json({ error: "Item not found in NEU database" });
  }

  try {
    // Hypixel official bazaar API
    let hypBazaar = await safeJsonFetch("https://api.hypixel.net/v2/skyblock/bazaar");
    let bazaarEntry = null;

    if (
      hypBazaar &&
      hypBazaar.success &&
      hypBazaar.products &&
      hypBazaar.products[id] &&
      hypBazaar.products[id].quick_status
    ) {
      const qs = hypBazaar.products[id].quick_status;
      bazaarEntry = {
        buyPrice: qs.buyPrice ?? null,
        sellPrice: qs.sellPrice ?? null,
        buyVolume: qs.buyVolume ?? null,
        sellVolume: qs.sellVolume ?? null,
        buyMovingWeek: qs.buyMovingWeek ?? null,
        sellMovingWeek: qs.sellMovingWeek ?? null,
        buyOrders: qs.buyOrders ?? null,
        sellOrders: qs.sellOrders ?? null
      };
    }

    // Auction history from CoflNet
    const history = await safeJsonFetch(
      `https://sky.coflnet.com/api/averageAuction?tag=${id}`
    );

    res.json({
      identifier_input: rawInput,
      normalized_id: id,
      neu: NEU_DB[id] || null,
      bazaar: bazaarEntry,
      auctionHistory: history || null
    });
  } catch (error) {
    console.error("Unexpected server error:", error);
    res.status(500).json({ error: error.toString() });
  }
});
// ===============================
//          HEALTH CHECK
// ===============================
app.get("/api/health", async (req, res) => {
  const report = {
    neuDB: { ok: false, count: 0, error: null },
    bazaarAPI: { ok: false, sample: null, error: null },
    patchnotes: { ok: false, sampleTitle: null, error: null },
    timestamp: new Date().toISOString()
  };

  // 1) Check NEU DB
  try {
    const keys = Object.keys(NEU_DB);
    report.neuDB.ok = keys.length > 0;
    report.neuDB.count = keys.length;
  } catch (err) {
    report.neuDB.error = err.toString();
  }

  // 2) Check Hypixel Bazaar API
  try {
    const bz = await safeJsonFetch("https://api.hypixel.net/v2/skyblock/bazaar");

    if (bz && bz.success && bz.products) {
      // pick a stable item for diagnostics
      const DIAMOND = bz.products["DIAMOND"]?.quick_status || null;
      report.bazaarAPI.ok = true;
      report.bazaarAPI.sample = DIAMOND;
    } else {
      report.bazaarAPI.error = "Unexpected response from Bazaar API";
    }
  } catch (err) {
    report.bazaarAPI.error = err.toString();
  }

  // 3) Check patchnote crawler (page 1 only)
    patchnotes.ok = "Use GPT browser tool instead";

  res.json(report);
});

// ===============================
//        START SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("SkyBlock API running on port " + PORT);
});
