const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const path = require("path");
const fs = require("fs/promises");
const { createClient } = require("@libsql/client");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const SCHWAB_APP_KEY = process.env.SCHWAB_APP_KEY;
const SCHWAB_APP_SECRET = process.env.SCHWAB_APP_SECRET;
const SCHWAB_REDIRECT_URI = process.env.SCHWAB_REDIRECT_URI;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FEAR_GREED_API_KEY = process.env.FEAR_GREED_API_KEY;
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const turso = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

const FINNHUB_TOP_100_SP500 = [
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK.B", "LLY", "AVGO",
  "JPM", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "NFLX", "MRK",
  "ABBV", "CVX", "KO", "ADBE", "PEP", "BAC", "AMD", "TMO", "WMT", "CSCO",
  "MCD", "CRM", "ACN", "LIN", "DHR", "ABT", "WFC", "INTU", "TXN", "QCOM",
  "PM", "DIS", "IBM", "AMGN", "GE", "NOW", "CAT", "GS", "RTX", "ISRG",
  "BLK", "BKNG", "SPGI", "AXP", "PLD", "SYK", "T", "LOW", "PGR", "UNP",
  "HON", "TJX", "VRTX", "MDT", "SCHW", "C", "ELV", "LMT", "DE", "ADP",
  "GILD", "MMC", "ADI", "ETN", "REGN", "MO", "CB", "SO", "ZTS", "CI",
  "BSX", "DUK", "ICE", "BDX", "CL", "CSX", "PYPL", "ITW", "WM", "EOG",
  "PNC", "APD", "SHW", "MPC", "HCA", "AON", "MS", "FDX", "MAR", "SNPS"
];

async function initTurso() {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
    console.warn("Turso env vars missing. ETF history storage disabled.");
    return;
  }

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS etf_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      price REAL,
      change_pct REAL,
      volume REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, trade_date)
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS spy_daily_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL UNIQUE,
      high REAL,
      low REAL,
      close REAL,
      change_pct REAL,
      volume REAL,
      volume_30d_ratio REAL,
      total_oi REAL,
      oi_change_pct REAL,
      call_oi REAL,
      put_oi REAL,
      ivr REAL,
      vol_30d REAL,
      impl_30d REAL,
      vol_60d REAL,
      impl_60d REAL,
      net_prem REAL,
      total_prem REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Turso SPY daily history table ready.");

  console.log("Turso ETF history table ready.");
}

async function saveEtfSnapshot({ symbol, price, changePct, volume }) {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) return;

  const tradeDate = getCstDateKey();

  await turso.execute({
    sql: `
      INSERT INTO etf_history (
        symbol,
        trade_date,
        price,
        change_pct,
        volume,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(symbol, trade_date)
      DO UPDATE SET
        price = excluded.price,
        change_pct = excluded.change_pct,
        volume = excluded.volume,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      symbol,
      tradeDate,
      Number.isFinite(Number(price)) ? Number(price) : null,
      Number.isFinite(Number(changePct)) ? Number(changePct) : null,
      Number.isFinite(Number(volume)) ? Number(volume) : null
    ]
  });
}

async function saveSpyDailySnapshot(row) {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) return;

  await turso.execute({
    sql: `
      INSERT INTO spy_daily_history (
        trade_date,
        high,
        low,
        close,
        change_pct,
        volume,
        volume_30d_ratio,
        total_oi,
        oi_change_pct,
        call_oi,
        put_oi,
        ivr,
        vol_30d,
        impl_30d,
        vol_60d,
        impl_60d,
        net_prem,
        total_prem,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(trade_date)
      DO UPDATE SET
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        change_pct = excluded.change_pct,
        volume = excluded.volume,
        volume_30d_ratio = excluded.volume_30d_ratio,
        total_oi = excluded.total_oi,
        oi_change_pct = excluded.oi_change_pct,
        call_oi = excluded.call_oi,
        put_oi = excluded.put_oi,
        ivr = excluded.ivr,
        vol_30d = excluded.vol_30d,
        impl_30d = excluded.impl_30d,
        vol_60d = excluded.vol_60d,
        impl_60d = excluded.impl_60d,
        net_prem = excluded.net_prem,
        total_prem = excluded.total_prem,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      row.tradeDate,
      row.high,
      row.low,
      row.close,
      row.changePct,
      row.volume,
      row.volume30dRatio,
      row.totalOi,
      row.oiChangePct,
      row.callOi,
      row.putOi,
      row.ivr,
      row.vol30d,
      row.impl30d,
      row.vol60d,
      row.impl60d,
      row.netPrem,
      row.totalPrem
    ].map(v => Number.isFinite(Number(v)) ? Number(v) : v ?? null)
  });
}

