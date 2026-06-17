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
const WORLD_CONFLICT_API_KEY = process.env.WORLD_CONFLICT_API_KEY;
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

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS GexHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dateRecorded TEXT NOT NULL UNIQUE,
      kingGEX REAL,
      callWall REAL,
      putWall REAL,
      netGamma REAL,
      totalPosGamma REAL,
      totalNegGamma REAL,
      spyOpen REAL,
      spyClose REAL,
      spyChange REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS trade_entry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      spy_level REAL,
      vix_level REAL,
      triggers_met TEXT,
      capital_deployed REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS TradeJournal (
      TradeID INTEGER PRIMARY KEY AUTOINCREMENT,
      TradeType TEXT NOT NULL,
      Ticker TEXT NOT NULL,
      EntryDate TEXT,
      EntryTime TEXT,
      Thesis TEXT,
      TargetPrice REAL,
      StopLoss REAL,
      Status TEXT DEFAULT 'open',
      CloseDate TEXT,
      CloseTime TEXT,
      RealizedPL REAL,
      RealizedPLPercent REAL,
      OptionType TEXT,
      Strike REAL,
      Expiration TEXT,
      Tags TEXT,
      SetupType TEXT,
      Grade TEXT,
      Emotion TEXT,
      Mistakes TEXT,
      Lessons TEXT,
      ScreenshotUrl TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS broker_log_hist_trades (
      TradeID INTEGER PRIMARY KEY AUTOINCREMENT,
      AssetType TEXT NOT NULL,
      Ticker TEXT NOT NULL,
      OptionType TEXT,
      ExpirationDate TEXT,
      Strike REAL,
      Status TEXT,
      FirstEntryDate TEXT,
      LastCloseDate TEXT,
      TotalOpenedQuantity REAL,
      TotalClosedQuantity REAL,
      RemainingQuantity REAL,
      AverageCostBasis REAL,
      TotalCostBasis REAL,
      TotalProceeds REAL,
      RealizedPL REAL,
      RealizedPLPercent REAL,
      InstrumentKey TEXT,
      ImportBatchID TEXT,
      CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS broker_log_hist_entries (
      EntryID INTEGER PRIMARY KEY AUTOINCREMENT,
      TradeID INTEGER NOT NULL,
      ActivityDate TEXT,
      Quantity REAL,
      Price REAL,
      Amount REAL,
      CostBasis REAL,
      EntryType TEXT,
      OriginalCSVRowNumber INTEGER,
      OriginalDescription TEXT,
      OriginalTransCode TEXT,
      CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS broker_log_hist_closes (
      CloseID INTEGER PRIMARY KEY AUTOINCREMENT,
      TradeID INTEGER NOT NULL,
      ActivityDate TEXT,
      Quantity REAL,
      Price REAL,
      Amount REAL,
      Proceeds REAL,
      OriginalCSVRowNumber INTEGER,
      OriginalDescription TEXT,
      OriginalTransCode TEXT,
      CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS broker_log_hist_matches (
      MatchID INTEGER PRIMARY KEY AUTOINCREMENT,
      TradeID INTEGER NOT NULL,
      EntryID INTEGER NOT NULL,
      CloseID INTEGER NOT NULL,
      MatchedQuantity REAL,
      AllocatedEntryCost REAL,
      AllocatedCloseProceeds REAL,
      RealizedPL REAL,
      RealizedPLPercent REAL,
      CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS broker_log_hist_warnings (
      WarningID INTEGER PRIMARY KEY AUTOINCREMENT,
      ImportBatchID TEXT,
      OriginalCSVRowNumber INTEGER,
      WarningType TEXT,
      WarningMessage TEXT,
      RawRowJSON TEXT,
      CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Best-effort migrations to add annotation/override columns to the broker
  // trade table without breaking older deployments. SQLite has no
  // ALTER TABLE … IF NOT EXISTS so we swallow "duplicate column" errors.
  const brokerAdds = [
    ["Thesis", "TEXT"],
    ["Tags", "TEXT"],
    ["SetupType", "TEXT"],
    ["Grade", "TEXT"],
    ["Emotion", "TEXT"],
    ["Mistakes", "TEXT"],
    ["Lessons", "TEXT"],
    ["ScreenshotUrl", "TEXT"],
    ["Notes", "TEXT"]
  ];
  for (const [col, type] of brokerAdds) {
    try {
      await turso.execute(`ALTER TABLE broker_log_hist_trades ADD COLUMN ${col} ${type}`);
    } catch (_) { /* column already exists — ignore */ }
  }

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS TradeEntries (
      EntryID INTEGER PRIMARY KEY AUTOINCREMENT,
      TradeID INTEGER NOT NULL,
      EntryType TEXT NOT NULL,
      Quantity REAL,
      Price REAL,
      EntryDate TEXT,
      EntryTime TEXT,
      Notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS put_call_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      p_c_ratio REAL,
      spy_open REAL,
      spy_close REAL,
      spy_change REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Turso SPY daily history table ready.");

  console.log("Turso ETF history table ready.");

  console.log("Turso trade_entry table ready.");
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

async function saveGexHistorySnapshot(row) {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) return;

  await turso.execute({
    sql: `
      INSERT INTO GexHistory (
        dateRecorded,
        kingGEX,
        callWall,
        putWall,
        netGamma,
        totalPosGamma,
        totalNegGamma,
        spyOpen,
        spyClose,
        spyChange,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(dateRecorded)
      DO UPDATE SET
        kingGEX = excluded.kingGEX,
        callWall = excluded.callWall,
        putWall = excluded.putWall,
        netGamma = excluded.netGamma,
        totalPosGamma = excluded.totalPosGamma,
        totalNegGamma = excluded.totalNegGamma,
        spyOpen = excluded.spyOpen,
        spyClose = excluded.spyClose,
        spyChange = excluded.spyChange,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      row.dateRecorded || getCstDateKey(),
      row.kingGEX,
      row.callWall,
      row.putWall,
      row.netGamma,
      row.totalPosGamma,
      row.totalNegGamma,
      row.spyOpen,
      row.spyClose,
      row.spyChange
    ].map(v => Number.isFinite(Number(v)) ? Number(v) : v ?? null)
  });
}

async function savePutCallHistorySnapshot(row) {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) return;

  await turso.execute({
    sql: `
      INSERT INTO put_call_history (
        date,
        p_c_ratio,
        spy_open,
        spy_close,
        spy_change,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date)
      DO UPDATE SET
        p_c_ratio = excluded.p_c_ratio,
        spy_open = excluded.spy_open,
        spy_close = excluded.spy_close,
        spy_change = excluded.spy_change,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      row.date || getCstDateKey(),
      row.p_c_ratio,
      row.spy_open,
      row.spy_close,
      row.spy_change
    ].map(v => Number.isFinite(Number(v)) ? Number(v) : v ?? null)
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
app.use(express.json({ limit: '20mb' }));
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

// ── Media stress (Google News RSS) ───────────────────────────────────
// Counts recent crash/panic headlines about U.S. equities. Used by the
// Trade Authorization Checklist (sent-3) to auto-flag a media regime
// dominated by crash chatter.
//
// Methodology (calibrated against live data — Nov 2024 normal day returned
// ~6–8 noisy matches before filtering; real selloffs clear 20+):
//   • Focused Google News query (market-context + strong-stress vocab)
//   • Post-filter: TITLE must contain a market-context word AND a stress
//     word — drops sector-only tumbles ("Space stocks tumble") and
//     metaphor ("Wall Street dumps crash hedges").
//   • Dedupe syndicated reprints by normalized title (same Bloomberg
//     story republished on NDTV/Yahoo/MarketWatch counts once).
//   • Threshold: ≥ 5 unique qualifying stories in last 48h → triggered.
const MEDIA_STRESS_QUERY =
  '(stocks OR "Wall Street" OR "S&P 500" OR Dow OR Nasdaq) ' +
  '(crash OR meltdown OR panic OR capitulation OR plunge OR freefall OR rout OR "bear market" OR "sell-off" OR selloff OR tumble)';
const MEDIA_EUPHORIA_QUERY =
  '(stocks OR "Wall Street" OR "S&P 500" OR Dow OR Nasdaq) ' +
  '(rally OR "melt up" OR meltup OR euphoria OR FOMO OR "all-time high" OR "record high" OR "fresh high" OR surge OR soar OR breakout OR "bull market" OR moonshot OR parabolic)';
// Calibrated against live data: calm days returned ~6–9 noisy matches after
// filtering (sector tumbles, speculative AI-bubble pieces); a real selloff
// (Aug 2024 carry-trade style) easily clears 20+; mild corrections 12–18.
// 10 sits in the gap — won't fire on noise floor, fires on real stress.
const MEDIA_STRESS_THRESHOLD = 10;
const MEDIA_STRESS_WINDOW_MS = 48 * 60 * 60 * 1000; // last 48 hours
const MEDIA_STRESS_CACHE_MS = 10 * 60 * 1000;       // refresh at most every 10 min

// Title-level guards.
const MEDIA_MARKET_RE = /\b(stocks?|equit(?:y|ies)|wall\s*street|s&?p\s*500?|dow(?:\s*jones)?|nasdaq|nyse|futures|market(?:s)?)\b/i;
// Crash side
const MEDIA_STRONG_RE = /\b(crash(?:es|ed|ing)?|meltdown|panic|capitulation|freefall)\b/i;
const MEDIA_MEDIUM_RE = /\b(plunge[ds]?|rout|sell-?off|tumble[ds]?|bear\s+market)\b/i;
// Euphoria side
const MEDIA_EUPH_STRONG_RE = /\b(euphoria|meltup|melt\s*up|moonshot|parabolic|FOMO|all-?time\s+high|record\s+high|fresh\s+high)\b/i;
const MEDIA_EUPH_MEDIUM_RE = /\b(rally|surge[ds]?|soar(?:s|ed|ing)?|breakout|bull\s+market|jump[ds]?)\b/i;

let mediaStressCache = { data: null, fetchedAt: 0 };

function normalizeMediaTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\s+-\s+[^-]+$/, "")            // strip trailing " - Outlet.com"
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function fetchGoogleNewsItems(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const resp = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HeatseekerBot/1.0; +https://stock-market-dash.onrender.com)",
      "Accept": "application/rss+xml, application/xml, text/xml"
    }
  });
  const xml = String(resp.data || "");
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const title = rawTitle.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const pubDateStr = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : NaN;
    if (title && Number.isFinite(pubDate)) items.push({ title, pubDate });
  }
  return items;
}

function scoreMediaItems(items, strongRe, mediumRe) {
  const cutoff = Date.now() - MEDIA_STRESS_WINDOW_MS;
  const recent = items.filter(i => i.pubDate >= cutoff);
  const seen = new Set();
  let count = 0, score = 0;
  const matched = [];
  for (const r of recent) {
    const hasStrong = strongRe.test(r.title);
    const hasMedium = mediumRe.test(r.title);
    if (!hasStrong && !hasMedium) continue;
    if (!MEDIA_MARKET_RE.test(r.title)) continue;
    const key = normalizeMediaTitle(r.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    count++;
    score += hasStrong ? 3 : 2;
    matched.push(r.title);
  }
  return {
    triggered: count >= MEDIA_STRESS_THRESHOLD,
    count,
    score,
    threshold: MEDIA_STRESS_THRESHOLD,
    windowHours: MEDIA_STRESS_WINDOW_MS / 3600000,
    rawItems: recent.length,
    headlines: matched.slice(0, 8)
  };
}

async function fetchMediaStressFromGoogleNews() {
  const [crashItems, euphItems] = await Promise.all([
    fetchGoogleNewsItems(MEDIA_STRESS_QUERY),
    fetchGoogleNewsItems(MEDIA_EUPHORIA_QUERY).catch(e => {
      console.warn("MEDIA euphoria fetch failed:", e.message);
      return [];
    })
  ]);
  const crash = scoreMediaItems(crashItems, MEDIA_STRONG_RE, MEDIA_MEDIUM_RE);
  const euphoria = scoreMediaItems(euphItems, MEDIA_EUPH_STRONG_RE, MEDIA_EUPH_MEDIUM_RE);
  mediaStressCache = { data: { crash, euphoria }, fetchedAt: Date.now() };
  return mediaStressCache.data;
}

app.get("/api/media-stress", async (_req, res) => {
  try {
    const fresh = mediaStressCache.data && (Date.now() - mediaStressCache.fetchedAt < MEDIA_STRESS_CACHE_MS);
    if (!fresh) {
      try { await fetchMediaStressFromGoogleNews(); }
      catch (e) {
        console.warn("MEDIA_STRESS fetch failed:", e.message);
        if (!mediaStressCache.data) {
          const empty = { triggered: false, count: 0, score: 0, threshold: MEDIA_STRESS_THRESHOLD, headlines: [], error: e.message };
          return res.json({ ok: true, data: { crash: empty, euphoria: empty } });
        }
      }
    }
    res.json({
      ok: true,
      data: mediaStressCache.data,
      cache: { fetchedAt: mediaStressCache.fetchedAt, stale: !fresh }
    });
  } catch (error) {
    console.error("MEDIA_STRESS ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to fetch media stress.", details: error.message });
  }
});

// Domains we treat as English-only when an article-level language tag is missing.
// Conservative list — better to drop a story than show a non-English one.
const ENGLISH_DOMAIN_ALLOWLIST = new Set([
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com",
  "washingtonpost.com", "wsj.com", "ft.com", "bloomberg.com", "theguardian.com",
  "telegraph.co.uk", "thetimes.co.uk", "economist.com", "npr.org", "abcnews.go.com",
  "cbsnews.com", "nbcnews.com", "foxnews.com", "usatoday.com", "latimes.com",
  "chicagotribune.com", "politico.com", "axios.com", "thehill.com", "newsweek.com",
  "time.com", "theatlantic.com", "forbes.com", "businessinsider.com", "cnbc.com",
  "marketwatch.com", "yahoo.com", "news.yahoo.com", "finance.yahoo.com",
  "aljazeera.com", "dw.com", "france24.com", "euronews.com", "rferl.org",
  "voanews.com", "japantimes.co.jp", "scmp.com", "channelnewsasia.com",
  "straitstimes.com", "manilatimes.net", "inquirer.net", "rappler.com",
  "abs-cbn.com", "gmanetwork.com", "thehindu.com", "hindustantimes.com",
  "timesofindia.indiatimes.com", "indiatoday.in", "ndtv.com", "thedailystar.net",
  "dawn.com", "arabnews.com", "gulfnews.com", "thenationalnews.com",
  "jpost.com", "timesofisrael.com", "haaretz.com", "middleeasteye.net",
  "kyivindependent.com", "kyivpost.com", "euractiv.com", "politico.eu",
  "theglobeandmail.com", "cbc.ca", "ctvnews.ca", "nationalpost.com",
  "abc.net.au", "smh.com.au", "theage.com.au", "news.com.au", "stuff.co.nz",
  "nzherald.co.nz", "rnz.co.nz", "theconversation.com", "defensenews.com",
  "breakingdefense.com", "militarytimes.com", "stripes.com", "foreignpolicy.com",
  "foreignaffairs.com", "csis.org", "rusi.org", "understandingwar.org",
  "acleddata.com", "crisisgroup.org", "hrw.org", "amnesty.org",
  "un.org", "news.un.org", "reliefweb.int", "salinapost.com"
]);

function extractDomain(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isEnglishLanguage(lang) {
  if (!lang) return false;
  const v = String(lang).trim().toLowerCase();
  return v === "english" || v === "en" || v.startsWith("en-") || v.startsWith("en_");
}

function filterGeoRiskEnglish(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const articles = Array.isArray(payload.articles) ? payload.articles : [];

  // URL → language map and domain → (sawEnglish, sawNonEnglish) summary
  const urlLang = new Map();
  const domainHasEnglish = new Map();
  for (const a of articles) {
    const url = (a?.url || "").trim();
    const lang = a?.language || "";
    if (url) urlLang.set(url, lang);
    const dom = extractDomain(a?.url) || (a?.domain || "").toLowerCase();
    if (dom) {
      const cur = domainHasEnglish.get(dom) || { en: 0, other: 0 };
      if (isEnglishLanguage(lang)) cur.en += 1;
      else if (lang) cur.other += 1;
      domainHasEnglish.set(dom, cur);
    }
  }

  function isEnglishStory(story) {
    const lead = story?.lead_article || {};
    const directLang = story?.language || lead.language;
    if (directLang) return isEnglishLanguage(directLang);

    const url = (lead.url || story?.url || "").trim();
    if (url && urlLang.has(url)) return isEnglishLanguage(urlLang.get(url));

    const dom = extractDomain(url) || (lead.domain || story?.domain || "").toLowerCase();
    if (dom) {
      const stats = domainHasEnglish.get(dom);
      if (stats) {
        // Trust the domain if it has at least one confirmed English article
        // and no confirmed non-English article in this batch.
        if (stats.en > 0 && stats.other === 0) return true;
        if (stats.other > 0 && stats.en === 0) return false;
      }
      if (ENGLISH_DOMAIN_ALLOWLIST.has(dom)) return true;
    }

    // Unknown — drop to be safe (we only want English we can read)
    return false;
  }

  const englishHeadlines = (Array.isArray(payload.top_headlines) ? payload.top_headlines : [])
    .filter(isEnglishStory);
  const englishClusters = (Array.isArray(payload.clusters) ? payload.clusters : [])
    .filter(isEnglishStory);
  const englishArticles = articles.filter(a => isEnglishLanguage(a?.language));

  // Recompute the overall risk level / dominant tone from the filtered set so
  // the badge in the UI reflects only English stories.
  const levels = englishHeadlines.map(h => String(h?.risk_level || "").toLowerCase());
  const hasHigh = levels.some(l => l === "high" || l === "critical");
  const hasMed = levels.some(l => l === "medium");
  const overall_risk_level = hasHigh ? "high" : hasMed ? "medium" : englishHeadlines.length ? "low" : "unknown";

  const scores = englishHeadlines
    .map(h => Number(h?.risk_score))
    .filter(n => Number.isFinite(n));
  const overall_risk_score = scores.length
    ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
    : (payload.overview?.overall_risk_score ?? null);

  const out = {
    ...payload,
    top_headlines: englishHeadlines,
    clusters: englishClusters,
    articles: englishArticles,
    overview: {
      ...(payload.overview || {}),
      overall_risk_level,
      overall_risk_score,
      coverage_volume: englishArticles.length,
      story_clusters: englishClusters.length
    },
    meta: {
      ...(payload.meta || {}),
      english_filter_applied: true,
      english_headlines_kept: englishHeadlines.length,
      headlines_dropped: (payload.top_headlines?.length || 0) - englishHeadlines.length
    }
  };
  return out;
}

app.get("/api/geo-risk", async (_req, res) => {
  try {
    if (!WORLD_CONFLICT_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing WORLD_CONFLICT_API_KEY."
      });
    }

    const response = await axios.get(
      "https://world-conflict-intelligence-api.p.rapidapi.com/wars/usairan.php",
      {
        params: {
          timespan: "24h",
          max: 12,
          ai: 0
        },
        headers: {
          "x-rapidapi-key": WORLD_CONFLICT_API_KEY,
          "x-rapidapi-host": "world-conflict-intelligence-api.p.rapidapi.com",
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    // Filter to English-language stories only.
    // The `articles` array carries the per-article `language` field; `top_headlines`
    // does not. Build a URL→language lookup from `articles`, then keep only the
    // headlines whose lead_article URL maps to English (or whose source domain is
    // a known English-only outlet, as a fallback when the article isn't in the
    // articles array).
    const filtered = filterGeoRiskEnglish(response.data);

    res.json({
      ok: true,
      data: filtered
    });
  } catch (error) {
    console.error("GEO_RISK ERROR:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Failed to fetch geo risk stories.",
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
    fromDate: overrides.fromDate,
    toDate: overrides.toDate
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

    const response = await fetchChain(actualSymbol, {
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

function normalizeExpirationDate(contract, expKey) {
  const raw = contract?.expirationDate || String(expKey || "").split(":")[0];
  return String(raw || "").slice(0, 10);
}

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
        const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

        const strike = Number(contract.strikePrice ?? strikeKey);
        const gamma = safeNum(contract.gamma);
        const rawOI = safeNum(contract.openInterest);
        const rawVol = safeNum(contract.totalVolume);
        // Schwab returns openInterest = 0 on index option chains ($SPX, $VIX)
        // even though the contracts have real positioning. Fall back to today's
        // total volume so index gamma exposure isn't zeroed out. Regular equity
        // chains keep using OI (rawOI > 0).
        const openInterest = rawOI > 0 ? rawOI : rawVol;
        const daysToExpiration = safeNum(contract.daysToExpiration);
        const expirationDate = normalizeExpirationDate(contract, expKey);

        if (!expirationDate || !Number.isFinite(strike)) continue;

        rows.push({
          side,
          expKey: expirationDate,
          sourceExpKey: expKey,
          expirationDate,
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
  return [...expKeys].sort((a, b) => new Date(a) - new Date(b));
}

// Schwab returns openInterest=0 across the entire $SPX/$VIX option chains.
// For $SPX we synthesize realistic dealer gamma from SPY's OI by mapping each
// SPY strike to its SPX-equivalent (× 10) and tagging the proxy row with a
// multiplier of 1000 (= 100 contract multiplier × 10 notional scaling). The
// proxy uses real SPY open interest only (no volume fallback) so it reflects
// accumulated positioning rather than intraday flow.
function buildSpyProxyRowsForSpx(spyChain) {
  if (!spyChain || typeof spyChain !== "object") return [];
  const STRIKE_SCALE = 10;
  const NOTIONAL_MULT = 1000;
  const out = [];

  function scanMap(map, side) {
    if (!map || typeof map !== "object") return;
    for (const expKey of Object.keys(map)) {
      const strikes = map[expKey];
      if (!strikes || typeof strikes !== "object") continue;
      for (const sk of Object.keys(strikes)) {
        const contracts = strikes[sk];
        if (!Array.isArray(contracts)) continue;
        for (const c of contracts) {
          const gamma = Number(c.gamma);
          const oi = Number(c.openInterest);
          if (!Number.isFinite(gamma) || !Number.isFinite(oi) || oi <= 0) continue;
          const spyStrike = Number(c.strikePrice ?? sk);
          if (!Number.isFinite(spyStrike)) continue;
          // Snap SPY×10 onto the SPX $5 strike grid.
          const mapped = Math.round((spyStrike * STRIKE_SCALE) / 5) * 5;
          const expirationDate = normalizeExpirationDate(c, expKey);
          if (!expirationDate) continue;
          out.push({
            side,
            expKey: expirationDate,
            sourceExpKey: expKey,
            expirationDate,
            strike: mapped,
            gamma,
            openInterest: oi,
            multiplier: NOTIONAL_MULT,
            daysToExpiration: Number(c.daysToExpiration) || 0,
            symbol: c.symbol,
            inTheMoney: !!c.inTheMoney
          });
        }
      }
    }
  }

  scanMap(spyChain.callExpDateMap, "CALL");
  scanMap(spyChain.putExpDateMap, "PUT");
  return out;
}

function buildHeatFromChain(chain, extraRows = []) {
  const underlyingPrice = Number(chain.underlyingPrice ?? 0);

  const calls = flattenExpDateMap(chain.callExpDateMap, "CALL");
  const puts = flattenExpDateMap(chain.putExpDateMap, "PUT");
  // extraRows: pre-flattened rows from a proxy chain (e.g. SPY → $SPX), with
  // an optional per-row `multiplier` used in the GEX formula instead of 100.
  const allRows = [...calls, ...puts, ...(Array.isArray(extraRows) ? extraRows : [])];

  const byStrike = new Map();
  const byCell = new Map();
  const expSet = new Set();
  const expMeta = new Map();

  for (const row of allRows) {
    expSet.add(row.expKey);
    if (!expMeta.has(row.expKey)) {
      expMeta.set(row.expKey, {
        expirationDate: row.expirationDate,
        daysToExpiration: row.daysToExpiration
      });
    } else if (!Number.isFinite(expMeta.get(row.expKey).daysToExpiration) && Number.isFinite(row.daysToExpiration)) {
      expMeta.get(row.expKey).daysToExpiration = row.daysToExpiration;
    }

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
    const gex = row.gamma * row.openInterest * (row.multiplier || 100);

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
        expirationDate: expKey,
        daysToExpiration: expMeta.get(expKey)?.daysToExpiration ?? null,
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

  // Call Wall  = strike with the largest CALL-side gamma exposure (resistance).
  // Put Wall   = strike with the largest PUT-side gamma exposure  (support).
  //
  // Industry-standard definition (SpotGamma, FlashAlpha, etc.):
  //   wall = argmax_K [ gamma(K) * OI(K) * 100 ]   per side
  //
  // The previous implementation used raw open interest, which produced walls at
  // strikes that had high OI but ~zero gamma (e.g. deep-OTM long-dated strikes),
  // so the highlighted walls did not line up with the GEX heat map. We now sort
  // by call/put GEX magnitude per strike, matching the heat map exactly.
  //
  // Note: putGex is stored as a negative number (see the accumulator above), so
  // the strongest put-side gamma is the most-negative value.
  const strikesWithCallGamma = strikes.filter(s => Math.abs(s.callGex) > 0);
  const strikesWithPutGamma  = strikes.filter(s => Math.abs(s.putGex)  > 0);

  // Call Wall must live ABOVE spot (resistance) and Put Wall BELOW spot
  // (support). Without this filter both walls collapse to whichever ATM
  // strike has the heaviest gamma on both sides — e.g. SPY 750 when spot
  // is 750.46 (massive 0DTE call AND put OI at the same strike), which
  // produced Call Wall == Put Wall == 750 in the UI. We pick the strongest
  // per-side gex within the appropriate half of the chain; if the chain
  // doesn't have any strikes on the proper side (very thin OI), we fall
  // back to the unfiltered pool so something still renders.
  const callPool = (() => {
    if (Number.isFinite(underlyingPrice) && underlyingPrice > 0) {
      const above = strikesWithCallGamma.filter(s => s.strike > underlyingPrice);
      if (above.length) return above;
    }
    return strikesWithCallGamma;
  })();
  const putPool = (() => {
    if (Number.isFinite(underlyingPrice) && underlyingPrice > 0) {
      const below = strikesWithPutGamma.filter(s => s.strike < underlyingPrice);
      if (below.length) return below;
    }
    return strikesWithPutGamma;
  })();

  const strongestCallWall =
    [...callPool].sort((a, b) => Math.abs(b.callGex) - Math.abs(a.callGex))[0] || null;
  const strongestPutWall =
    [...putPool].sort((a, b) => Math.abs(b.putGex) - Math.abs(a.putGex))[0] || null;
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

  // ── Expected move (1D / 1W) ─────────────────────────────────────────
  // Calculated SpotGamma-style by reading the ATM straddle price for the
  // nearest expiry (1D) and an expiry ~5 trading days out (1W). The straddle
  // price is the market's pre-priced expected move, so no IV back-out needed.
  // Falls back to the formula EM = S × IV × √(days/denom) using the ATM
  // contract's volatility field when straddle prices are missing or stale.
  //
  // Output shape: { expectedMoves: { oneDay: {expirationDate, daysToExpiration, em, source}, oneWeek: {...} } }
  function pickMarkPrice(contract) {
    if (!contract) return null;
    const mark = Number(contract.mark);
    if (Number.isFinite(mark) && mark > 0) return mark;
    const bid = Number(contract.bid), ask = Number(contract.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
    const last = Number(contract.last);
    if (Number.isFinite(last) && last > 0) return last;
    return null;
  }
  function findAtmContract(expMap, expKey, spot) {
    if (!expMap || !expKey || !spot) return null;
    const strikes = expMap[expKey];
    if (!strikes) return null;
    let best = null, bestDist = Infinity;
    for (const sk of Object.keys(strikes)) {
      const contracts = strikes[sk];
      if (!Array.isArray(contracts) || !contracts.length) continue;
      const strike = Number(contracts[0]?.strikePrice ?? sk);
      if (!Number.isFinite(strike)) continue;
      const dist = Math.abs(strike - spot);
      if (dist < bestDist) { bestDist = dist; best = { contract: contracts[0], strike }; }
    }
    return best;
  }
  function computeExpectedMove(targetDays, minDte = null) {
    if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return null;
    // Sort expirations by daysToExpiration, then pick the one closest to target.
    // `minDte` is a hard floor — used for 1D EM to skip same-day 0DTE contracts
    // whose extrinsic value has decayed to nearly zero late in the trading day
    // (e.g. an SPY 0DTE ATM call worth $0.10 at 3:50pm doesn't represent the
    // expected next-24h move; it represents the expected next-10min move).
    // SpotGamma's published 1D EM uses the next-session contract for exactly
    // this reason.
    let pool = expirations
      .map(exp => ({ exp, dte: expMeta.get(exp)?.daysToExpiration }))
      .filter(x => Number.isFinite(x.dte) && x.dte >= 0);
    if (Number.isFinite(minDte)) {
      const filtered = pool.filter(x => x.dte >= minDte);
      if (filtered.length) pool = filtered;
      // If no expiration satisfies the floor (rare — e.g. very late Friday
      // when next listed is the following Monday), we fall back to the full
      // pool rather than returning null, so something still renders.
    }
    const sortedExps = pool.sort((a, b) =>
      Math.abs(a.dte - targetDays) - Math.abs(b.dte - targetDays)
    );
    if (!sortedExps.length) return null;
    const { exp: expKey, dte } = sortedExps[0];
    // Schwab key shape is e.g. "2026-06-17:0" — but we already normalized
    // to YYYY-MM-DD in expirations. The raw expDateMap may still use the
    // suffixed form, so try both lookups.
    const tryKeys = [expKey, ...Object.keys(chain.callExpDateMap || {}).filter(k => k.startsWith(expKey))];
    let atmCall = null, atmPut = null;
    for (const k of tryKeys) {
      atmCall = findAtmContract(chain.callExpDateMap, k, underlyingPrice);
      if (atmCall) break;
    }
    for (const k of tryKeys) {
      atmPut = findAtmContract(chain.putExpDateMap, k, underlyingPrice);
      if (atmPut) break;
    }
    const callPx = pickMarkPrice(atmCall?.contract);
    const putPx  = pickMarkPrice(atmPut?.contract);
    // Pull the annualized IV (Schwab returns it as percent — 14.32 means 14.32%).
    // Average call+put IVs when both available so the displayed IV reflects the
    // ATM straddle level, not just one side of the smile.
    const ivCallRaw = Number(atmCall?.contract?.volatility);
    const ivPutRaw  = Number(atmPut?.contract?.volatility);
    let ivPct = null;
    if (Number.isFinite(ivCallRaw) && ivCallRaw > 0 && Number.isFinite(ivPutRaw) && ivPutRaw > 0) {
      ivPct = (ivCallRaw + ivPutRaw) / 2;
    } else if (Number.isFinite(ivCallRaw) && ivCallRaw > 0) {
      ivPct = ivCallRaw;
    } else if (Number.isFinite(ivPutRaw) && ivPutRaw > 0) {
      ivPct = ivPutRaw;
    }

    // Preferred path — ATM straddle. We return the leg prices and ATM strike
    // separately so the client can compute the *asymmetric* expected-move
    // targets (put-skew + strike-vs-spot offset mean up-distance ≠ down-distance):
    //
    //   upperTarget = atmStrike + callPx     (breakeven through ATM strike, up)
    //   lowerTarget = atmStrike − putPx      (breakeven through ATM strike, down)
    //
    // `em` is kept for chart back-compat (the symmetric ±EM line drawer); the
    // card UI uses the leg-level fields for accurate up/down levels.
    if (Number.isFinite(callPx) && Number.isFinite(putPx)) {
      return {
        expirationDate: expKey,
        daysToExpiration: dte,
        em: callPx + putPx,                 // straddle sum, symmetric proxy
        iv: ivPct,                          // annualized ATM IV in % (e.g. 14.32)
        atmStrike: atmCall?.strike ?? atmPut?.strike ?? null,
        callPx,
        putPx,
        source: 'straddle'
      };
    }
    // Fallback: EM = S × IV × √(days / denom). Use 252 trading-day denom for
    // ≥3-day targets, otherwise 365 calendar days. Symmetric only.
    if (Number.isFinite(ivPct) && ivPct > 0) {
      const ivDec = ivPct > 5 ? ivPct / 100 : ivPct;
      const denom = dte >= 3 ? 252 : 365;
      const tradingDaysForWeekly = dte >= 3 ? Math.min(dte, 5) : dte;
      const daysNumerator = dte >= 3 ? tradingDaysForWeekly : dte;
      const em = underlyingPrice * ivDec * Math.sqrt(daysNumerator / denom);
      return { expirationDate: expKey, daysToExpiration: dte, em, iv: ivPct, source: 'iv' };
    }
    return null;
  }
  // 1D target = nearest expiration (0DTE if available, else next session).
  // 1W target = expiration closest to 5 calendar days out (SpotGamma's
  // 5 trading-day window typically lands on Fri-of-next-week).
  const expectedMoves = {
    // 1D target = next-session expiration (dte ≥ 1). Picking same-day 0DTE
    // late in the trading day collapses the straddle to a tiny intraday-time-
    // value figure that doesn't represent the actual next-24h move. Floor at
    // 1 day so we use tomorrow's contract — matches how SpotGamma publishes
    // 1D EM.
    oneDay: computeExpectedMove(1, 1),
    // 1W target = 5 trading days; no floor needed since 5 ≫ same-day decay.
    oneWeek: computeExpectedMove(5)
  };

  return {
    underlyingPrice,
    contractCount: allRows.length,
    expirations,
    expirationMeta: Object.fromEntries(
      expirations.map(exp => [exp, expMeta.get(exp) || { expirationDate: exp, daysToExpiration: null }])
    ),
    expectedMoves,
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

// Try to fetch an options chain with progressively relaxed parameters.
// Schwab's chains endpoint silently returns an empty response (200 OK with
// status: "SUCCESS" but no expDateMap entries) when the requested payload is
// too large or when the symbol/strikeCount/date combination doesn't match any
// listed contracts. This is especially common for $VIX, which has wide,
// non-uniform strike spacing (1 / 2.5 / 5 / 10) and Wed-only expirations, so a
// strikeCount=50 / 30-day window often produces nothing.
async function fetchChainWithFallback(actualSymbol, opts) {
  const attempts = [];

  // Attempt 1: exact params the caller asked for.
  attempts.push({ label: "requested", overrides: opts });

  const isVix = actualSymbol === "$VIX";

  if (isVix) {
    // Attempt 2: drop strikeCount, force range=ALL across the date window.
    // VIX has far fewer strikes than SPX so ALL is safe and avoids the
    // "strikeCount around ATM" filter that excludes most listed strikes when
    // the underlying is near 15 but listed strikes go from 10 to 100+.
    attempts.push({
      label: "vix-range-all",
      overrides: {
        ...opts,
        strikeCount: undefined,
        range: "ALL"
      }
    });

    // Attempt 3: widen the date window to 90 days. VIX monthly expirations
    // are Wed-only and the next listed expiration can sit just outside a
    // 30-day window when the user happens to query between cycles.
    attempts.push({
      label: "vix-wide-window",
      overrides: {
        ...opts,
        strikeCount: undefined,
        range: "ALL",
        fromDate: getTodayISO(),
        toDate: getFutureISO(90)
      }
    });

    // Attempt 4: no date constraints at all — let Schwab return everything
    // it has listed. Last-resort path so the heat map always shows something.
    attempts.push({
      label: "vix-no-dates",
      overrides: {
        ...opts,
        strikeCount: undefined,
        range: "ALL",
        fromDate: null,
        toDate: null
      }
    });
  } else {
    // Non-VIX: a single relaxed retry is enough.
    attempts.push({
      label: "relaxed",
      overrides: { ...opts, strikeCount: undefined, range: "ALL" }
    });
  }

  let lastResponse = null;
  let lastError = null;
  const tried = [];

  for (const attempt of attempts) {
    try {
      // Strip null overrides so fetchChain uses its own defaults.
      const cleanOverrides = {};
      for (const [k, v] of Object.entries(attempt.overrides || {})) {
        if (v !== null && v !== undefined) cleanOverrides[k] = v;
      }

      const resp = await fetchChain(actualSymbol, cleanOverrides);
      const chain = resp.data || {};
      const callMap = chain.callExpDateMap || {};
      const putMap = chain.putExpDateMap || {};
      const callExps = Object.keys(callMap).length;
      const putExps = Object.keys(putMap).length;

      tried.push({
        label: attempt.label,
        status: chain.status,
        callExpirations: callExps,
        putExpirations: putExps,
        params: resp.config?.params || null
      });

      lastResponse = resp;

      // Success = at least one expiration on either side.
      if (callExps > 0 || putExps > 0) {
        return { response: resp, tried, succeededWith: attempt.label };
      }

      console.warn(
        `CHAIN EMPTY for ${actualSymbol} (attempt=${attempt.label}, status=${chain.status})`
      );
    } catch (err) {
      lastError = err;
      tried.push({
        label: attempt.label,
        error: err.response?.data || err.message,
        httpStatus: err.response?.status
      });
      console.warn(
        `CHAIN FETCH FAILED for ${actualSymbol} (attempt=${attempt.label}):`,
        err.response?.status,
        err.response?.data || err.message
      );
    }
  }

  return { response: lastResponse, tried, error: lastError, succeededWith: null };
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

    const isVixRequest = actualSymbol === "$VIX";
    const isSpxRequest = actualSymbol === "$SPX";
    const isIndexRequest = isVixRequest || isSpxRequest;

    // Build chain overrides. Heat Seeker should use the expirations returned by
    // the Schwab chain itself, not a fixed 7/14/30/45 DTE date window. $SPXW and
    // $VIXW weeklies are included in the same $SPX/$VIX chains and are grouped by
    // each contract's expirationDate inside buildHeatFromChain().
    const chainOverrides = {
      contractType: req.query.contractType,
      strikeCount: isVixRequest
        ? undefined
        : (req.query.strikeCount ? Number(req.query.strikeCount) : 12),
      includeUnderlyingQuote: false,
      range: isIndexRequest ? (req.query.range || "ALL") : req.query.range,
      expMonth: req.query.expMonth,
      optionType: req.query.optionType,
      strike: req.query.strike
    };

    const chainPromise = fetchChainWithFallback(actualSymbol, chainOverrides);

    const quotesPromise = schwabGet(
      'https://api.schwabapi.com/marketdata/v1/quotes',
      {
        params: { symbols: mapQuoteSymbolsParam(requestedSymbol), fields: 'quote' },
        timeout: 30000
      }
    ).catch(err => {
      console.warn(`HEAT quotes fetch failed for ${requestedSymbol}:`, err.message);
      return { data: {} };
    });

    const vixHistPromise = isVixRequest
      ? schwabGet('https://api.schwabapi.com/marketdata/v1/pricehistory', {
        params: {
          symbol: '$VIX',
          periodType: 'year',
          period: 1,
          frequencyType: 'daily',
          frequency: 1
        },
        timeout: 30000
      }).catch(err => {
        console.warn("HEAT VIX history fetch failed:", err.message);
        return { data: { candles: [] } };
      })
      : Promise.resolve({ data: { candles: [] } });

    // For $SPX we also pull SPY in parallel — Schwab returns OI=0 across the
    // entire SPX chain, so SPY's open interest (scaled ×10 onto the SPX grid)
    // is used as a proxy for dealer-gamma positioning at each strike.
    const spyProxyPromise = isSpxRequest
      ? fetchChainWithFallback("SPY", {
          contractType: "ALL",
          strikeCount: 100,
          range: "ALL",
          includeUnderlyingQuote: false
        })
        .then(r => r.response?.data || null)
        .catch(err => {
          console.warn("HEAT SPY proxy fetch failed:", err.message);
          return null;
        })
      : Promise.resolve(null);

    const [chainResult, quotesResponse, vixHistResponse, spyProxyChain] = await Promise.all([
      chainPromise,
      quotesPromise,
      vixHistPromise,
      spyProxyPromise
    ]);

    const response = chainResult.response;
    const chain = response?.data || {};
    const extraRows = isSpxRequest ? buildSpyProxyRowsForSpx(spyProxyChain) : [];
    const heat = buildHeatFromChain(chain, extraRows);

    if (!heat.contractCount) {
      // Surface what each fallback attempt actually returned so the issue is
      // diagnosable from the browser/network tab instead of "No data returned".
      console.error(
        `HEAT no contracts for ${actualSymbol}. Attempts:`,
        JSON.stringify(chainResult.tried, null, 2)
      );

      return res.json({
        ok: false,
        requestedSymbol,
        actualSymbol,
        request: response?.config?.params ?? null,
        attempts: chainResult.tried,
        error: `No option contracts returned for ${actualSymbol}.` +
          (chain.status && chain.status !== "SUCCESS"
            ? ` Schwab status: ${chain.status}.`
            : "") +
          (chainResult.error
            ? ` Last error: ${chainResult.error.message || "unknown"}.`
            : ""),
        details: chain
      });
    }

    let vix = null;

    if (isVixRequest) {
      const vixQuote =
        quotesResponse.data?.VIX?.quote ??
        quotesResponse.data?.$VIX?.quote ??
        quotesResponse.data?.VIX ??
        quotesResponse.data?.$VIX ??
        null;

      const vixCloses = (vixHistResponse?.data?.candles || [])
        .map(c => Number(c.close))
        .filter(Number.isFinite);

      const vixValue =
        Number(vixQuote?.lastPrice) ||
        Number(vixQuote?.mark) ||
        (vixCloses.length ? vixCloses[vixCloses.length - 1] : null);

      const vix20sma =
        vixCloses.length >= 20
          ? vixCloses.slice(-20).reduce((a, b) => a + b, 0) / 20
          : null;

      const vixSlope =
        vixCloses.length >= 6
          ? (vixCloses[vixCloses.length - 1] - vixCloses[vixCloses.length - 6]) / 5
          : null;

      const vixPct =
        vixCloses.length
          ? (() => {
            const sample = vixCloses.slice(-252);
            const base = Number.isFinite(vixValue) ? vixValue : sample[sample.length - 1];
            const belowOrEqual = sample.filter(v => v <= base).length;
            return Math.round((belowOrEqual / sample.length) * 100);
          })()
          : null;

      vix = {
        value: vixValue,
        quote: vixQuote,
        closes: vixCloses,
        slope5d: vixSlope,
        sma20: vix20sma,
        percentile1y: vixPct
      };
    }

    res.json({
      ok: true,
      requestedSymbol,
      actualSymbol,
      request: response?.config?.params ?? null,
      attempts: chainResult.tried,
      succeededWith: chainResult.succeededWith,
      ...(isSpxRequest && extraRows.length
        ? { proxiedFrom: "SPY", proxyRowCount: extraRows.length }
        : {}),
      quotes: quotesResponse.data,
      ...(vix ? { vix } : {}),
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

function parseMarketCapValue(value) {
  if (!value) return 0;

  const raw = String(value).trim().replace(/[$,]/g, "").toUpperCase();
  const n = parseFloat(raw);

  if (!Number.isFinite(n)) return 0;

  if (raw.endsWith("T")) return n * 1e12;
  if (raw.endsWith("B")) return n * 1e9;
  if (raw.endsWith("M")) return n * 1e6;

  return n;
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

    const headers = parseCsvLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ""));
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
      const marketCap = idx.MarketCap != null ? (cols[idx.MarketCap] || "") : "";

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
        marketCap,
        releaseLabel: formatReportingLabel(timeOfTheDay)
      };
    }).filter(ev =>
      ev.symbol &&
      ev.releaseDate &&
      ev.releaseDate >= from &&
      ev.releaseDate <= to &&
      parseMarketCapValue(ev.marketCap) >= 20e9
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

app.get("/api/gex-history", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 500);

    const result = await turso.execute({
      sql: `
        SELECT
          dateRecorded,
          kingGEX,
          callWall,
          putWall,
          netGamma,
          totalPosGamma,
          totalNegGamma,
          spyOpen,
          spyClose,
          spyChange
        FROM GexHistory
        ORDER BY dateRecorded DESC
        LIMIT ?
      `,
      args: [limit]
    });

    res.json({
      ok: true,
      count: result.rows?.length || 0,
      rows: result.rows || []
    });
  } catch (error) {
    console.error("GEX HISTORY READ ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to load GEX history.",
      details: error.message
    });
  }
});

app.post("/api/gex-history/snapshot", async (req, res) => {
  try {
    await saveGexHistorySnapshot(req.body || {});

    res.json({
      ok: true,
      saved: 1
    });
  } catch (error) {
    console.error("GEX HISTORY SAVE ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to save GEX history.",
      details: error.message
    });
  }
});

app.post("/api/put-call-history/snapshot", async (req, res) => {
  try {
    await savePutCallHistorySnapshot(req.body || {});
    res.json({ ok: true, saved: 1 });
  } catch (error) {
    console.error("PUT_CALL HISTORY SAVE ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to save put/call history.",
      details: error.message
    });
  }
});

app.get("/api/put-call-history/lookback", async (_req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, oneWeek: null, oneMonth: null });
    }

    const today = getCstDateKey();

    const result = await turso.execute({
      sql: `
        SELECT date, p_c_ratio
        FROM put_call_history
        WHERE date <= ?
        ORDER BY date DESC
        LIMIT 60
      `,
      args: [today]
    });

    const rows = result.rows || [];

    function pickClosest(daysBack) {
      const target = new Date(`${today}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() - daysBack);
      const targetKey = target.toISOString().slice(0, 10);
      const match = rows.find(r => String(r.date) <= targetKey);
      return match
        ? { date: match.date, p_c_ratio: Number(match.p_c_ratio) }
        : null;
    }

    const previousRow = rows.find(r => String(r.date) < today) || null;
    const previous = previousRow
      ? { date: previousRow.date, p_c_ratio: Number(previousRow.p_c_ratio) }
      : null;

    res.json({
      ok: true,
      oneWeek: pickClosest(7),
      oneMonth: pickClosest(30),
      previous
    });
  } catch (error) {
    console.error("PUT_CALL HISTORY READ ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to load put/call history.",
      details: error.message
    });
  }
});

app.get("/api/put-call-history", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
    const result = await turso.execute({
      sql: `
        SELECT date, p_c_ratio, spy_open, spy_close, spy_change
        FROM put_call_history
        ORDER BY date DESC
        LIMIT ?
      `,
      args: [limit]
    });
    res.json({ ok: true, count: result.rows?.length || 0, rows: result.rows || [] });
  } catch (error) {
    console.error("PUT_CALL HISTORY READ ERROR:", error.message);
    res.status(500).json({
      ok: false,
      error: "Failed to load put/call history.",
      details: error.message
    });
  }
});

// ── Trade Journal (full lifecycle: open / average-in / close) ─────────
// Uses two tables: TradeJournal (parent) + TradeEntries (initial / averagein / close legs).
function tjNowParts() {
  const p = getCstParts();
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

function tjNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tjStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function tjLoadEntries(tradeId) {
  const r = await turso.execute({
    sql: `SELECT EntryID, TradeID, EntryType, Quantity, Price, EntryDate, EntryTime, Notes
          FROM TradeEntries WHERE TradeID = ? ORDER BY EntryID ASC`,
    args: [tradeId]
  });
  return r.rows || [];
}

function tjAggregate(trade, entries) {
  let qtyOpen = 0, costOpen = 0;
  let qtyClosed = 0, proceeds = 0, costBasisClosed = 0;
  // Use moving weighted average. Closes consume at avg cost-at-time.
  let avg = 0;
  for (const e of entries) {
    const q = Number(e.Quantity) || 0;
    const px = Number(e.Price) || 0;
    if (e.EntryType === 'initial' || e.EntryType === 'averagein') {
      const newQty = qtyOpen + q;
      const newCost = costOpen + q * px;
      qtyOpen = newQty;
      costOpen = newCost;
      avg = qtyOpen > 0 ? costOpen / qtyOpen : 0;
    } else if (e.EntryType === 'close') {
      const closeQ = Math.min(q, qtyOpen);
      qtyClosed += closeQ;
      proceeds += closeQ * px;
      costBasisClosed += closeQ * avg;
      qtyOpen -= closeQ;
      costOpen = qtyOpen * avg;
    }
  }
  const mult = trade.TradeType === 'option' ? 100 : 1;
  const realizedPL = (proceeds - costBasisClosed) * mult;
  const realizedPLPct = costBasisClosed > 0 ? ((proceeds - costBasisClosed) / costBasisClosed) * 100 : null;
  const totalOpenedQty = entries
    .filter(e => e.EntryType === 'initial' || e.EntryType === 'averagein')
    .reduce((s, e) => s + (Number(e.Quantity) || 0), 0);
  const totalClosedQty = entries
    .filter(e => e.EntryType === 'close')
    .reduce((s, e) => s + (Number(e.Quantity) || 0), 0);
  const totalCapital = entries
    .filter(e => e.EntryType === 'initial' || e.EntryType === 'averagein')
    .reduce((s, e) => s + (Number(e.Quantity) || 0) * (Number(e.Price) || 0), 0) * mult;
  return {
    quantityOpen: qtyOpen,
    quantityClosed: totalClosedQty,
    quantityTotal: totalOpenedQty,
    avgCostBasis: totalOpenedQty > 0 ? (entries
      .filter(e => e.EntryType === 'initial' || e.EntryType === 'averagein')
      .reduce((s, e) => s + (Number(e.Quantity) || 0) * (Number(e.Price) || 0), 0) / totalOpenedQty) : 0,
    totalCapital,
    realizedPL,
    realizedPLPercent: realizedPLPct,
    fullyClosed: qtyOpen <= 0.0000001 && totalClosedQty > 0
  };
}

async function tjLoadTradeWithEntries(tradeId) {
  const t = await turso.execute({
    sql: `SELECT * FROM TradeJournal WHERE TradeID = ?`,
    args: [tradeId]
  });
  const trade = t.rows?.[0] || null;
  if (!trade) return null;
  const entries = await tjLoadEntries(tradeId);
  const agg = tjAggregate(trade, entries);
  return { ...trade, entries, ...agg };
}

app.get("/api/trade-journal", async (_req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }
    const t = await turso.execute(`SELECT * FROM TradeJournal ORDER BY TradeID DESC`);
    const trades = t.rows || [];
    const e = await turso.execute(`SELECT EntryID, TradeID, EntryType, Quantity, Price, EntryDate, EntryTime, Notes FROM TradeEntries ORDER BY EntryID ASC`);
    const byTrade = new Map();
    for (const row of (e.rows || [])) {
      const k = Number(row.TradeID);
      if (!byTrade.has(k)) byTrade.set(k, []);
      byTrade.get(k).push(row);
    }
    const out = trades.map(tr => {
      const entries = byTrade.get(Number(tr.TradeID)) || [];
      const agg = tjAggregate(tr, entries);
      return { ...tr, entries, ...agg };
    });
    res.json({ ok: true, rows: out });
  } catch (error) {
    console.error("TRADE_JOURNAL LIST ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to load trade journal.", details: error.message });
  }
});

app.get("/api/trade-journal/:id(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    if (!Number.isFinite(tradeId)) return res.status(400).json({ ok: false, error: "Invalid id" });
    const trade = await tjLoadTradeWithEntries(tradeId);
    if (!trade) return res.status(404).json({ ok: false, error: "Trade not found" });
    res.json({ ok: true, trade });
  } catch (error) {
    console.error("TRADE_JOURNAL READ ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to load trade.", details: error.message });
  }
});

app.post("/api/trade-journal", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.status(503).json({ ok: false, error: "Trade journal storage is not configured." });
    }
    const b = req.body || {};
    const tradeType = String(b.tradeType || '').toLowerCase();
    if (tradeType !== 'stock' && tradeType !== 'option') {
      return res.status(400).json({ ok: false, error: "tradeType must be 'stock' or 'option'." });
    }
    const ticker = tjStr(b.ticker);
    if (!ticker) return res.status(400).json({ ok: false, error: "ticker is required." });
    const quantity = tjNum(b.quantity);
    const price = tjNum(b.price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be > 0." });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ ok: false, error: "price must be > 0." });
    }
    const now = tjNowParts();
    const entryDate = tjStr(b.entryDate) || now.date;
    const entryTime = tjStr(b.entryTime) || now.time;

    const insert = await turso.execute({
      sql: `INSERT INTO TradeJournal
        (TradeType, Ticker, EntryDate, EntryTime, Thesis, TargetPrice, StopLoss, Status,
         OptionType, Strike, Expiration, Tags, SetupType, Grade, Emotion, Mistakes, Lessons, ScreenshotUrl)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tradeType,
        ticker.toUpperCase(),
        entryDate,
        entryTime,
        tjStr(b.thesis),
        tjNum(b.targetPrice),
        tjNum(b.stopLoss),
        tradeType === 'option' ? tjStr(b.optionType)?.toLowerCase() : null,
        tradeType === 'option' ? tjNum(b.strike) : null,
        tradeType === 'option' ? tjStr(b.expiration) : null,
        tjStr(b.tags),
        tjStr(b.setupType),
        tjStr(b.grade),
        tjStr(b.emotion),
        tjStr(b.mistakes),
        tjStr(b.lessons),
        tjStr(b.screenshotUrl)
      ]
    });
    const tradeId = Number(insert.lastInsertRowid);

    await turso.execute({
      sql: `INSERT INTO TradeEntries (TradeID, EntryType, Quantity, Price, EntryDate, EntryTime, Notes)
            VALUES (?, 'initial', ?, ?, ?, ?, ?)`,
      args: [tradeId, quantity, price, entryDate, entryTime, tjStr(b.entryNotes)]
    });

    const trade = await tjLoadTradeWithEntries(tradeId);
    res.json({ ok: true, trade });
  } catch (error) {
    console.error("TRADE_JOURNAL CREATE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to create trade.", details: error.message });
  }
});

app.put("/api/trade-journal/:id(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    if (!Number.isFinite(tradeId)) return res.status(400).json({ ok: false, error: "Invalid id" });
    const b = req.body || {};
    const allowed = [
      ['Thesis', 'thesis', tjStr],
      ['TargetPrice', 'targetPrice', tjNum],
      ['StopLoss', 'stopLoss', tjNum],
      ['Tags', 'tags', tjStr],
      ['SetupType', 'setupType', tjStr],
      ['Grade', 'grade', tjStr],
      ['Emotion', 'emotion', tjStr],
      ['Mistakes', 'mistakes', tjStr],
      ['Lessons', 'lessons', tjStr],
      ['ScreenshotUrl', 'screenshotUrl', tjStr],
      ['Ticker', 'ticker', v => tjStr(v)?.toUpperCase() || null],
      ['OptionType', 'optionType', v => tjStr(v)?.toLowerCase() || null],
      ['Strike', 'strike', tjNum],
      ['Expiration', 'expiration', tjStr]
    ];
    const sets = [];
    const args = [];
    for (const [col, key, conv] of allowed) {
      if (b[key] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(conv(b[key]));
      }
    }
    if (!sets.length) return res.json({ ok: true, updated: 0 });
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    args.push(tradeId);
    await turso.execute({
      sql: `UPDATE TradeJournal SET ${sets.join(', ')} WHERE TradeID = ?`,
      args
    });
    const trade = await tjLoadTradeWithEntries(tradeId);
    res.json({ ok: true, trade });
  } catch (error) {
    console.error("TRADE_JOURNAL UPDATE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to update trade.", details: error.message });
  }
});

app.delete("/api/trade-journal/:id(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    if (!Number.isFinite(tradeId)) return res.status(400).json({ ok: false, error: "Invalid id" });
    await turso.execute({ sql: `DELETE FROM TradeEntries WHERE TradeID = ?`, args: [tradeId] });
    await turso.execute({ sql: `DELETE FROM TradeJournal WHERE TradeID = ?`, args: [tradeId] });
    res.json({ ok: true, deleted: tradeId });
  } catch (error) {
    console.error("TRADE_JOURNAL DELETE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to delete trade.", details: error.message });
  }
});

