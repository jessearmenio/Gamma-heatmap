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

// Quotes
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

function mapChainSymbol(rawSymbol) {
  const normalized = String(rawSymbol || "").trim().toUpperCase();

  if (normalized === "SPX") return "$SPX";
  if (normalized === "VIX") return "$VIX";

  return normalized;
}

async function fetchChain(symbol, accessToken, overrides = {}) {
  const normalizedSymbol = mapChainSymbol(symbol);

  const params = {
    symbol: normalizedSymbol,
    contractType: overrides.contractType || "ALL",
    strikeCount: overrides.strikeCount ?? 12,
    includeUnderlyingQuote: overrides.includeUnderlyingQuote ?? false,
    strategy: overrides.strategy || "SINGLE",
    fromDate: overrides.fromDate || getTodayISO(),
    toDate: overrides.toDate || getFutureISO(14)
  };

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

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const actualSymbol = mapChainSymbol(requestedSymbol);

    const response = await fetchChain(requestedSymbol, schwabTokens.access_token, {
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
      requestedSymbol,
      actualSymbol,
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

function flattenExpDateMap(expDateMap, side) {
  const rows = [];

  if (!expDateMap || typeof expDateMap !== "object") {
    return rows;
  }

  for (const expKey of Object.keys(expDateMap)) {
    const strikesObj = expDateMap[expKey];
    if (!strikesObj || typeof strikesObj !== "object") continue;

    for (const strikeKey of Object.keys(strikesObj)) {
      const contracts = strikesObj[strikeKey];
      if (!Array.isArray(contracts)) continue;

      for (const contract of contracts) {
        const strike = Number(contract.strikePrice ?? strikeKey);
        const gamma = Number(contract.gamma ?? 0);
        const openInterest = Number(contract.openInterest ?? 0);
        const daysToExpiration = Number(contract.daysToExpiration ?? 0);

        rows.push({
          side,
          expKey,
          strike,
          gamma,
          openInterest,
          daysToExpiration,
          symbol: contract.symbol,
          inTheMoney: !!contract.inTheMoney
        });
      }
    }
  }

  return rows;
}

function sortExpKeys(expKeys) {
  return [...expKeys].sort((a, b) => {
    const aDate = a.split(":")[0];
    const bDate = b.split(":")[0];
    return new Date(aDate) - new Date(bDate);
  });
}

function buildHeatFromChain(chain) {
  const underlyingPrice = Number(chain.underlyingPrice ?? 0);

  const calls = flattenExpDateMap(chain.callExpDateMap, "CALL");
  const puts = flattenExpDateMap(chain.putExpDateMap, "PUT");
  const allRows = [...calls, ...puts];

  const byStrike = new Map();
  const byCell = new Map();
  const expSet = new Set();

  for (const row of allRows) {
    expSet.add(row.expKey);

    if (!byStrike.has(row.strike)) {
      byStrike.set(row.strike, {
        strike: row.strike,
        callOpenInterest: 0,
        putOpenInterest: 0,
        callGammaSum: 0,
        putGammaSum: 0,
        callGex: 0,
        putGex: 0,
        netGex: 0
      });
    }

    const strikeBucket = byStrike.get(row.strike);
    const cellKey = `${row.expKey}|${row.strike}`;

    if (!byCell.has(cellKey)) {
      byCell.set(cellKey, {
        expKey: row.expKey,
        strike: row.strike,
        callGex: 0,
        putGex: 0,
        netGex: 0
      });
    }

    const cell = byCell.get(cellKey);
    const gex = row.gamma * row.openInterest * 100;

    if (row.side === "CALL") {
      strikeBucket.callOpenInterest += row.openInterest;
      strikeBucket.callGammaSum += row.gamma;
      strikeBucket.callGex += gex;

      cell.callGex += gex;
    } else {
      strikeBucket.putOpenInterest += row.openInterest;
      strikeBucket.putGammaSum += row.gamma;
      strikeBucket.putGex -= gex;

      cell.putGex -= gex;
    }

    strikeBucket.netGex = strikeBucket.callGex + strikeBucket.putGex;
    cell.netGex = cell.callGex + cell.putGex;
  }

  const expirations = sortExpKeys([...expSet]);
  const strikes = Array.from(byStrike.values()).sort((a, b) => b.strike - a.strike);

  const matrix = strikes.map((strikeRow) => {
    const cells = expirations.map((expKey) => {
      const found = byCell.get(`${expKey}|${strikeRow.strike}`);
      return found || {
        expKey,
        strike: strikeRow.strike,
        callGex: 0,
        putGex: 0,
        netGex: 0
      };
    });

    return {
      strike: strikeRow.strike,
      rowNetGex: strikeRow.netGex,
      cells
    };
  });

  const strongestCallWall =
    [...strikes].sort((a, b) => b.callOpenInterest - a.callOpenInterest)[0] || null;
  const strongestPutWall =
    [...strikes].sort((a, b) => b.putOpenInterest - a.putOpenInterest)[0] || null;
  const strongestPositiveGex =
    [...strikes].sort((a, b) => b.netGex - a.netGex)[0] || null;
  const strongestNegativeGex =
    [...strikes].sort((a, b) => a.netGex - b.netGex)[0] || null;

  const allCells = matrix.flatMap((row) => row.cells);
  const kingCell =
    [...allCells].sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))[0] || null;

  const kingStrike = kingCell
    ? strikes.find((row) => row.strike === kingCell.strike) || null
    : null;

  return {
    underlyingPrice,
    contractCount: allRows.length,
    expirations,
    summary: {
      strongestCallWall,
      strongestPutWall,
      strongestPositiveGex,
      strongestNegativeGex,
      kingStrike,
      kingCell
    },
    strikes,
    matrix
  };
}

app.get("/api/heat", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token yet. Connect Schwab first."
      });
    }

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const actualSymbol = mapChainSymbol(requestedSymbol);

    const response = await fetchChain(requestedSymbol, schwabTokens.access_token, {
      contractType: req.query.contractType,
      strikeCount: req.query.strikeCount ? Number(req.query.strikeCount) : 12,
      includeUnderlyingQuote: false,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      range: req.query.range,
      expMonth: req.query.expMonth,
      optionType: req.query.optionType,
      strike: req.query.strike
    });

    const chain = response.data || {};
    const heat = buildHeatFromChain(chain);

    res.json({
      ok: true,
      requestedSymbol,
      actualSymbol,
      request: response.config?.params || null,
      ...heat
    });
  } catch (error) {
    console.error("HEAT ERROR:");
    console.error(error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Failed to build heat data.",
      details: error.response?.data || error.message
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token yet. Connect Schwab first."
      });
    }

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const strikeCount = req.query.strikeCount ? Number(req.query.strikeCount) : 12;
    const fromDate = req.query.fromDate || getTodayISO();
    const toDate = req.query.toDate || getFutureISO(10);

    const [quotesResponse, chainResponse] = await Promise.all([
      axios.get("https://api.schwabapi.com/marketdata/v1/quotes", {
        params: { symbols: "SPY,SPX,VIX" },
        headers: {
          Authorization: `Bearer ${schwabTokens.access_token}`
        },
        timeout: 30000
      }),
      fetchChain(requestedSymbol, schwabTokens.access_token, {
        strikeCount,
        fromDate,
        toDate,
        includeUnderlyingQuote: false
      })
    ]);

    const heat = buildHeatFromChain(chainResponse.data || {});

    res.json({
      ok: true,
      quotes: quotesResponse.data,
      heat: {
        requestedSymbol,
        actualSymbol: mapChainSymbol(requestedSymbol),
        request: chainResponse.config?.params || null,
        ...heat
      }
    });
  } catch (error) {
    console.error("DASHBOARD ERROR:");
    console.error(error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Failed to load dashboard data.",
      details: error.response?.data || error.message
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