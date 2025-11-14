const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();

// ---------------------- NEU ITEM DB LOADING ----------------------

let NEU_DB = {};
try {
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
      // timeout to avoid hanging requests
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      // 404 means "no data available" (not a hard error)
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
      console.log(`Fetch attempt ${i + 1} failed:`, err.toString());
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

// Main API endpoint
app.get("/api/item", async (req, res) => {
  const rawInput = req.query.identifier;

  if (!rawInput) {
    return res.status(400).json({ error: "Missing 'identifier' query parameter" });
  }

  // 🔹 Use NEU to normalize the identifier (this was missing before)
  const id = normalizeIdentifier(rawInput);

  if (!id) {
    return res.status(404).json({ error: "Item not found in NEU database" });
  }

  try {
    // CoflNet bazaar snapshot (may be null if endpoint fails or item is not bazaar-tracked)
    const bazaarAll = await safeJsonFetch("https://sky.coflnet.com/api/raw/bazaar").catch(
      () => null
    );

    // CoflNet auction average (may be null for many items)
    const history = await safeJsonFetch(
      `https://sky.coflnet.com/api/averageAuction?tag=${id}`
    ).catch(() => null);

    // 🔹 Guard against bazaarAll being null
    const bazaarEntry = bazaarAll && bazaarAll[id] ? bazaarAll[id] : null;

    r
