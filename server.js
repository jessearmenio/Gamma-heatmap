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

    // Auto-redirect to dashboard — no extra click needed
    res.redirect('/heat.html');
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

// Logout — clears stored token so a fresh OAuth flow can begin
app.post("/api/logout", (_req, res) => {
  schwabTokens = null;
  res.json({ ok: true });
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

    const requestedSymbols = req.query.symbols || "SPY,SPX,VIX";
    const symbols = mapQuoteSymbolsParam(requestedSymbols);

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
      requestedSymbols,
      actualSymbols: symbols,
      data: addQuoteAliases(response.data)
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

function mapQuoteSymbol(rawSymbol) {
  const normalized = String(rawSymbol || "").trim().toUpperCase();

  if (normalized === "SPX" || normalized === "$SPX") return "$SPX";
  if (normalized === "VIX" || normalized === "$VIX") return "$VIX";
  if (normalized === "TNX" || normalized === "$TNX") return "$TNX";
  if (normalized === "DJI" || normalized === "$DJI") return "$DJI";
  if (normalized === "DXY" || normalized === "$DXY" || normalized === "$NYICDX") return "$NYICDX";

  return normalized;
}

function mapQuoteSymbolsParam(rawSymbols) {
  return String(rawSymbols || "")
    .split(",")
    .map(sym => sym.trim())
    .filter(Boolean)
    .map(mapQuoteSymbol)
    .join(",");
}

function addQuoteAliases(data) {
  if (!data || typeof data !== "object") return data;

  const out = { ...data };

  const aliasPairs = [
    ["$SPX", "SPX"],
    ["$VIX", "VIX"],
    ["$TNX", "TNX"],
    ["$DJI", "DJI"],
    ["$NYICDX", "DXY"]
  ];

  for (const [canonical, alias] of aliasPairs) {
    if (out[canonical] && !out[alias]) out[alias] = out[canonical];
    if (out[alias] && !out[canonical]) out[canonical] = out[alias];
  }

  return out;
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
        params: { symbols: mapQuoteSymbolsParam("SPY,SPX,VIX") },
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

// ─── Movers ───────────────────────────────────────────────────────────────────
// GET /api/movers?index=$SPX|$COMPX|$DJI&sort=VOLUME|TRADES|PERCENT_CHANGE_UP|PERCENT_CHANGE_DOWN&frequency=0|1|5|10|30|60
app.get("/api/movers", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet. Connect Schwab first." });
    }
    const index = req.query.index || "$SPX";
    const sort = req.query.sort || "PERCENT_CHANGE_UP";
    const frequency = req.query.frequency || "0";

    const response = await axios.get(
      `https://api.schwabapi.com/marketdata/v1/movers/${encodeURIComponent(index)}`,
      {
        params: { sort, frequency },
        headers: { Authorization: `Bearer ${schwabTokens.access_token}` },
        timeout: 30000
      }
    );

    // Normalise movers array (Schwab returns either array or {screeners:[...]})
    const movers = Array.isArray(response.data)
      ? response.data
      : (response.data?.screeners || []);

    // Enrich with real per-symbol volume + price from quotes endpoint
    if (movers.length) {
      const symbols = movers.map(m => m.symbol).filter(Boolean).join(',');
      try {
        const qRes = await axios.get(
          'https://api.schwabapi.com/marketdata/v1/quotes',
          { params: { symbols, fields: 'quote' }, headers: { Authorization: `Bearer ${schwabTokens.access_token}` }, timeout: 15000 }
        );
        const qData = qRes.data || {};
        movers.forEach(m => {
          const qt = qData[m.symbol]?.quote || {};
          // Overwrite with accurate quote fields
          if (qt.totalVolume != null) m.totalVolume = qt.totalVolume;
          if (qt.lastPrice != null) m.lastPrice = qt.lastPrice;
          if (qt.netPercentChange != null) m.netPercentChange = qt.netPercentChange;
          if (qt.netChange != null) m.netChange = qt.netChange;
        });
      } catch (qErr) {
        console.warn('MOVERS quotes enrich failed:', qErr.message);
      }
    }

    res.json({ ok: true, data: movers });
  } catch (error) {
    console.error("MOVERS ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to fetch movers.",
      details: error.response?.data || error.message
    });
  }
});

// ─── Price History ─────────────────────────────────────────────────────────────
// GET /api/pricehistory?symbol=SPY&periodType=day&period=5&frequencyType=minute&frequency=5
app.get("/api/pricehistory", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet." });
    }
    const symbol = (req.query.symbol || "SPY").toUpperCase();
    const params = {
      symbol,
      periodType: req.query.periodType || "day",
      period: req.query.period || "5",
      frequencyType: req.query.frequencyType || "minute",
      frequency: req.query.frequency || "5",
      needExtendedHoursData: req.query.needExtendedHoursData === 'true' || req.query.needExtendedHoursData === true
    };
    if (req.query.startDate) params.startDate = req.query.startDate;
    if (req.query.endDate) params.endDate = req.query.endDate;

    const response = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/pricehistory",
      { params, headers: { Authorization: `Bearer ${schwabTokens.access_token}` }, timeout: 30000 }
    );
    res.json({ ok: true, data: response.data });
  } catch (error) {
    console.error("PRICEHISTORY ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to fetch price history.",
      details: error.response?.data || error.message
    });
  }
});