app.post("/api/trade-journal/:id(\\d+)/average-in", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    if (!Number.isFinite(tradeId)) return res.status(400).json({ ok: false, error: "Invalid id" });
    const b = req.body || {};
    const quantity = tjNum(b.quantity);
    const price = tjNum(b.price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be > 0." });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ ok: false, error: "price must be > 0." });
    }
    const now = tjNowParts();
    await turso.execute({
      sql: `INSERT INTO TradeEntries (TradeID, EntryType, Quantity, Price, EntryDate, EntryTime, Notes)
            VALUES (?, 'averagein', ?, ?, ?, ?, ?)`,
      args: [tradeId, quantity, price, tjStr(b.date) || now.date, tjStr(b.time) || now.time, tjStr(b.notes)]
    });
    // Re-open trade if it was previously fully closed.
    await turso.execute({
      sql: `UPDATE TradeJournal SET Status = 'open', CloseDate = NULL, CloseTime = NULL,
            RealizedPL = NULL, RealizedPLPercent = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE TradeID = ?`,
      args: [tradeId]
    });
    const trade = await tjLoadTradeWithEntries(tradeId);
    res.json({ ok: true, trade });
  } catch (error) {
    console.error("TRADE_JOURNAL AVG-IN ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to add average-in.", details: error.message });
  }
});