initTurso().catch(err => {
  console.error("TURSO INIT ERROR:", err.message);
});

// Starter-only memory storage.
let schwabTokens = null;

// Refresh token after login
async function refreshSchwabAccessToken() {
  if (!schwabTokens?.refresh_token) {
    throw new Error("No refresh token available.");
  }

  if (!SCHWAB_APP_KEY || !SCHWAB_APP_SECRET) {
    throw new Error("Missing Schwab app credentials.");
  }

  const basicAuth = Buffer.from(
    `${SCHWAB_APP_KEY}:${SCHWAB_APP_SECRET}`
  ).toString("base64");

  const tokenResponse = await axios.post(
    "https://api.schwabapi.com/v1/oauth/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: schwabTokens.refresh_token
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 30000
    }
  );

  schwabTokens = {
    ...schwabTokens,
    ...tokenResponse.data
  };

  return schwabTokens.access_token;
}

async function schwabGet(url, config = {}) {
  if (!schwabTokens?.access_token) {
    throw new Error("No access token found.");
  }

  try {
    return await axios.get(url, {
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${schwabTokens.access_token}`
      }
    });
  } catch (error) {
    const status = error.response?.status;

    if (status === 401 && schwabTokens?.refresh_token) {
      await refreshSchwabAccessToken();

      return await axios.get(url, {
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${schwabTokens.access_token}`
        }
      });
    }

    throw error;
  }
}

// Fear & Greed cache
let fearGreedCache = {
  data: null,
  fetchedAt: 0,
  fetchedDateCst: null,
  fetchedSlot: null
};

function getCstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  }).formatToParts(date);

  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

