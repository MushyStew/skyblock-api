const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();

// Serve openapi.json
app.use(express.static(__dirname));

// Basic test endpoint
app.get("/", (req, res) => {
  res.send("SkyBlock API is running.");
});

async function safeJsonFetch(url, retries = 3) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      // If the endpoint returns 404 → item not tracked
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
      await new Promise(r => setTimeout(r, 300));
    }
  }

  throw lastError;
}



// Main API endpoint
app.get("/api/item", async (req, res) => {
  const id = (req.query.identifier || "").toUpperCase().replace(/\s+/g, "_");

  try {
    const bazaar = await safeJsonFetch("https://sky.coflnet.com/api/raw/bazaar");

  const history = await safeJsonFetch(
      `https://sky.coflnet.com/api/averageAuction?tag=${id}`
    );

    res.json({
      identifier_input: req.query.identifier,
      normalized_id: id,
      bazaar: bazaar[id] || null,
      auctionHistory: history
    });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("SkyBlock API running on port " + PORT);
});

const fs = require("fs");
let NEU_DB = {};

try {
  NEU_DB = JSON.parse(fs.readFileSync("./items_merged.json", "utf8"));
  console.log("Loaded NEU DB with", Object.keys(NEU_DB).length, "items");
} catch (e) {
  console.error("Failed to load NEU DB:", e);
}

function normalizeIdentifier(input) {
  if (!input) return null;
  const query = input.toLowerCase().trim();

  // 1) Direct ID match
  if (NEU_DB[query.toUpperCase()]) return query.toUpperCase();

  // 2) Exact name match
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase() === query) return id;
  }

  // 3) Partial match
  for (const id in NEU_DB) {
    const name = NEU_DB[id]?.displayname || NEU_DB[id]?.name || "";
    if (name.toLowerCase().includes(query)) return id;
  }

  return null;
}