app.post("/api/trade-journal/:id(\\d+)/close", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    if (!Number.isFinite(tradeId)) return res.status(400).json({ ok: false, error: "Invalid id" });
    const b = req.body || {};
    const quantity = tjNum(b.quantity);
    const price = tjNum(b.price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be > 0." });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ ok: false, error: "price must be > 0." });
    }
    const now = tjNowParts();
    const closeDate = tjStr(b.date) || now.date;
    const closeTime = tjStr(b.time) || now.time;
    await turso.execute({
      sql: `INSERT INTO TradeEntries (TradeID, EntryType, Quantity, Price, EntryDate, EntryTime, Notes)
            VALUES (?, 'close', ?, ?, ?, ?, ?)`,
      args: [tradeId, quantity, price, closeDate, closeTime, tjStr(b.notes)]
    });

    // Recompute, persist Status/RealizedPL on parent when fully closed.
    const trade = await tjLoadTradeWithEntries(tradeId);
    if (trade.fullyClosed) {
      await turso.execute({
        sql: `UPDATE TradeJournal SET Status = 'closed', CloseDate = ?, CloseTime = ?,
              RealizedPL = ?, RealizedPLPercent = ?, updated_at = CURRENT_TIMESTAMP
              WHERE TradeID = ?`,
        args: [closeDate, closeTime, trade.realizedPL, trade.realizedPLPercent, tradeId]
      });
    } else {
      await turso.execute({
        sql: `UPDATE TradeJournal SET RealizedPL = ?, RealizedPLPercent = ?, updated_at = CURRENT_TIMESTAMP
              WHERE TradeID = ?`,
        args: [trade.realizedPL, trade.realizedPLPercent, tradeId]
      });
    }
    const fresh = await tjLoadTradeWithEntries(tradeId);
    res.json({ ok: true, trade: fresh });
  } catch (error) {
    console.error("TRADE_JOURNAL CLOSE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to close trade.", details: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Broker CSV import (Robinhood-style activity log → historical trades)
// ─────────────────────────────────────────────────────────────────────

// RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes, and
// embedded commas. Returns array of arrays.
function parseCsvText(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const src = String(text).replace(/^﻿/, '');
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every(c => !String(c).trim())) rows.pop();
  return rows;
}

// Money normalization per spec:
//   "$1,134.92"   →  1134.92
//   "($1,099.04)" → -1099.04
//   "-$50.00"     →   -50.00
//   ""/null       →  null
function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  s = s.replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function parseQty(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Normalize a date to ISO YYYY-MM-DD. Accepts M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD.
function normalizeBrokerDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let yr = m[3];
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return s; // fallback
}

// Build a {logical key -> column index} map from header row.
function mapBrokerHeader(headerRow) {
  const norm = headerRow.map(h => String(h || '').trim().toLowerCase());
  const find = (...candidates) => {
    for (const c of candidates) {
      const i = norm.indexOf(c);
      if (i >= 0) return i;
    }
    // partial-match fallback
    for (let i = 0; i < norm.length; i++) {
      for (const c of candidates) {
        if (norm[i].includes(c)) return i;
      }
    }
    return -1;
  };
  return {
    activityDate: find('activity date', 'date', 'trade date'),
    symbol: find('instrument', 'symbol', 'ticker'),
    description: find('description'),
    transCode: find('trans code', 'transaction code', 'action', 'type'),
    quantity: find('quantity', 'qty', 'shares'),
    price: find('price'),
    amount: find('amount', 'net amount')
  };
}

// Identify trade rows. Non-trade activity (ACH, dividends, etc.) is skipped.
function classifyTransCode(raw) {
  const c = String(raw || '').trim().toUpperCase();
  if (!c) return { skip: true };
  if (c === 'BTO') return { side: 'open',  assetType: 'option' };
  if (c === 'STC') return { side: 'close', assetType: 'option' };
  if (c === 'BUY') return { side: 'open',  assetType: 'stock' };
  if (c === 'SELL') return { side: 'close', assetType: 'stock' };
  // Anything else (ACH, DIV, INT, JNL, WIRE, SWEEP, REC, etc.) is non-trade.
  return { skip: true };
}

// Parse option description: "SPY 7/17/2026 Put $720.00".
// Returns { ticker, expirationDate, optionType, strike } or null.
function parseOptionDescription(desc) {
  if (!desc) return null;
  const re = /^([A-Za-z.][A-Za-z.0-9-]{0,9})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(Call|Put)\s+\$?\s*([0-9][0-9,]*\.?\d*)/i;
  const m = String(desc).trim().match(re);
  if (!m) return null;
  return {
    ticker: m[1].toUpperCase(),
    expirationDate: normalizeBrokerDate(m[2]),
    optionType: m[3].toLowerCase(),
    strike: Number(m[4].replace(/,/g, ''))
  };
}

function instrumentKeyFor(parsed) {
  if (parsed.assetType === 'option') {
    return `OPT|${parsed.ticker}|${parsed.expirationDate}|${parsed.optionType}|${parsed.strike}`;
  }
  return `STK|${parsed.ticker}`;
}

// Core matcher. Takes already-parsed rows in chronological order.
// Returns { trades: [...], warnings: [...] } where each trade includes
// entries, closes, and matches with temporary IDs.
function matchBrokerRows(rows) {
  const trades = [];
  const warnings = [];
  const groups = new Map(); // instrumentKey -> { currentIdx, openLots: [] }
  let entryCounter = 0, closeCounter = 0;

  for (const r of rows) {
    let g = groups.get(r.instrumentKey);
    if (!g) { g = { currentIdx: null, openLots: [] }; groups.set(r.instrumentKey, g); }

    if (r.side === 'open') {
      let trade;
      if (g.currentIdx == null) {
        trade = {
          assetType: r.assetType,
          ticker: r.ticker,
          optionType: r.optionType || null,
          expirationDate: r.expirationDate || null,
          strike: r.strike ?? null,
          instrumentKey: r.instrumentKey,
          entries: [],
          closes: [],
          matches: []
        };
        trades.push(trade);
        g.currentIdx = trades.length - 1;
      } else {
        trade = trades[g.currentIdx];
      }

      const mult = r.assetType === 'option' ? 100 : 1;
      // Amount already includes fees → preferred. Fallback to price × qty × mult.
      const rawAmt = r.amount;
      const costBasis = rawAmt != null
        ? Math.abs(rawAmt)
        : (r.price != null && r.quantity != null ? r.price * r.quantity * mult : null);
      const entry = {
        tempId: ++entryCounter,
        tradeIdx: g.currentIdx,
        activityDate: r.activityDate,
        quantity: r.quantity,
        price: r.price,
        amount: rawAmt,
        costBasis,
        entryType: trade.entries.length === 0 ? 'Initial' : 'AverageIn',
        csvRow: r.csvRow,
        description: r.description,
        transCode: r.transCode
      };
      trade.entries.push(entry);
      g.openLots.push({
        entryTempId: entry.tempId,
        origQty: r.quantity,
        origCost: costBasis,
        remainingQty: r.quantity
      });

      // Sign of the Amount column doesn't affect P/L (we always use |Amount|
      // and take direction from Trans Code) so we don't warn on it.
    } else {
      // close
      if (g.currentIdx == null || g.openLots.length === 0) {
        warnings.push({
          csvRow: r.csvRow,
          type: 'unmatched_close',
          message: `${r.transCode} without prior matching open lot for ${r.instrumentKey}.`,
          raw: r.raw
        });
        continue;
      }
      const trade = trades[g.currentIdx];
      const mult = r.assetType === 'option' ? 100 : 1;
      const rawAmt = r.amount;
      const proceeds = rawAmt != null
        ? Math.abs(rawAmt)
        : (r.price != null && r.quantity != null ? r.price * r.quantity * mult : null);
      const closeRow = {
        tempId: ++closeCounter,
        tradeIdx: g.currentIdx,
        activityDate: r.activityDate,
        quantity: r.quantity,
        price: r.price,
        amount: rawAmt,
        proceeds,
        csvRow: r.csvRow,
        description: r.description,
        transCode: r.transCode
      };
      trade.closes.push(closeRow);

      // FIFO match.
      let qtyToClose = r.quantity;
      while (qtyToClose > 1e-9 && g.openLots.length) {
        const lot = g.openLots[0];
        const matchQty = Math.min(qtyToClose, lot.remainingQty);
        const fracOfLot = lot.origQty > 0 ? matchQty / lot.origQty : 0;
        const fracOfClose = closeRow.quantity > 0 ? matchQty / closeRow.quantity : 0;
        const allocatedEntryCost = (lot.origCost || 0) * fracOfLot;
        const allocatedCloseProceeds = (closeRow.proceeds || 0) * fracOfClose;
        const realizedPL = allocatedCloseProceeds - allocatedEntryCost;
        trade.matches.push({
          tradeIdx: g.currentIdx,
          entryTempId: lot.entryTempId,
          closeTempId: closeRow.tempId,
          matchedQuantity: matchQty,
          allocatedEntryCost,
          allocatedCloseProceeds,
          realizedPL,
          realizedPLPercent: allocatedEntryCost > 0 ? (realizedPL / allocatedEntryCost) * 100 : null
        });
        lot.remainingQty -= matchQty;
        qtyToClose -= matchQty;
        if (lot.remainingQty <= 1e-9) g.openLots.shift();
      }

      if (qtyToClose > 1e-9) {
        warnings.push({
          csvRow: r.csvRow,
          type: 'partial_unmatched_close',
          message: `Close quantity ${r.quantity} exceeded available open quantity by ${qtyToClose.toFixed(6)}. Matched what was available.`,
          raw: r.raw
        });
      }

      // If the position is fully flat, the next open starts a brand-new TradeID.
      if (g.openLots.length === 0) g.currentIdx = null;
    }
  }

  return { trades, warnings };
}

function computeBrokerTradeAggregates(t) {
  const totalOpened = t.entries.reduce((s, e) => s + (e.quantity || 0), 0);
  const totalClosed = t.closes.reduce((s, c) => s + (c.quantity || 0), 0);
  const remaining = totalOpened - totalClosed;
  const totalCostOpened = t.entries.reduce((s, e) => s + (e.costBasis || 0), 0);
  const matchedCost = t.matches.reduce((s, m) => s + (m.allocatedEntryCost || 0), 0);
  const totalProceeds = t.matches.reduce((s, m) => s + (m.allocatedCloseProceeds || 0), 0);
  const realizedPL = t.matches.reduce((s, m) => s + (m.realizedPL || 0), 0);
  const realizedPLPercent = matchedCost > 0 ? (realizedPL / matchedCost) * 100 : null;
  const remainingCost = totalCostOpened - matchedCost;
  const avgCostBasis = remaining > 1e-9 ? remainingCost / remaining : (totalOpened > 0 ? totalCostOpened / totalOpened : 0);
  const dates = [...t.entries.map(e => e.activityDate), ...t.closes.map(c => c.activityDate)].filter(Boolean).sort();
  const firstEntryDate = t.entries[0]?.activityDate || dates[0] || null;
  const lastCloseDate = t.closes.length ? t.closes[t.closes.length - 1].activityDate : null;
  const status = remaining <= 1e-9
    ? 'Closed'
    : (totalClosed > 1e-9 ? 'Partially Closed' : 'Open');
  Object.assign(t, {
    totalOpened, totalClosed, remaining,
    totalCostBasis: totalCostOpened,
    totalProceeds,
    averageCostBasis: avgCostBasis,
    realizedPL,
    realizedPLPercent,
    firstEntryDate,
    lastCloseDate,
    status
  });
}

async function persistBrokerImport(matched, warnings, batchId) {
  const insertedTradeIds = [];
  for (const t of matched.trades) {
    const tr = await turso.execute({
      sql: `INSERT INTO broker_log_hist_trades
        (AssetType, Ticker, OptionType, ExpirationDate, Strike, Status,
         FirstEntryDate, LastCloseDate, TotalOpenedQuantity, TotalClosedQuantity,
         RemainingQuantity, AverageCostBasis, TotalCostBasis, TotalProceeds,
         RealizedPL, RealizedPLPercent, InstrumentKey, ImportBatchID)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        t.assetType, t.ticker, t.optionType, t.expirationDate, t.strike, t.status,
        t.firstEntryDate, t.lastCloseDate, t.totalOpened, t.totalClosed,
        t.remaining, t.averageCostBasis, t.totalCostBasis, t.totalProceeds,
        t.realizedPL, t.realizedPLPercent, t.instrumentKey, batchId
      ]
    });
    const tradeId = Number(tr.lastInsertRowid);
    insertedTradeIds.push(tradeId);

    // Persist entries, capture real EntryIDs by temp.
    const entryTempToReal = new Map();
    for (const e of t.entries) {
      const er = await turso.execute({
        sql: `INSERT INTO broker_log_hist_entries
          (TradeID, ActivityDate, Quantity, Price, Amount, CostBasis,
           EntryType, OriginalCSVRowNumber, OriginalDescription, OriginalTransCode)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [tradeId, e.activityDate, e.quantity, e.price, e.amount,
               e.costBasis, e.entryType, e.csvRow, e.description, e.transCode]
      });
      entryTempToReal.set(e.tempId, Number(er.lastInsertRowid));
    }

    const closeTempToReal = new Map();
    for (const c of t.closes) {
      const cr = await turso.execute({
        sql: `INSERT INTO broker_log_hist_closes
          (TradeID, ActivityDate, Quantity, Price, Amount, Proceeds,
           OriginalCSVRowNumber, OriginalDescription, OriginalTransCode)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [tradeId, c.activityDate, c.quantity, c.price, c.amount,
               c.proceeds, c.csvRow, c.description, c.transCode]
      });
      closeTempToReal.set(c.tempId, Number(cr.lastInsertRowid));
    }

    for (const m of t.matches) {
      await turso.execute({
        sql: `INSERT INTO broker_log_hist_matches
          (TradeID, EntryID, CloseID, MatchedQuantity, AllocatedEntryCost,
           AllocatedCloseProceeds, RealizedPL, RealizedPLPercent)
          VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          tradeId,
          entryTempToReal.get(m.entryTempId),
          closeTempToReal.get(m.closeTempId),
          m.matchedQuantity,
          m.allocatedEntryCost,
          m.allocatedCloseProceeds,
          m.realizedPL,
          m.realizedPLPercent
        ]
      });
    }
  }

  for (const w of warnings) {
    await turso.execute({
      sql: `INSERT INTO broker_log_hist_warnings
        (ImportBatchID, OriginalCSVRowNumber, WarningType, WarningMessage, RawRowJSON)
        VALUES (?,?,?,?,?)`,
      args: [batchId, w.csvRow ?? null, w.type, w.message, w.raw ? JSON.stringify(w.raw) : null]
    });
  }
  return insertedTradeIds;
}