function getCstDateKey(date = new Date()) {
  const p = getCstParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function getFearGreedSlot(date = new Date()) {
  const p = getCstParts(date);
  const weekday = p.weekday;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const nowMinutes = hour * 60 + minute;

  // No scheduled pulls on weekends
  if (weekday === "Sat" || weekday === "Sun") return null;

  const slots = [
    { key: "08:30", minutes: 8 * 60 + 30 },
    { key: "10:00", minutes: 10 * 60 + 0 },
    { key: "11:30", minutes: 11 * 60 + 30 },
    { key: "13:00", minutes: 13 * 60 + 0 },
    { key: "14:00", minutes: 14 * 60 + 0 },
    { key: "15:00", minutes: 15 * 60 + 0 },
    { key: "16:00", minutes: 16 * 60 + 0 }
  ];

  let activeSlot = null;
  for (const slot of slots) {
    if (nowMinutes >= slot.minutes) activeSlot = slot.key;
  }
  return activeSlot;
}

function shouldRefreshFearGreedCache() {
  const todayCst = getCstDateKey();
  const activeSlot = getFearGreedSlot();

  if (!activeSlot) return false; // before first slot or weekend
  if (!fearGreedCache.data) return true;
  if (fearGreedCache.fetchedDateCst !== todayCst) return true;
  if (fearGreedCache.fetchedSlot !== activeSlot) return true;

  return false;
}

async function fetchFearGreedFromRapidApi() {
  if (!FEAR_GREED_API_KEY) {
    throw new Error("Missing FEAR_GREED_API_KEY.");
  }

  const response = await axios.get(
    "https://fear-and-greed-index-api.p.rapidapi.com/index",
    {
      headers: {
        "x-rapidapi-key": FEAR_GREED_API_KEY,
        "x-rapidapi-host": "fear-and-greed-index-api.p.rapidapi.com",
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  const payload = response.data || {};
  const activeSlot = getFearGreedSlot();
  const todayCst = getCstDateKey();

  fearGreedCache = {
    data: payload,
    fetchedAt: Date.now(),
    fetchedDateCst: todayCst,
    fetchedSlot: activeSlot
  };

  return fearGreedCache;
}

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

app.get("/api/fear-greed", async (_req, res) => {
  try {
    if (shouldRefreshFearGreedCache()) {
      await fetchFearGreedFromRapidApi();
    }

    const activeSlot = getFearGreedSlot();

    res.json({
      ok: true,
      data: fearGreedCache.data,
      cache: {
        fetchedAt: fearGreedCache.fetchedAt,
        fetchedDateCst: fearGreedCache.fetchedDateCst,
        fetchedSlot: fearGreedCache.fetchedSlot,
        activeSlot
      }
    });
  } catch (error) {
    console.error("FEAR_GREED ERROR:", error.response?.data || error.message);

    // Return stale cache if available instead of hard failing
    if (fearGreedCache.data) {
      return res.json({
        ok: true,
        data: fearGreedCache.data,
        cache: {
          fetchedAt: fearGreedCache.fetchedAt,
          fetchedDateCst: fearGreedCache.fetchedDateCst,
          fetchedSlot: fearGreedCache.fetchedSlot,
          activeSlot: getFearGreedSlot(),
          stale: true
        }
      });
    }

    res.status(500).json({
      ok: false,
      error: "Failed to fetch fear and greed index.",
      details: error.response?.data || error.message
    });
  }
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
        error: "No access token found. Try to reconnect."
      });
    }

    const requestedSymbols = req.query.symbols || "SPY,SPX,VIX";
    const symbols = mapQuoteSymbolsParam(requestedSymbols);

    const response = await schwabGet(
      "https://api.schwabapi.com/marketdata/v1/quotes",
      {
        params: { symbols },
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

function quarterLabel(year, quarter) {
  return `${year} Q${quarter}`;
}

function pctBeatMiss(actual, estimate) {
  const a = Number(actual);
  const e = Number(estimate);
  if (!Number.isFinite(a) || !Number.isFinite(e) || e === 0) return null;
  return ((a - e) / Math.abs(e)) * 100;
}

function formatHourLabel(hour) {
  if (hour === "amc") return "After-Hours";
  if (hour === "bmo") return "Pre-Market";
  return "Time Not Specified";
}

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

async function fetchChain(symbol, overrides = {}) {
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

  return schwabGet("https://api.schwabapi.com/marketdata/v1/chains", {
    params,
    timeout: 30000
  });
}

// Single-symbol options chain endpoint
app.get("/api/chain", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token found. Connect Schwab first."
      });
    }

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const actualSymbol = mapChainSymbol(requestedSymbol);

    const response = await fetchChain(requestedSymbol, {
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
        error: "No access token found. Try to reconnect."
      });
    }

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const actualSymbol = mapChainSymbol(requestedSymbol);

    const response = await fetchChain(requestedSymbol, {
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

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map(v => v.trim());
}

function normalizeIsoDate(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  // Already ISO: YYYY-MM-DD
  const isoMatch = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(Number(isoMatch[2])).padStart(2, "0");
    const d = String(Number(isoMatch[3])).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // M/D/YY or M/D/YYYY (US format used in earnings_calendar.csv)
  const slashMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const month = String(Number(slashMatch[1])).padStart(2, "0");
    const day = String(Number(slashMatch[2])).padStart(2, "0");
    let year = slashMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  return "";
}

function quarterFromFiscalDate(fiscalDateEnding) {
  const iso = normalizeIsoDate(fiscalDateEnding);
  if (!iso) return { year: null, quarter: null };

  const [yearStr, monthStr] = iso.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { year: null, quarter: null };
  }

  let quarter = null;
  if (month <= 3) quarter = 1;
  else if (month <= 6) quarter = 2;
  else if (month <= 9) quarter = 3;
  else quarter = 4;

  return { year, quarter };
}

function formatReportingLabel(timeOfTheDay) {
  const v = String(timeOfTheDay || "").trim().toLowerCase();

  if (v === "pre-market" || v === "premarket" || v === "bmo") return "Pre-Market";
  if (v === "post-market" || v === "postmarket" || v === "amc") return "Post-Market";

  return "Time Not Specified";
}

app.get("/api/earnings-calendar", async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Missing from/to date range."
      });
    }

    const csvPath = path.join(__dirname, "earnings_calendar.csv");
    const csvText = await fs.readFile(csvPath, "utf8");

    const lines = csvText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return res.json({
        ok: true,
        from,
        to,
        count: 0,
        events: []
      });
    }

    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const events = lines.slice(1).map(line => {
      const cols = parseCsvLine(line);

      const symbol = cols[idx.symbol] || "";
      const name = cols[idx.name] || "";
      const reportDateRaw = cols[idx.reportDate] || "";
      const fiscalDateEndingRaw = cols[idx.fiscalDateEnding] || "";
      const estimate = cols[idx.estimate] || "";
      const currency = cols[idx.currency] || "";
      const timeOfTheDay = cols[idx.timeOfTheDay] || "";
      const sector = idx.sector != null ? (cols[idx.sector] || "") : "";

      const reportDate = normalizeIsoDate(reportDateRaw);
      const fiscalDateEnding = normalizeIsoDate(fiscalDateEndingRaw);

      const q = quarterFromFiscalDate(fiscalDateEnding);

      return {
        type: "EARNINGS",
        color: "earnings",
        symbol,
        name,
        title: `${name || symbol} earnings`,
        releaseDate: reportDate,
        reportDate,
        fiscalDateEnding,
        year: q.year,
        quarter: q.quarter,
        estimate: estimate === "" ? null : Number(estimate),
        currency,
        timeOfTheDay,
        sector,
        releaseLabel: formatReportingLabel(timeOfTheDay)
      };
    }).filter(ev =>
      ev.symbol &&
      ev.releaseDate &&
      ev.releaseDate >= from &&
      ev.releaseDate <= to
    );

    res.json({
      ok: true,
      from,
      to,
      count: events.length,
      events
    });
  } catch (error) {
    console.error("EARNINGS CALENDAR CSV ERROR:");
    console.error(error?.message || error);

    res.status(500).json({
      ok: false,
      error: "Failed to load earnings calendar CSV."
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token found. Try to reconnect."
      });
    }

    const requestedSymbol = (req.query.symbol || "SPY").toUpperCase();
    const strikeCount = req.query.strikeCount ? Number(req.query.strikeCount) : 12;
    const fromDate = req.query.fromDate || getTodayISO();
    const toDate = req.query.toDate || getFutureISO(10);

    const [quotesResponse, chainResponse] = await Promise.all([
      schwabGet("https://api.schwabapi.com/marketdata/v1/quotes", {
        params: { symbols: mapQuoteSymbolsParam("SPY,SPX,VIX") },
        timeout: 30000
      }),
      fetchChain(requestedSymbol, {
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
      return res.status(401).json({ ok: false, error: "No access token found. Try to reconnect." });
    }
    const index = req.query.index || "$SPX";
    const sort = req.query.sort || "PERCENT_CHANGE_UP";
    const frequency = req.query.frequency || "0";

    const response = await schwabGet(
      `https://api.schwabapi.com/marketdata/v1/movers/${encodeURIComponent(index)}`,
      {
        params: { sort, frequency },
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
        const qRes = await schwabGet(
          'https://api.schwabapi.com/marketdata/v1/quotes',
          { params: { symbols, fields: 'quote' }, timeout: 15000 }
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

    const response = await schwabGet(
      "https://api.schwabapi.com/marketdata/v1/pricehistory",
      { params, timeout: 30000 }
    );
    const candles = response.data?.candles || [];

    const cleaned = candles.filter(c =>
      c.open && c.high && c.low && c.close &&
      c.low > 0 && c.high > 0
    );

    res.json({ ok: true, data: { ...response.data, candles: cleaned } });
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
    const response = await schwabGet(
      "https://api.schwabapi.com/marketdata/v1/instruments",
      {
        params: { symbol, projection },
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
    const response = await schwabGet(
      "https://api.schwabapi.com/marketdata/v1/markets",
      {
        params: { markets, date },
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
    const response = await schwabGet(
      "https://api.schwabapi.com/marketdata/v1/expirationchain",
      {
        params: { symbol: normalizedSymbol },
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
      return res.status(401).json({ ok: false, error: "No access token found. Try to reconnect." });
    }
    const timeout = 30000;
    const base = "https://api.schwabapi.com/marketdata/v1";

    // Symbols needed
    const quoteSymbols = "SPY,QQQ,$VIX,$TNX,UUP,TLT,XLE,XLF,XLK,XLI,XLC,XLY,XLV,XLRE,XLP,XLB,XLU";
    const histSymbols = ["SPY", "QQQ", "$VIX", "$TNX", "UUP", "TLT", "XLE", "XLF", "XLK", "XLI", "XLC", "XLY", "XLV", "XLRE", "XLP", "XLB", "XLU"];

    // Fetch all in parallel
    const [quotesRes, moversRes, ...histResponses] = await Promise.all([
      schwabGet(`${base}/quotes`, { params: { symbols: quoteSymbols }, timeout }),
      schwabGet(`${base}/movers/${encodeURIComponent("$SPX")}`, { params: { sort: "PERCENT_CHANGE_UP", frequency: "0" }, timeout }).catch(() => ({ data: [] })),
      ...histSymbols.map(sym =>
        schwabGet(`${base}/pricehistory`, {
          params: { symbol: sym, periodType: "year", period: "1", frequencyType: "daily", frequency: "1" },
          timeout
        }).then(r => ({ sym, candles: r.data?.candles || [] }))
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
      // Use ET midnight to match Schwab's candle datetime convention (ET-based)
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayMsET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate()).getTime();
      const lastCandle = histMap['SPY'][histMap['SPY'].length - 1];
      // Schwab datetime is ms since epoch for ET midnight of that trading day
      // Compare dates in ET by normalising both to ET midnight
      const lastCandleDateET = new Date(new Date(lastCandle.datetime).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const lastCandleMidnightET = new Date(lastCandleDateET.getFullYear(), lastCandleDateET.getMonth(), lastCandleDateET.getDate()).getTime();
      if (lastCandleMidnightET < todayMsET) {
        // Today's candle is missing — append it
        const open = spyQuote.openPrice || spyLast;
        const high = spyQuote.highPrice || spyLast;
        const low = spyQuote.lowPrice || spyLast;
        histMap['SPY'].push({
          datetime: todayMsET,
          open, high, low: low || spyLast,
          close: spyLast,
          volume: spyQuote.totalVolume ?? 0
        });
      } else {
        // Today's candle already present — update with latest price
        lastCandle.close = spyLast;
        if (spyQuote.highPrice) lastCandle.high = Math.max(lastCandle.high, spyQuote.highPrice);
        if (spyQuote.lowPrice && spyQuote.lowPrice > 0) lastCandle.low = Math.min(lastCandle.low, spyQuote.lowPrice);
        if (!lastCandle.low || lastCandle.low === 0) lastCandle.low = Math.min(lastCandle.open, lastCandle.close);
        if (!lastCandle.high || lastCandle.high === 0) lastCandle.high = Math.max(lastCandle.open, lastCandle.close);
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


// ─── Stock Scanner ──────────────────────────────────────────────────────────
// GET /api/scanner?sector=ALL&minVolRatio=2
// Fetches top movers from $SPX, $COMPX, $DJI, enriches with quotes & price history
// Detects anomaly signals using Schwab data only (no Polygon/Twelve Data)
app.get("/api/scanner", async (req, res) => {
  try {
    if (!schwabTokens?.access_token) {
      return res.status(401).json({ ok: false, error: "No access token found. Try to reconnect." });
    }
    const timeout = 30000;
    const base = "https://api.schwabapi.com/marketdata/v1";
    const minVolRatio = parseFloat(req.query.minVolRatio) || 1.5;

    // Step 1: Fetch top movers from all three major indices (by volume and pct change)
    const [volMovers, pcUpMovers, pcDnMovers] = await Promise.all([
      schwabGet(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "VOLUME", frequency: "0" }, timeout
      }).then(r => Array.isArray(r.data) ? r.data : (r.data?.screeners || [])).catch(() => []),
      schwabGet(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "PERCENT_CHANGE_UP", frequency: "0" }, timeout
      }).then(r => Array.isArray(r.data) ? r.data : (r.data?.screeners || [])).catch(() => []),
      schwabGet(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "PERCENT_CHANGE_DOWN", frequency: "0" }, timeout
      }).then(r => Array.isArray(r.data) ? r.data : (r.data?.screeners || [])).catch(() => []),
    ]);

    // Deduplicate and collect unique symbols
    const seenSymbols = new Set();
    const allMovers = [];
    for (const m of [...volMovers, ...pcUpMovers, ...pcDnMovers]) {
      if (m.symbol && !seenSymbols.has(m.symbol)) {
        seenSymbols.add(m.symbol);
        allMovers.push(m);
      }
    }

    if (!allMovers.length) {
      return res.json({ ok: true, anomalies: [], breadth: { advances: 0, declines: 0, unchanged: 0 } });
    }

    const symbols = allMovers.map(m => m.symbol).filter(Boolean);

    // Step 2: Batch quotes for all symbols (price, volume, hi/lo, 52w range, etc.)
    const quotesRes = await schwabGet(`${base}/quotes`, {
      params: { symbols: symbols.join(","), fields: "quote,fundamental" },
      timeout: 45000
    }).catch(() => ({ data: {} }));
    const quotesData = quotesRes.data || {};

    // Step 3: Fetch 20-day price history for avg volume in parallel (cap at 40 symbols to avoid timeout)
    const histSymbols = symbols.slice(0, 40);
    const histResults = await Promise.all(
      histSymbols.map(sym =>
        schwabGet(`${base}/pricehistory`, {
          params: { symbol: sym, periodType: "month", period: "1", frequencyType: "daily", frequency: "1" },
          timeout: 20000
        }).then(r => ({ sym, candles: r.data?.candles || [] }))
          .catch(() => ({ sym, candles: [] }))
      )
    );

    // Build avgVolume map from 20-day history
    const avgVolMap = {};
    const high20dMap = {};
    const avgPrice20dMap = {};
    for (const { sym, candles } of histResults) {
      if (!candles.length) continue;
      const slice = candles.slice(-20);
      const avgVol = slice.reduce((s, c) => s + (c.volume || 0), 0) / slice.length;
      const high20d = Math.max(...slice.map(c => c.high || 0));
      const avgPrice = slice.reduce((s, c) => s + (c.close || 0), 0) / slice.length;
      avgVolMap[sym] = avgVol;
      high20dMap[sym] = high20d;
      avgPrice20dMap[sym] = avgPrice;
    }

    // Sector mapping using Schwab fundamental data
    const SECTOR_ETF_MAP = {
      "Technology": "XLK",
      "Financial Services": "XLF", "Financials": "XLF",
      "Energy": "XLE",
      "Healthcare": "XLV", "Health Care": "XLV",
      "Industrials": "XLI",
      "Consumer Cyclical": "XLY", "Consumer Discretionary": "XLY",
      "Consumer Defensive": "XLP", "Consumer Staples": "XLP",
      "Utilities": "XLU",
      "Basic Materials": "XLB", "Materials": "XLB",
      "Real Estate": "XLRE",
      "Communication Services": "XLC", "Communications": "XLC"
    };

    // Step 4: Detect anomalies
    const anomalies = [];
    let advances = 0, declines = 0, unchanged = 0;

    for (const mover of allMovers) {
      const sym = mover.symbol;
      const qWrapper = quotesData[sym];
      const qt = qWrapper?.quote || {};
      const fund = qWrapper?.fundamental || {};

      const price = qt.lastPrice ?? qt.mark ?? mover.lastPrice ?? mover.last ?? 0;
      const changePct = qt.netPercentChange ?? mover.percentChange ?? mover.netPercentChange ?? 0;
      const volume = qt.totalVolume ?? mover.totalVolume ?? 0;
      const dayHigh = qt.highPrice ?? 0;
      const dayLow = qt.lowPrice ?? 0;
      const week52High = qt["52WeekHigh"] ?? qt.fiftyTwoWeekHigh ?? fund["52WeekHigh"] ?? 0;
      const week52Low = qt["52WeekLow"] ?? qt.fiftyTwoWeekLow ?? fund["52WeekLow"] ?? 0;

      if (price <= 0 || volume <= 0) continue;

      if (changePct > 0.05) advances++;
      else if (changePct < -0.05) declines++;
      else unchanged++;

      const avgVolume = avgVolMap[sym] || volume;
      const volRatio = avgVolume > 0 ? volume / avgVolume : 1;
      const high20d = high20dMap[sym] || dayHigh;
      const avgPrice20d = avgPrice20dMap[sym] || price;

      // Signal detection (mirrors scanner.js logic)
      const signals = [];
      if (volRatio >= minVolRatio) signals.push("VOL SPIKE");
      if (Math.abs(changePct) >= 3) signals.push("PRICE SPIKE");
      if (dayHigh > high20d && volRatio > 1.5) signals.push("BREAKOUT");
      if (changePct > 1.5 && volRatio > 1.2) signals.push("REL STRENGTH");
      else if (changePct < -1.5 && volRatio > 1.2) signals.push("REL STRENGTH");

      if (signals.length === 0) continue;

      const perf20d = avgPrice20d > 0 ? ((price - avgPrice20d) / avgPrice20d) * 100 : 0;
      const isExtreme = Math.abs(changePct) > 5 || volRatio > 5;
      const dayRangePct = (dayHigh - dayLow) > 0 ? ((price - dayLow) / (dayHigh - dayLow)) : 0.5;

      // Sector label
      const sectorRaw = fund.sector || fund.fundType || "";
      const sectorETF = SECTOR_ETF_MAP[sectorRaw] || "—";
      const companyName = fund.description || qt.description || sym;

      // Fundamental fields from Schwab
      const peRatio = fund.peRatio ?? fund.pERatio ?? null;
      const pbRatio = fund.pbRatio ?? fund.pBRatio ?? null;
      const divYield = fund.divYield ?? fund.dividendYield ?? null;
      const divAmount = fund.divAmount ?? fund.dividendAmount ?? null;
      const eps = fund.eps ?? fund.epsTTM ?? null;
      const beta = fund.beta ?? null;
      const marketCap = fund.marketCap ?? fund.marketCapitalization ?? null;

      anomalies.push({
        symbol: sym,
        name: companyName,
        price,
        changePct,
        volume,
        avgVolume,
        volRatio,
        dayHigh,
        dayLow,
        dayRangePct,
        week52High,
        week52Low,
        perf20d,
        signals,
        isExtreme,
        sector: sectorETF,
        sectorRaw,
        peRatio,
        pbRatio,
        divYield,
        divAmount,
        eps,
        beta,
        marketCap
      });
    }

    // Enrich anomaly sectors using Schwab Instruments fundamentals
    if (anomalies.length) {
      try {
        const anomalySymbols = anomalies.map(a => a.symbol).filter(Boolean);

        const instrumentsRes = await schwabGet(`${base}/instruments`, {
          params: {
            symbol: anomalySymbols.join(","),
            projection: "fundamental"
          },
          timeout: 45000
        });

        const instruments = instrumentsRes.data?.instruments || [];
        const sectorBySymbol = {};

        for (const inst of instruments) {
          const sym = inst.symbol;
          const fund = inst.fundamental || {};

          const sectorRaw =
            fund.sector ||
            fund.industryGroup ||
            fund.industry ||
            "";

          if (sym && sectorRaw) {
            sectorBySymbol[sym.toUpperCase()] = sectorRaw;
          }
        }

        for (const a of anomalies) {
          const rawSector = sectorBySymbol[a.symbol.toUpperCase()] || a.sectorRaw || "";
          a.sectorRaw = rawSector;
          a.sector = SECTOR_ETF_MAP[rawSector] || rawSector || "—";
        }
      } catch (sectorErr) {
        console.error("SCANNER SECTOR ENRICH ERROR:", sectorErr.response?.data || sectorErr.message);
      }
    }

    // Sort by volRatio desc by default
    anomalies.sort((a, b) => b.volRatio - a.volRatio);

    res.json({
      ok: true,
      anomalies,
      breadth: { advances, declines, unchanged }
    });
  } catch (error) {
    console.error("SCANNER ERROR:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      ok: false, error: "Failed to run scanner.",
      details: error.response?.data || error.message
    });
  }
});

function shouldSaveEtfCloseSnapshot() {
  const p = getCstParts();
  const weekday = p.weekday;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const nowMinutes = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") return false;

  // Save only after regular market close: 3:00pm CST/CT
  return true;
}

// GET /api/etf-history?symbols=XLK,XLF,...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=600
// Reads daily ETF snapshots from the etf_history table and returns them oldest -> newest
// (per symbol). Used by the ETFs page to build the Relative Rotation Graph.
app.get("/api/etf-history", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }

    const symbolsParam = String(req.query.symbols || "").trim();
    const symbols = symbolsParam
      ? symbolsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    const startDate = req.query.startDate ? String(req.query.startDate) : null;
    const endDate = req.query.endDate ? String(req.query.endDate) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 600, 1), 5000);

    const where = [];
    const args = [];

    if (symbols.length) {
      where.push(`symbol IN (${symbols.map(() => "?").join(",")})`);
      args.push(...symbols);
    }
    if (startDate) {
      where.push("trade_date >= ?");
      args.push(startDate);
    }
    if (endDate) {
      where.push("trade_date <= ?");
      args.push(endDate);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    args.push(limit);

    const result = await turso.execute({
      sql: `
        SELECT
          symbol,
          trade_date AS tradeDate,
          price,
          change_pct AS changePct,
          volume
        FROM etf_history
        ${whereSql}
        ORDER BY symbol ASC, trade_date ASC
        LIMIT ?
      `,
      args
    });

    res.json({
      ok: true,
      count: result.rows?.length || 0,
      rows: result.rows || []
    });
  } catch (error) {
    console.error("ETF HISTORY READ ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to load ETF history.",
      details: error.message
    });
  }
});

app.post("/api/etf-history/snapshot", async (req, res) => {
  try {
    if (!shouldSaveEtfCloseSnapshot()) {
      return res.json({
        ok: true,
        saved: 0,
        skipped: true,
        reason: "ETF close snapshot only saves after 3:00pm CT."
      });
    }

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!rows.length) {
      return res.status(400).json({
        ok: false,
        error: "No ETF rows provided."
      });
    }

    const cleanRows = rows
      .filter(r => r?.symbol)
      .map(r => ({
        symbol: String(r.symbol).toUpperCase(),
        price: r.last,
        changePct: r.pct,
        volume: r.volume
      }));

    await Promise.all(cleanRows.map(saveEtfSnapshot));

    res.json({
      ok: true,
      saved: cleanRows.length
    });
  } catch (error) {
    console.error("ETF HISTORY SNAPSHOT ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to save ETF history snapshot."
    });
  }
});

app.post("/api/spy-daily-history/snapshot", async (req, res) => {
  try {
    const row = req.body?.row;

    if (!row?.tradeDate) {
      return res.status(400).json({
        ok: false,
        error: "Missing SPY daily row or tradeDate."
      });
    }

    await saveSpyDailySnapshot(row);

    res.json({
      ok: true,
      saved: 1,
      tradeDate: row.tradeDate
    });
  } catch (error) {
    console.error("SPY DAILY HISTORY SNAPSHOT ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to save SPY daily history snapshot."
    });
  }
});

app.get("/api/spy-daily-history", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }

    // Default 13 days for compact displays, but allow up to 5000 days so the
    // ETF Relative Rotation Graph can build a year+ of weekly samples that
    // share dates with etf_history rows.
    const limit = Math.min(Math.max(Number(req.query.limit) || 13, 1), 5000);

    const result = await turso.execute({
      sql: `
        SELECT
          trade_date AS tradeDate,
          high,
          low,
          close,
          change_pct AS changePct,
          volume,
          volume_30d_ratio AS volume30dRatio,
          total_oi AS totalOi,
          oi_change_pct AS oiChangePct,
          call_oi AS callOi,
          put_oi AS putOi,
          ivr,
          vol_30d AS vol30d,
          impl_30d AS impl30d,
          vol_60d AS vol60d,
          impl_60d AS impl60d,
          net_prem AS netPrem,
          total_prem AS totalPrem
        FROM spy_daily_history
        ORDER BY trade_date DESC
        LIMIT ?
      `,
      args: [limit]
    });

    res.json({
      ok: true,
      rows: result.rows || []
    });
  } catch (error) {
    console.error("SPY DAILY HISTORY READ ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to load SPY daily history."
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