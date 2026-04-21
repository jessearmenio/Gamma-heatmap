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
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FEAR_GREED_API_KEY = process.env.FEAR_GREED_API_KEY;

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

// Starter-only memory storage.
let schwabTokens = null;

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
        error: "No access token found. Connect Schwab first."
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
        error: "No access token found. Try to reconnect."
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

app.get("/api/earnings-calendar", async (req, res) => {
  try {
    if (!FINNHUB_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing FINNHUB_API_KEY."
      });
    }

    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Missing from/to date range."
      });
    }

    const symbolSet = new Set(FINNHUB_TOP_100_SP500);

    const response = await axios.get("https://finnhub.io/api/v1/calendar/earnings", {
      params: {
        from,
        to,
        token: FINNHUB_API_KEY
      }
    });

    const currentRows = Array.isArray(response.data?.earningsCalendar)
      ? response.data.earningsCalendar
      : [];

    const filteredCurrent = currentRows.filter(row => symbolSet.has(row.symbol));

    const symbolsNeedingHistory = [...new Set(filteredCurrent.map(r => r.symbol))];
    const previousBySymbol = {};

    await Promise.all(
      symbolsNeedingHistory.map(async (symbol) => {
        try {
          const histResponse = await axios.get("https://finnhub.io/api/v1/calendar/earnings", {
            params: {
              symbol,
              token: FINNHUB_API_KEY
            }
          });

          const rows = Array.isArray(histResponse.data?.earningsCalendar)
            ? histResponse.data.earningsCalendar
            : [];

          const sorted = rows
            .filter(r => r.symbol === symbol)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

          const currentMatch = filteredCurrent
            .filter(r => r.symbol === symbol)
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

          if (!currentMatch) {
            previousBySymbol[symbol] = null;
            return;
          }

          const prev = sorted.find(r =>
            new Date(r.date) < new Date(currentMatch.date) &&
            !(r.year === currentMatch.year && r.quarter === currentMatch.quarter)
          ) || null;

          previousBySymbol[symbol] = prev;
        } catch (error) {
          previousBySymbol[symbol] = null;
        }
      })
    );

    const events = filteredCurrent.map(row => {
      const prev = previousBySymbol[row.symbol] || null;

      return {
        type: "EARNINGS",
        symbol: row.symbol,
        title: `${row.symbol} Earnings`,
        releaseDate: row.date,
        year: row.year,
        quarter: row.quarter,
        hour: row.hour || "",
        releaseLabel: formatHourLabel(row.hour),
        epsEstimate: row.epsEstimate ?? null,
        revenueEstimate: row.revenueEstimate ?? null,
        previous: prev ? {
          year: prev.year,
          quarter: prev.quarter,
          epsEstimate: prev.epsEstimate ?? null,
          epsActual: prev.epsActual ?? null,
          epsBeatMissPct: pctBeatMiss(prev.epsActual, prev.epsEstimate),
          revenueEstimate: prev.revenueEstimate ?? null,
          revenueActual: prev.revenueActual ?? null,
          revenueBeatMissPct: pctBeatMiss(prev.revenueActual, prev.revenueEstimate)
        } : null
      };
    });

    res.json({
      ok: true,
      from,
      to,
      count: events.length,
      events
    });
  } catch (error) {
    console.error("EARNINGS CALENDAR ERROR:");
    console.error(error?.response?.data || error?.message || error);

    res.status(500).json({
      ok: false,
      error: "Failed to load earnings calendar."
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
      return res.status(401).json({ ok: false, error: "No access token found. Try to reconnect." });
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
      return res.status(401).json({ ok: false, error: "No access token found. Try to reconnect." });
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
        const open = spyQuote.openPrice || spyLast;
        const high = spyQuote.highPrice || spyLast;
        const low  = spyQuote.lowPrice  || spyLast;  // lowPrice=0 pre-market → fall back to last
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
        if (spyQuote.lowPrice)  lastCandle.low  = Math.min(lastCandle.low, spyQuote.lowPrice);
        // If low ended up 0 (Schwab overnight bug), clamp to close
        if (!lastCandle.low)  lastCandle.low  = Math.min(lastCandle.open, lastCandle.close);
        if (!lastCandle.high) lastCandle.high = Math.max(lastCandle.open, lastCandle.close);
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
    const token = schwabTokens.access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const timeout = 30000;
    const base = "https://api.schwabapi.com/marketdata/v1";
    const minVolRatio = parseFloat(req.query.minVolRatio) || 1.5;

    // Step 1: Fetch top movers from all three major indices (by volume and pct change)
    const [volMovers, pcUpMovers, pcDnMovers] = await Promise.all([
      axios.get(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "VOLUME", frequency: "0" }, headers, timeout
      }).then(r => Array.isArray(r.data) ? r.data : (r.data?.screeners || [])).catch(() => []),
      axios.get(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "PERCENT_CHANGE_UP", frequency: "0" }, headers, timeout
      }).then(r => Array.isArray(r.data) ? r.data : (r.data?.screeners || [])).catch(() => []),
      axios.get(`${base}/movers/${encodeURIComponent("$SPX")}`, {
        params: { sort: "PERCENT_CHANGE_DOWN", frequency: "0" }, headers, timeout
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
    const quotesRes = await axios.get(`${base}/quotes`, {
      params: { symbols: symbols.join(","), fields: "quote,fundamental" },
      headers, timeout: 45000
    }).catch(() => ({ data: {} }));
    const quotesData = quotesRes.data || {};

    // Step 3: Fetch 20-day price history for avg volume in parallel (cap at 40 symbols to avoid timeout)
    const histSymbols = symbols.slice(0, 40);
    const histResults = await Promise.all(
      histSymbols.map(sym =>
        axios.get(`${base}/pricehistory`, {
          params: { symbol: sym, periodType: "month", period: "1", frequencyType: "daily", frequency: "1" },
          headers, timeout: 20000
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
      const peRatio    = fund.peRatio    ?? fund.pERatio    ?? null;
      const pbRatio    = fund.pbRatio    ?? fund.pBRatio    ?? null;
      const divYield   = fund.divYield   ?? fund.dividendYield ?? null;
      const divAmount  = fund.divAmount  ?? fund.dividendAmount ?? null;
      const eps        = fund.eps        ?? fund.epsTTM     ?? null;
      const beta       = fund.beta       ?? null;
      const marketCap  = fund.marketCap  ?? fund.marketCapitalization ?? null;

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