// POST /api/trade-journal/broker-import — body: { csv: "..." } or rows: [...]
app.post("/api/trade-journal/broker-import", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.status(503).json({ ok: false, error: "Storage not configured." });
    }
    const csv = req.body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ ok: false, error: "Missing CSV body (field: csv)." });
    }
    const replaceExisting = req.body?.replaceExisting === true;

    const rawRows = parseCsvText(csv);
    if (rawRows.length < 2) {
      return res.status(400).json({ ok: false, error: "CSV has no data rows." });
    }

    const headerMap = mapBrokerHeader(rawRows[0]);
    if (headerMap.activityDate < 0 || headerMap.transCode < 0 ||
        headerMap.symbol < 0 || headerMap.description < 0) {
      return res.status(400).json({
        ok: false,
        error: "CSV missing required columns. Need Activity Date, Symbol/Instrument, Description, Trans Code.",
        detectedHeaders: rawRows[0]
      });
    }

    const warnings = [];
    const tradeRows = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const csvRow = i + 1; // 1-based with header
      const get = (idx) => idx >= 0 && idx < row.length ? row[idx] : '';

      const transCodeRaw = String(get(headerMap.transCode) || '').trim();
      const classify = classifyTransCode(transCodeRaw);
      if (classify.skip) continue;

      const description = String(get(headerMap.description) || '').trim();
      const symbol = String(get(headerMap.symbol) || '').trim();
      const activityDate = normalizeBrokerDate(get(headerMap.activityDate));
      const quantity = parseQty(get(headerMap.quantity));
      const price = parseMoney(get(headerMap.price));
      const amount = parseMoney(get(headerMap.amount));

      if (quantity == null || quantity <= 0) {
        warnings.push({
          csvRow,
          type: 'invalid_quantity',
          message: `Quantity missing or non-positive. Skipped.`,
          raw: { row }
        });
        continue;
      }

      let assetType = classify.assetType;
      let ticker = null, optionType = null, expirationDate = null, strike = null;

      if (assetType === 'option') {
        const opt = parseOptionDescription(description);
        if (!opt) {
          warnings.push({
            csvRow,
            type: 'unparsed_option',
            message: `Could not parse option description: "${description}". Row not matched.`,
            raw: { row }
          });
          continue;
        }
        ticker = opt.ticker;
        optionType = opt.optionType;
        expirationDate = opt.expirationDate;
        strike = opt.strike;
        // Prefer Symbol column when present and consistent (e.g. SPY column for SPY options)
        if (symbol && symbol.toUpperCase() !== ticker.toUpperCase()) {
          // Trust the description's ticker (broker symbol may include sub-codes)
          // but log a soft warning if drastically different.
          if (!ticker.startsWith(symbol.toUpperCase())) {
            warnings.push({
              csvRow,
              type: 'symbol_mismatch',
              message: `Symbol column "${symbol}" differs from option description ticker "${ticker}". Used description.`,
              raw: { row }
            });
          }
        }
      } else {
        // stock
        if (!symbol) {
          warnings.push({
            csvRow,
            type: 'missing_symbol',
            message: 'Stock row missing Symbol/Ticker. Skipped.',
            raw: { row }
          });
          continue;
        }
        ticker = symbol.toUpperCase();
      }

      const parsed = {
        side: classify.side,
        assetType,
        ticker,
        optionType,
        expirationDate,
        strike,
        activityDate,
        quantity,
        price,
        amount,
        transCode: transCodeRaw,
        description,
        csvRow,
        raw: row
      };
      parsed.instrumentKey = instrumentKeyFor(parsed);
      tradeRows.push(parsed);
    }

    // ── Chronological sort, multi-fill-aware ─────────────────────────
    //
    // The broker CSV may be sorted newest-first (Robinhood) or oldest-first.
    // We detect direction by comparing the first and last *trade* row's
    // dates, then sort so that:
    //   1. Earliest date is processed first.
    //   2. Within a date, OPENS process before CLOSES — otherwise an STC on
    //      the same day as its BTO fires before any open lot exists and
    //      produces a bogus `unmatched_close`, leaving the subsequent BTO
    //      lots looking like a permanent open position.
    //   3. Within a date and same side, csvRow tiebreaks in real execution
    //      order: ASC for oldest-first CSVs, DESC for newest-first.
    //
    // This is the fix for the multi-fill matching bug — e.g. a single order
    // executed as 3 separate Buy fills on day 1 and a single Sell of 3 on
    // day 2 used to lose track of lots because same-day sells got reordered
    // ahead of same-day buys when the CSV was newest-first.
    let firstTradeDate = null, lastTradeDate = null;
    for (const r of tradeRows) {
      if (!r.activityDate) continue;
      if (firstTradeDate == null) firstTradeDate = r.activityDate;
      lastTradeDate = r.activityDate;
    }
    // tradeRows here is still in original CSV order, so first/last reflect
    // the CSV's own direction. Newest-first iff first date > last date.
    const csvNewestFirst = firstTradeDate && lastTradeDate && firstTradeDate > lastTradeDate;

    tradeRows.sort((a, b) => {
      const da = a.activityDate || '';
      const db = b.activityDate || '';
      if (da !== db) return da < db ? -1 : 1;
      // Same date: opens always first so FIFO has lots to consume.
      if (a.side !== b.side) return a.side === 'open' ? -1 : 1;
      // Same date + same side: preserve real execution order.
      return csvNewestFirst ? (b.csvRow - a.csvRow) : (a.csvRow - b.csvRow);
    });

    const matched = matchBrokerRows(tradeRows);
    matched.warnings = [...warnings, ...matched.warnings];

    for (const t of matched.trades) computeBrokerTradeAggregates(t);

    if (replaceExisting) {
      await turso.execute(`DELETE FROM broker_log_hist_matches`);
      await turso.execute(`DELETE FROM broker_log_hist_closes`);
      await turso.execute(`DELETE FROM broker_log_hist_entries`);
      await turso.execute(`DELETE FROM broker_log_hist_warnings`);
      await turso.execute(`DELETE FROM broker_log_hist_trades`);
    }

    const batchId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const insertedIds = await persistBrokerImport(matched, matched.warnings, batchId);

    res.json({
      ok: true,
      batchId,
      tradesImported: insertedIds.length,
      warningsCount: matched.warnings.length,
      summary: {
        rowsProcessed: tradeRows.length,
        rawCsvRows: rawRows.length - 1,
        skippedNonTrade: (rawRows.length - 1) - tradeRows.length - matched.warnings.filter(w =>
          ['invalid_quantity','unparsed_option','missing_symbol'].includes(w.type)).length
      }
    });
  } catch (error) {
    console.error("BROKER_IMPORT ERROR:", error);
    res.status(500).json({ ok: false, error: "Import failed.", details: error.message });
  }
});

