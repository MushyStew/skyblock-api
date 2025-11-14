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

// Main API endpoint
app.get("/api/item", async (req, res) => {
  const id = (req.query.identifier || "").toUpperCase().replace(/\s+/g, "_");

  try {
    const bazaarResp = await fetch("https://sky.coflnet.com/api/raw/bazaar");
    const bazaar = await bazaarResp.json();

    let history = null;
    try {
      const histResp = await fetch(
        `https://sky.coflnet.com/api/averageAuction?tag=${id}`
      );
      history = await histResp.json();
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
