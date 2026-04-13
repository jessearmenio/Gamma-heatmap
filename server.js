const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const SCHWAB_APP_KEY = process.env.SCHWAB_APP_KEY;
const SCHWAB_APP_SECRET = process.env.SCHWAB_APP_SECRET;
const SCHWAB_REDIRECT_URI = process.env.SCHWAB_REDIRECT_URI;

// Starter-only memory storage.
// Fine for initial testing, not for long-term production.
let schwabTokens = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Basic health check
app.get("/ping", (_req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

// Send user to Schwab OAuth
app.get("/login", (_req, res) => {
  if (!SCHWAB_APP_KEY || !SCHWAB_REDIRECT_URI) {
    return res.status(500).send("Missing Schwab environment variables.");
  }

  const authUrl =
    `https://api.schwabapi.com/v1/oauth/authorize?client_id=${encodeURIComponent(SCHWAB_APP_KEY)}` +
    `&redirect_uri=${encodeURIComponent(SCHWAB_REDIRECT_URI)}`;

  res.redirect(authUrl);
});

// Schwab redirects here after approval
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing authorization code.");
  }

  if (!SCHWAB_APP_KEY || !SCHWAB_APP_SECRET || !SCHWAB_REDIRECT_URI) {
    return res.status(500).send("Missing Schwab environment variables.");
  }

  try {
    const basicAuth = Buffer.from(
      `${SCHWAB_APP_KEY}:${SCHWAB_APP_SECRET}`
    ).toString("base64");

    const tokenResponse = await axios.post(
      "https://api.schwabapi.com/v1/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SCHWAB_REDIRECT_URI
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    schwabTokens = tokenResponse.data;

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Schwab connected successfully.</h2>
          <p>Access token received.</p>
          <p><a href="/heat.html">Go to Heat App</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("TOKEN EXCHANGE ERROR:");
    console.error(error.response?.data || error.message);

    res.status(500).send("Failed to exchange authorization code for token.");
  }
});

// Simple token status check
app.get("/api/token-status", (_req, res) => {
  res.json({
    connected: !!schwabTokens,
    hasAccessToken: !!schwabTokens?.access_token,
    hasRefreshToken: !!schwabTokens?.refresh_token
  });
});

// Basic quote endpoint test
app.get("/api/quotes", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token yet. Connect Schwab first."
      });
    }

    const symbols = req.query.symbols || "SPY,SPX,VIX";

    const response = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/quotes",
      {
        params: { symbols },
        headers: {
          Authorization: `Bearer ${schwabTokens.access_token}`
        },
        timeout: 30000
      }
    );

    res.json({
      ok: true,
      data: response.data
    });
  } catch (error) {
    console.error("QUOTES ERROR:");
    console.error(error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: "Failed to fetch quotes."
    });
  }
});

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getFutureISO(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function fetchChain(symbol, accessToken, overrides = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();

  // Keep the default request intentionally narrow to avoid huge payloads.
  const params = {
    symbol: normalizedSymbol,
    contractType: overrides.contractType || "ALL",
    strikeCount: overrides.strikeCount ?? 12,
    includeUnderlyingQuote: overrides.includeUnderlyingQuote ?? false,
    strategy: overrides.strategy || "SINGLE",
    fromDate: overrides.fromDate || getTodayISO(),
    toDate: overrides.toDate || getFutureISO(14)
  };

  // Optional extra filters
  if (overrides.range) params.range = overrides.range;
  if (overrides.expMonth) params.expMonth = overrides.expMonth;
  if (overrides.optionType) params.optionType = overrides.optionType;
  if (overrides.strike != null && overrides.strike !== "") {
    params.strike = overrides.strike;
  }

  return axios.get("https://api.schwabapi.com/marketdata/v1/chains", {
    params,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    timeout: 30000
  });
}

// Single-symbol options chain endpoint
app.get("/api/chain", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token yet. Connect Schwab first."
      });
    }

    const symbol = (req.query.symbol || "SPY").toUpperCase();

    const response = await fetchChain(symbol, schwabTokens.access_token, {
      contractType: req.query.contractType,
      strikeCount: req.query.strikeCount ? Number(req.query.strikeCount) : undefined,
      includeUnderlyingQuote:
        req.query.includeUnderlyingQuote === "true"
          ? true
          : req.query.includeUnderlyingQuote === "false"
            ? false
            : undefined,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      range: req.query.range,
      expMonth: req.query.expMonth,
      optionType: req.query.optionType,
      strike: req.query.strike
    });

    res.json({
      ok: true,
      symbol,
      request: response.config?.params || null,
      data: response.data
    });
  } catch (error) {
    console.error("CHAIN ERROR:");
    console.error(error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Failed to fetch options chain.",
      details: error.response?.data || error.message
    });
  }
});

// Multi-symbol chain loader for dashboard use
app.get("/api/chains", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token yet. Connect Schwab first."
      });
    }

    const rawSymbols = req.query.symbols || "SPY,SPX,VIX";
    const symbols = rawSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const strikeCount = req.query.strikeCount ? Number(req.query.strikeCount) : undefined;

    const results = {};
    const errors = {};

    for (const symbol of symbols) {
      try {
        const response = await fetchChain(symbol, schwabTokens.access_token, {
          contractType: req.query.contractType,
          strikeCount,
          includeUnderlyingQuote:
            req.query.includeUnderlyingQuote === "true"
              ? true
              : req.query.includeUnderlyingQuote === "false"
                ? false
                : undefined,
          fromDate: req.query.fromDate,
          toDate: req.query.toDate,
          range: req.query.range,
          expMonth: req.query.expMonth,
          optionType: req.query.optionType,
          strike: req.query.strike
        });

        results[symbol] = {
          request: response.config?.params || null,
          data: response.data
        };
      } catch (err) {
        console.error(`CHAIN ERROR FOR ${symbol}:`);
        console.error(err.response?.data || err.message);

        errors[symbol] = {
          status: err.response?.status || 500,
          details: err.response?.data || err.message
        };
      }
    }

    res.json({
      ok: true,
      symbols,
      results,
      errors
    });
  } catch (error) {
    console.error("CHAINS ERROR:");
    console.error(error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: "Failed to fetch options chains."
    });
  }
});

// Root route should serve heat.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "heat.html"));
});

// Catch-all fallback should also serve heat.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "heat.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});