// GET /api/trade-journal/broker — list with entries, closes, matches, warnings
app.get("/api/trade-journal/broker", async (_req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [], warnings: [] });
    }
    const t = await turso.execute(`SELECT * FROM broker_log_hist_trades ORDER BY FirstEntryDate DESC, TradeID DESC`);
    const e = await turso.execute(`SELECT * FROM broker_log_hist_entries ORDER BY EntryID ASC`);
    const c = await turso.execute(`SELECT * FROM broker_log_hist_closes ORDER BY CloseID ASC`);
    const m = await turso.execute(`SELECT * FROM broker_log_hist_matches ORDER BY MatchID ASC`);
    const w = await turso.execute(`SELECT * FROM broker_log_hist_warnings ORDER BY WarningID DESC LIMIT 10000`);
    const entriesByTrade = new Map();
    const closesByTrade = new Map();
    const matchesByTrade = new Map();
    for (const row of (e.rows || [])) {
      const k = Number(row.TradeID);
      if (!entriesByTrade.has(k)) entriesByTrade.set(k, []);
      entriesByTrade.get(k).push(row);
    }
    for (const row of (c.rows || [])) {
      const k = Number(row.TradeID);
      if (!closesByTrade.has(k)) closesByTrade.set(k, []);
      closesByTrade.get(k).push(row);
    }
    for (const row of (m.rows || [])) {
      const k = Number(row.TradeID);
      if (!matchesByTrade.has(k)) matchesByTrade.set(k, []);
      matchesByTrade.get(k).push(row);
    }
    const trades = (t.rows || []).map(tr => ({
      ...tr,
      entries: entriesByTrade.get(Number(tr.TradeID)) || [],
      closes: closesByTrade.get(Number(tr.TradeID)) || [],
      matches: matchesByTrade.get(Number(tr.TradeID)) || []
    }));
    res.json({ ok: true, rows: trades, warnings: w.rows || [] });
  } catch (error) {
    console.error("BROKER_LIST ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to load broker trades.", details: error.message });
  }
});

