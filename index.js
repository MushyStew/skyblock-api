const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const cheerio = require("cheerio");

const CHANGELOG_URL = "https://hypixel-skyblock.fandom.com/wiki/Changelog";

// Fetch and parse patch notes from the wiki
async function fetchPatchNotes(limit = 30) {
  const res = await fetch(CHANGELOG_URL);
  if (!res.ok) {
    throw new Error("Failed to fetch changelog: HTTP " + res.status);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const patches = [];

  // The Changelog page uses wikitable tables for patch notes
  $("table.wikitable tbody tr").each((i, row) => {
    if (patches.length >= limit) return;

    const tds = $(row).find("td");
    // Skip header or malformed rows
    if (tds.length < 3) return;

    const rawDate = $(tds[0]).text().trim();
    const update = $(tds[1]).text().trim();
    const description = $(tds[2]).text().trim();

    let link = $(tds[1]).find("a").attr("href") || "";
    if (link && !link.startsWith("http")) {
      link = "https://hypixel-skyblock.fandom.com" + link;
    }

    patches.push({
      rawDate,
      update,
      description,
      link: link || null
    });
  });

  return patches;
}

// ---------------------- LOAD NEU ITEM DB ----------------------

let NEU_DB = {};
try {
  // Make sure items_merged.json is in the same folder as this file
  NEU_DB = JSON.parse(fs.readFileSync("./items_merged.json", "utf8"));
  console.log("Loaded NEU DB with", Object.keys(NEU_DB).length, "items");
} catch (e) {
  console.error("Failed to load NEU DB:", e);
  NEU_DB = {};
}

// Normalize user input (name/partial/name → internal ID)
function normalizeIdentifier(input) {
  if (!input) return null;
  const query = input.toLowerCase().trim();

  // 1) Direct ID match (HYPERION)
  if (NEU_DB[query.toUpperCase()]) return query.toUpperCase();

  // 2) Exact name match ("Hyperion")
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase() === query) return id;
  }

  // 3) Partial name match ("hyp" → "HYPERION")
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase().includes(query)) return id;
  }

  return null;
}

// ---------------------- SAFE FETCH WRAPPER ----------------------

async function safeJsonFetch(url, retries = 3) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      // 404 = "no data" (we treat as null, not a hard error)
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const text = await response.text();

      if (!text || text.trim().length < 2) {
        throw new Error("Empty JSON");
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      console.log(`Fetch attempt ${i + 1} failed for ${url}:`, err.toString());
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  throw lastError;
}

// ---------------------- EXPRESS SETUP ----------------------

app.use(express.static(__dirname));

// Basic test endpoint
app.get("/", (req, res) => {
  res.send("SkyBlock API is running.");
});

// ---------------------- MAIN API ENDPOINT ----------------------

app.get("/api/item", async (req, res) => {
  const rawInput = req.query.identifier;

  if (!rawInput) {
    return res.status(400).json({ error: "Missing 'identifier' query parameter" });
  }
app.get("/api/patchnotes", async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 30;

  try {
    const patches = await fetchPatchNotes(limit);
    res.json({
      source: CHANGELOG_URL,
      count: patches.length,
      patches
    });
  } catch (err) {
    console.error("Error in /api/patchnotes:", err.toString());
    res.status(500).json({ error: err.toString() });
  }
});

  // Use NEU to normalize the identifier
  const id = normalizeIdentifier(rawInput);

  if (!id) {
    return res.status(404).json({ error: "Item not found in NEU database" });
  }

  try {
    // 1) Hypixel Bazaar (official, stable endpoint, no API key required)
    let hypBazaar = await safeJsonFetch(
      "https://api.hypixel.net/v2/skyblock/bazaar"
    ).catch((err) => {
      console.error("Hypixel bazaar fetch failed:", err.toString());
      return null;
    });

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

    // 2) CoflNet Auction history (may legitimately be null)
    const history = await safeJsonFetch(
      `https://sky.coflnet.com/api/averageAuction?tag=${id}`
    ).catch((err) => {
      console.error("Auction history fetch failed:", err.toString());
      return null;
    });

    res.json({
      identifier_input: rawInput,
      normalized_id: id,
      neu: NEU_DB[id] || null,        // NEU metadata (rarity, name, etc.)
      bazaar: bazaarEntry,            // Structured bazaar data from Hypixel
      auctionHistory: history || null // null if no AH data
    });
  } catch (error) {
    console.error("Unexpected server error:", error);
    res.status(500).json({ error: error.toString() });
  }
});


// ---------------------- START SERVER ----------------------

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("SkyBlock API running on port " + PORT);
});
