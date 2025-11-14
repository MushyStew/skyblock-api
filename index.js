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
      // timeout in case CoflNet hangs
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const text = await response.text();

      // Validate non-empty JSON BEFORE parsing
      if (!text || text.trim().length < 5) {
        throw new Error("Empty or incomplete JSON");
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      console.log(`Fetch attempt ${i + 1} failed:`, err.toString());
      await new Promise(res => setTimeout(res, 300)); // small wait
    }
  }

  throw lastError;
}


// Main API endpoint
app.get("/api/item", async (req, res) => {
  const id = (req.query.identifier || "").toUpperCase().replace(/\s+/g, "_");

  try {
    const bazaar = await safeJsonFetch("https://sky.coflnet.com/api/raw/bazaar");

    let history = null;
    try {
    history = await safeJsonFetch(
      `https://sky.coflnet.com/api/averageAuction?tag=${id}`
    );

    } catch {
      history = null;
    }

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