// ── Broker trade CRUD ────────────────────────────────────────────────
// After any entry/close edit we re-run FIFO matching for just this trade
// and rewrite the matches table + aggregate fields on the parent row, so
// realized P/L, average cost, status, etc. stay in sync with the legs.
async function tjBrokerReaggregateTrade(tradeId) {
  const parentRes = await turso.execute({
    sql: `SELECT * FROM broker_log_hist_trades WHERE TradeID = ?`, args: [tradeId]
  });
  const parent = parentRes.rows?.[0];
  if (!parent) return null;

  const entries = (await turso.execute({
    sql: `SELECT * FROM broker_log_hist_entries WHERE TradeID = ? ORDER BY ActivityDate ASC, EntryID ASC`,
    args: [tradeId]
  })).rows || [];
  const closes = (await turso.execute({
    sql: `SELECT * FROM broker_log_hist_closes WHERE TradeID = ? ORDER BY ActivityDate ASC, CloseID ASC`,
    args: [tradeId]
  })).rows || [];

  // Interleave entries and closes in chronological order. Entries break ties
  // by going before closes so an STC on the same day matches against its open.
  const legs = [];
  for (const e of entries) legs.push({ kind: 'open', leg: e, ts: e.ActivityDate || '', id: e.EntryID });
  for (const c of closes) legs.push({ kind: 'close', leg: c, ts: c.ActivityDate || '', id: c.CloseID });
  legs.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'open' ? -1 : 1;
    return a.id - b.id;
  });

  const mult = parent.AssetType === 'option' ? 100 : 1;
  // FIFO state.
  let openLots = [];
  const newMatches = [];
  for (const item of legs) {
    if (item.kind === 'open') {
      const q = Number(item.leg.Quantity) || 0;
      const amt = item.leg.Amount;
      const cost = amt != null
        ? Math.abs(Number(amt))
        : (Number(item.leg.Price) * q * mult);
      openLots.push({
        entryId: item.leg.EntryID,
        origQty: q,
        origCost: cost,
        remainingQty: q
      });
    } else {
      let qtyToClose = Number(item.leg.Quantity) || 0;
      const closeQty = qtyToClose;
      const closeAmt = item.leg.Amount;
      const proceeds = closeAmt != null
        ? Math.abs(Number(closeAmt))
        : (Number(item.leg.Price) * closeQty * mult);
      while (qtyToClose > 1e-9 && openLots.length) {
        const lot = openLots[0];
        const matchQty = Math.min(qtyToClose, lot.remainingQty);
        const fracLot = lot.origQty > 0 ? matchQty / lot.origQty : 0;
        const fracClose = closeQty > 0 ? matchQty / closeQty : 0;
        const allocCost = lot.origCost * fracLot;
        const allocProc = proceeds * fracClose;
        const pl = allocProc - allocCost;
        newMatches.push({
          entryId: lot.entryId,
          closeId: item.leg.CloseID,
          matchedQuantity: matchQty,
          allocatedEntryCost: allocCost,
          allocatedCloseProceeds: allocProc,
          realizedPL: pl,
          realizedPLPercent: allocCost > 0 ? (pl / allocCost) * 100 : null
        });
        lot.remainingQty -= matchQty;
        qtyToClose -= matchQty;
        if (lot.remainingQty <= 1e-9) openLots.shift();
      }
      // If qtyToClose > 0 we silently drop the excess; the trade row's stats
      // will reflect total opened vs. total closed and the editor can spot it.
    }
  }

  // Replace matches.
  await turso.execute({ sql: `DELETE FROM broker_log_hist_matches WHERE TradeID = ?`, args: [tradeId] });
  for (const m of newMatches) {
    await turso.execute({
      sql: `INSERT INTO broker_log_hist_matches
        (TradeID, EntryID, CloseID, MatchedQuantity, AllocatedEntryCost, AllocatedCloseProceeds, RealizedPL, RealizedPLPercent)
        VALUES (?,?,?,?,?,?,?,?)`,
      args: [tradeId, m.entryId, m.closeId, m.matchedQuantity, m.allocatedEntryCost, m.allocatedCloseProceeds, m.realizedPL, m.realizedPLPercent]
    });
  }

  const totalOpened = entries.reduce((s, e) => s + (Number(e.Quantity) || 0), 0);
  const totalClosed = closes.reduce((s, c) => s + (Number(c.Quantity) || 0), 0);
  const remaining = totalOpened - totalClosed;
  const totalCostOpened = entries.reduce((s, e) => s + (Number(e.CostBasis) || 0), 0);
  const matchedCost = newMatches.reduce((s, m) => s + m.allocatedEntryCost, 0);
  const totalProceeds = newMatches.reduce((s, m) => s + m.allocatedCloseProceeds, 0);
  const realizedPL = newMatches.reduce((s, m) => s + m.realizedPL, 0);
  const realizedPLPct = matchedCost > 0 ? (realizedPL / matchedCost) * 100 : null;
  const remainingCost = totalCostOpened - matchedCost;
  const avgCost = remaining > 1e-9 ? remainingCost / remaining : (totalOpened > 0 ? totalCostOpened / totalOpened : 0);
  const firstEntryDate = entries[0]?.ActivityDate || null;
  const lastCloseDate = closes.length ? closes[closes.length - 1].ActivityDate : null;
  const status = remaining <= 1e-9 && totalClosed > 0
    ? 'Closed'
    : (totalClosed > 1e-9 ? 'Partially Closed' : 'Open');

  await turso.execute({
    sql: `UPDATE broker_log_hist_trades SET
      Status = ?, FirstEntryDate = ?, LastCloseDate = ?,
      TotalOpenedQuantity = ?, TotalClosedQuantity = ?, RemainingQuantity = ?,
      AverageCostBasis = ?, TotalCostBasis = ?, TotalProceeds = ?,
      RealizedPL = ?, RealizedPLPercent = ?, UpdatedAt = CURRENT_TIMESTAMP
      WHERE TradeID = ?`,
    args: [status, firstEntryDate, lastCloseDate, totalOpened, totalClosed, remaining,
           avgCost, totalCostOpened, totalProceeds, realizedPL, realizedPLPct, tradeId]
  });

  return { status, realizedPL, realizedPLPercent: realizedPLPct, remaining };
}