// ─── Instruments ───────────────────────────────────────────────────────────────
// GET /api/instruments?symbol=AAPL&projection=fundamental|desc-search|desc-regex|search|symbol-search|symbol-regex
app.get("/api/instruments", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet." });
    }
    const symbol = req.query.symbol || "AAPL";
    const projection = req.query.projection || "fundamental";
    const response = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/instruments",
      {
        params: { symbol, projection },
        headers: { Authorization: `Bearer ${schwabTokens.access_token}` },
        timeout: 30000
      }
    );
    res.json({ ok: true, data: response.data });
  } catch (error) {
    console.error("INSTRUMENTS ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to fetch instruments.",
      details: error.response?.data || error.message
    });
  }
});

// ─── Market Hours ─────────────────────────────────────────────────────────────
// GET /api/markets?markets=equity,option,bond,future,forex
app.get("/api/markets", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet." });
    }
    const markets = req.query.markets || "equity,option,future,forex";
    const date = req.query.date || getTodayISO();
    const response = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/markets",
      {
        params: { markets, date },
        headers: { Authorization: `Bearer ${schwabTokens.access_token}` },
        timeout: 30000
      }
    );
    res.json({ ok: true, data: response.data });
  } catch (error) {
    console.error("MARKETS ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to fetch market hours.",
      details: error.response?.data || error.message
    });
  }
});

// ─── Expiration Chain ─────────────────────────────────────────────────────────
// GET /api/expirationchain?symbol=SPY
app.get("/api/expirationchain", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet." });
    }
    const symbol = (req.query.symbol || "SPY").toUpperCase();
    const normalizedSymbol = mapChainSymbol(symbol);
    const response = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/expirationchain",
      {
        params: { symbol: normalizedSymbol },
        headers: { Authorization: `Bearer ${schwabTokens.access_token}` },
        timeout: 30000
      }
    );
    res.json({ ok: true, data: response.data });
  } catch (error) {
    console.error("EXPIRATIONCHAIN ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to fetch expiration chain.",
      details: error.response?.data || error.message
    });
  }
});


// ─── Market Overview (Scoring Engine) ──────────────────────────────────────
// GET /api/marketoverview
// Fetches: quotes for SPY,QQQ,$VIX,$TNX,UUP,TLT + all 11 sector ETFs
// Fetches: pricehistory (1yr daily) for SPY, QQQ, $VIX, $TNX, UUP, TLT + 11 sectors
// Fetches: movers for $SPX
// All via Schwab. No Polygon or Twelve Data.
app.get("/api/marketoverview", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token yet. Connect Schwab first." });
    }
    const token = schwabTokens.access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const timeout = 30000;
    const base = "https://api.schwabapi.com/marketdata/v1";

    // Symbols needed
    const quoteSymbols = "SPY,QQQ,$VIX,$TNX,UUP,TLT,XLE,XLF,XLK,XLI,XLC,XLY,XLV,XLRE,XLP,XLB,XLU";
    const histSymbols = ["SPY", "QQQ", "$VIX", "$TNX", "UUP", "TLT", "XLE", "XLF", "XLK", "XLI", "XLC", "XLY", "XLV", "XLRE", "XLP", "XLB", "XLU"];

    // Fetch all in parallel
    const [quotesRes, moversRes, ...histResponses] = await Promise.all([
      axios.get(`${base}/quotes`, { params: { symbols: quoteSymbols }, headers, timeout }),
      axios.get(`${base}/movers/${encodeURIComponent("$SPX")}`, { params: { sort: "PERCENT_CHANGE_UP", frequency: "0" }, headers, timeout }).catch(() => ({ data: [] })),
      ...histSymbols.map(sym =>
        axios.get(`${base}/pricehistory`, {
          params: { symbol: sym, periodType: "year", period: "1", frequencyType: "daily", frequency: "1" },
          headers, timeout
        }).then(r => ({ sym, candles: r.data?.candles || [] }))
          .catch(() => ({ sym, candles: [] }))
      )
    ]);

    const quotes = quotesRes.data || {};
    const movers = Array.isArray(moversRes.data) ? moversRes.data : (moversRes.data?.screeners || []);

    // Build history map: sym -> candles[]
    const histMap = {};
    histResponses.forEach(({ sym, candles }) => { histMap[sym] = candles; });

    // Append a synthetic today-candle for SPY so the chart price axis reaches today's price.
    // The 1-year daily history only contains completed trading days — today's move is missing
    // until market close, causing the chart and GEX overlay to be stuck at yesterday's range.
    const spyQuote = quotes['SPY']?.quote || {};
    const spyLast = spyQuote.lastPrice ?? spyQuote.mark ?? spyQuote.closePrice;
    if (spyLast && histMap['SPY']?.length) {
      const todayMs = new Date().setHours(0, 0, 0, 0);
      const lastCandle = histMap['SPY'][histMap['SPY'].length - 1];
      // Only add if last candle is from a prior day (avoid duplicating on weekend/holiday)
      if (!lastCandle || lastCandle.datetime < todayMs) {
        const open = spyQuote.openPrice ?? spyLast;
        const high = spyQuote.highPrice ?? spyLast;
        const low = spyQuote.lowPrice ?? spyLast;
        histMap['SPY'].push({
          datetime: todayMs,
          open, high, low,
          close: spyLast,
          volume: spyQuote.totalVolume ?? 0
        });
      } else {
        // Update the existing today candle with the latest price
        lastCandle.close = spyLast;
        if (spyQuote.highPrice) lastCandle.high = Math.max(lastCandle.high, spyQuote.highPrice);
        if (spyQuote.lowPrice) lastCandle.low = Math.min(lastCandle.low, spyQuote.lowPrice);
      }
    }

    res.json({ ok: true, quotes, movers, histMap });
  } catch (error) {
    console.error("MARKETOVERVIEW ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to load market overview.",
      details: error.response?.data || error.message
    });
  }
});

// Root route — serve dashboard
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "heat.html"));
});

// Catch-all fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "heat.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});