// PUT /api/trade-journal/broker/:id — edit parent fields (annotations + instrument fixes)
app.put("/api/trade-journal/broker/:id(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const b = req.body || {};
    const allowed = [
      ['Ticker', 'ticker', v => v == null ? null : String(v).toUpperCase().trim() || null],
      ['AssetType', 'assetType', v => { const s = String(v || '').toLowerCase(); return (s === 'stock' || s === 'option') ? s : null; }],
      ['OptionType', 'optionType', v => v == null ? null : (String(v).toLowerCase() || null)],
      ['ExpirationDate', 'expirationDate', tjStr],
      ['Strike', 'strike', tjNum],
      ['Thesis', 'thesis', tjStr],
      ['Tags', 'tags', tjStr],
      ['SetupType', 'setupType', tjStr],
      ['Grade', 'grade', tjStr],
      ['Emotion', 'emotion', tjStr],
      ['Mistakes', 'mistakes', tjStr],
      ['Lessons', 'lessons', tjStr],
      ['Notes', 'notes', tjStr],
      ['ScreenshotUrl', 'screenshotUrl', tjStr]
    ];
    const sets = [], args = [];
    for (const [col, key, conv] of allowed) {
      if (b[key] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(conv(b[key]));
      }
    }
    if (!sets.length) return res.json({ ok: true, updated: 0 });
    sets.push(`UpdatedAt = CURRENT_TIMESTAMP`);
    args.push(tradeId);
    await turso.execute({
      sql: `UPDATE broker_log_hist_trades SET ${sets.join(', ')} WHERE TradeID = ?`,
      args
    });
    // If the instrument key bits changed, refresh InstrumentKey too.
    if (b.ticker !== undefined || b.optionType !== undefined || b.expirationDate !== undefined || b.strike !== undefined) {
      const r = (await turso.execute({ sql: `SELECT * FROM broker_log_hist_trades WHERE TradeID = ?`, args: [tradeId] })).rows?.[0];
      if (r) {
        const key = r.AssetType === 'option'
          ? `OPT|${r.Ticker}|${r.ExpirationDate}|${r.OptionType}|${r.Strike}`
          : `STK|${r.Ticker}`;
        await turso.execute({ sql: `UPDATE broker_log_hist_trades SET InstrumentKey = ? WHERE TradeID = ?`, args: [key, tradeId] });
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_PUT ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to update broker trade.", details: error.message });
  }
});

// DELETE /api/trade-journal/broker/:id — cascade delete one broker trade
app.delete("/api/trade-journal/broker/:id(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    await turso.execute({ sql: `DELETE FROM broker_log_hist_matches WHERE TradeID = ?`, args: [tradeId] });
    await turso.execute({ sql: `DELETE FROM broker_log_hist_closes WHERE TradeID = ?`, args: [tradeId] });
    await turso.execute({ sql: `DELETE FROM broker_log_hist_entries WHERE TradeID = ?`, args: [tradeId] });
    await turso.execute({ sql: `DELETE FROM broker_log_hist_trades WHERE TradeID = ?`, args: [tradeId] });
    res.json({ ok: true, deleted: tradeId });
  } catch (error) {
    console.error("BROKER_DELETE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to delete broker trade.", details: error.message });
  }
});

// Entry CRUD — also triggers re-aggregation of the parent trade.
function brokerLegFieldUpdates(b) {
  const map = [
    ['ActivityDate', 'activityDate', tjStr],
    ['Quantity', 'quantity', tjNum],
    ['Price', 'price', tjNum],
    ['Amount', 'amount', tjNum]
  ];
  const sets = [], args = [];
  for (const [col, key, conv] of map) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); args.push(conv(b[key])); }
  }
  return { sets, args };
}

// POST a new entry (BTO equivalent) onto an existing broker trade. CostBasis
// is derived from Amount when present, otherwise Price × Qty × multiplier.
// EntryType is auto: 'Initial' if the trade has no entries yet, else 'AverageIn'.
// After insert we re-run FIFO matching so the trade's status, totals, and
// realized P/L stay in sync.
app.post("/api/trade-journal/broker/:id(\\d+)/entry", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const b = req.body || {};
    const qty = tjNum(b.quantity);
    const price = tjNum(b.price);
    const amount = b.amount === undefined ? null : tjNum(b.amount);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be > 0." });
    }
    const trade = (await turso.execute({
      sql: `SELECT AssetType FROM broker_log_hist_trades WHERE TradeID = ?`,
      args: [tradeId]
    })).rows?.[0];
    if (!trade) return res.status(404).json({ ok: false, error: "Trade not found." });
    const mult = trade.AssetType === 'option' ? 100 : 1;
    const costBasis = amount != null
      ? Math.abs(amount)
      : (Number.isFinite(price) ? price * qty * mult : null);
    const existing = (await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM broker_log_hist_entries WHERE TradeID = ?`,
      args: [tradeId]
    })).rows?.[0]?.n || 0;
    const entryType = Number(existing) === 0 ? 'Initial' : 'AverageIn';
    await turso.execute({
      sql: `INSERT INTO broker_log_hist_entries
        (TradeID, ActivityDate, Quantity, Price, Amount, CostBasis, EntryType,
         OriginalCSVRowNumber, OriginalDescription, OriginalTransCode)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        tradeId,
        tjStr(b.activityDate) || tjNowParts().date,
        qty, price, amount, costBasis, entryType,
        null,
        tjStr(b.description) || 'manual-add',
        tjStr(b.transCode) || (trade.AssetType === 'option' ? 'BTO' : 'Buy')
      ]
    });
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_ENTRY_POST ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to add entry.", details: error.message });
  }
});

// POST a new close (STC equivalent) onto an existing broker trade. Proceeds
// is derived from |Amount| when present, otherwise Price × Qty × multiplier.
// After insert FIFO matching re-runs against the trade's full leg history.
app.post("/api/trade-journal/broker/:id(\\d+)/close", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const b = req.body || {};
    const qty = tjNum(b.quantity);
    const price = tjNum(b.price);
    const amount = b.amount === undefined ? null : tjNum(b.amount);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be > 0." });
    }
    const trade = (await turso.execute({
      sql: `SELECT AssetType FROM broker_log_hist_trades WHERE TradeID = ?`,
      args: [tradeId]
    })).rows?.[0];
    if (!trade) return res.status(404).json({ ok: false, error: "Trade not found." });
    const mult = trade.AssetType === 'option' ? 100 : 1;
    const proceeds = amount != null
      ? Math.abs(amount)
      : (Number.isFinite(price) ? price * qty * mult : null);
    await turso.execute({
      sql: `INSERT INTO broker_log_hist_closes
        (TradeID, ActivityDate, Quantity, Price, Amount, Proceeds,
         OriginalCSVRowNumber, OriginalDescription, OriginalTransCode)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        tradeId,
        tjStr(b.activityDate) || tjNowParts().date,
        qty, price, amount, proceeds,
        null,
        tjStr(b.description) || 'manual-add',
        tjStr(b.transCode) || (trade.AssetType === 'option' ? 'STC' : 'Sell')
      ]
    });
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_CLOSE_POST ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to add close.", details: error.message });
  }
});

app.put("/api/trade-journal/broker/:id(\\d+)/entry/:entryId(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    const b = req.body || {};
    const { sets, args } = brokerLegFieldUpdates(b);
    // Refresh CostBasis from Amount (or Price×Qty fallback) so re-aggregation
    // sees a consistent column. We re-fetch after the field updates.
    if (sets.length) {
      args.push(entryId);
      await turso.execute({
        sql: `UPDATE broker_log_hist_entries SET ${sets.join(', ')} WHERE EntryID = ?`,
        args
      });
    }
    const fresh = (await turso.execute({
      sql: `SELECT e.*, t.AssetType FROM broker_log_hist_entries e
            JOIN broker_log_hist_trades t ON t.TradeID = e.TradeID
            WHERE e.EntryID = ?`,
      args: [entryId]
    })).rows?.[0];
    if (fresh) {
      const mult = fresh.AssetType === 'option' ? 100 : 1;
      const cb = fresh.Amount != null
        ? Math.abs(Number(fresh.Amount))
        : (Number(fresh.Price) * Number(fresh.Quantity) * mult);
      await turso.execute({
        sql: `UPDATE broker_log_hist_entries SET CostBasis = ? WHERE EntryID = ?`,
        args: [Number.isFinite(cb) ? cb : null, entryId]
      });
    }
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_ENTRY_PUT ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to update entry.", details: error.message });
  }
});

app.delete("/api/trade-journal/broker/:id(\\d+)/entry/:entryId(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    await turso.execute({
      sql: `DELETE FROM broker_log_hist_matches WHERE EntryID = ? AND TradeID = ?`,
      args: [entryId, tradeId]
    });
    await turso.execute({ sql: `DELETE FROM broker_log_hist_entries WHERE EntryID = ?`, args: [entryId] });
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_ENTRY_DELETE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to delete entry.", details: error.message });
  }
});

app.put("/api/trade-journal/broker/:id(\\d+)/close/:closeId(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const closeId = Number(req.params.closeId);
    const b = req.body || {};
    const { sets, args } = brokerLegFieldUpdates(b);
    if (sets.length) {
      args.push(closeId);
      await turso.execute({
        sql: `UPDATE broker_log_hist_closes SET ${sets.join(', ')} WHERE CloseID = ?`,
        args
      });
    }
    const fresh = (await turso.execute({
      sql: `SELECT c.*, t.AssetType FROM broker_log_hist_closes c
            JOIN broker_log_hist_trades t ON t.TradeID = c.TradeID
            WHERE c.CloseID = ?`,
      args: [closeId]
    })).rows?.[0];
    if (fresh) {
      const mult = fresh.AssetType === 'option' ? 100 : 1;
      const proceeds = fresh.Amount != null
        ? Math.abs(Number(fresh.Amount))
        : (Number(fresh.Price) * Number(fresh.Quantity) * mult);
      await turso.execute({
        sql: `UPDATE broker_log_hist_closes SET Proceeds = ? WHERE CloseID = ?`,
        args: [Number.isFinite(proceeds) ? proceeds : null, closeId]
      });
    }
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_CLOSE_PUT ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to update close.", details: error.message });
  }
});

app.delete("/api/trade-journal/broker/:id(\\d+)/close/:closeId(\\d+)", async (req, res) => {
  try {
    const tradeId = Number(req.params.id);
    const closeId = Number(req.params.closeId);
    await turso.execute({
      sql: `DELETE FROM broker_log_hist_matches WHERE CloseID = ? AND TradeID = ?`,
      args: [closeId, tradeId]
    });
    await turso.execute({ sql: `DELETE FROM broker_log_hist_closes WHERE CloseID = ?`, args: [closeId] });
    await tjBrokerReaggregateTrade(tradeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_CLOSE_DELETE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to delete close.", details: error.message });
  }
});

// DELETE /api/trade-journal/broker — clear all broker imports
app.delete("/api/trade-journal/broker", async (_req, res) => {
  try {
    await turso.execute(`DELETE FROM broker_log_hist_matches`);
    await turso.execute(`DELETE FROM broker_log_hist_closes`);
    await turso.execute(`DELETE FROM broker_log_hist_entries`);
    await turso.execute(`DELETE FROM broker_log_hist_warnings`);
    await turso.execute(`DELETE FROM broker_log_hist_trades`);
    res.json({ ok: true });
  } catch (error) {
    console.error("BROKER_CLEAR ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to clear broker trades.", details: error.message });
  }
});

// ── Trade journal (Market Overview trade-entry checklist) ─────────────
// POST /api/trade-entry  → save a new trade entry
// GET  /api/trade-entries → list recent entries (most recent first)
app.post("/api/trade-entry", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.status(503).json({ ok: false, error: "Trade journal storage is not configured." });
    }
    const body = req.body || {};
    const date = body.date ? String(body.date).slice(0, 10) : getCstDateKey();
    const spy = body.spy_level != null && body.spy_level !== "" ? Number(body.spy_level) : null;
    const vix = body.vix_level != null && body.vix_level !== "" ? Number(body.vix_level) : null;
    const cap = body.capital_deployed != null && body.capital_deployed !== "" ? Number(body.capital_deployed) : null;
    let triggers = body.triggers_met;
    if (triggers && typeof triggers !== "string") {
      try { triggers = JSON.stringify(triggers); } catch (_) { triggers = String(triggers); }
    }
    const dirRaw = String(body.direction || "").toLowerCase();
    const direction = (dirRaw === "short" || dirRaw === "long") ? dirRaw : null;
    const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
    const result = await turso.execute({
      sql: `
        INSERT INTO trade_entry (date, spy_level, vix_level, triggers_met, capital_deployed, direction, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        date,
        Number.isFinite(spy) ? spy : null,
        Number.isFinite(vix) ? vix : null,
        triggers || null,
        Number.isFinite(cap) ? cap : null,
        direction,
        notes
      ]
    });
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (error) {
    console.error("TRADE_ENTRY SAVE ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to save trade entry.", details: error.message });
  }
});

app.get("/api/trade-entries", async (req, res) => {
  try {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      return res.json({ ok: true, rows: [] });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const result = await turso.execute({
      sql: `SELECT id, date, spy_level, vix_level, triggers_met, capital_deployed,
                   direction, notes, created_at
            FROM trade_entry ORDER BY id DESC LIMIT ?`,
      args: [limit]
    });
    res.json({ ok: true, rows: result.rows });
  } catch (error) {
    console.error("TRADE_ENTRIES READ ERROR:", error.message);
    res.status(500).json({ ok: false, error: "Failed to load trade entries.", details: error.message });
  }
});

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