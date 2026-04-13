const state = {
  quotes: null,
  heat: null,
  symbol: "SPY"
};

const navButtons = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");

const symbolSelect = document.getElementById("symbolSelect");
const strikeCountSelect = document.getElementById("strikeCountSelect");
const fromDateInput = document.getElementById("fromDateInput");
const toDateInput = document.getElementById("toDateInput");
const refreshBtn = document.getElementById("refreshBtn");
const connectBtn = document.getElementById("connectBtn");

const debugOutput = document.getElementById("debugOutput");

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatInteger(value) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString();
}

function formatCompact(value) {
  if (value == null || Number.isNaN(Number(value))) return "--";

  const abs = Math.abs(Number(value));
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return Number(value).toFixed(2);
}

function formatChange(num) {
  if (num == null || Number.isNaN(Number(num))) return "--";
  const value = Number(num);
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getFutureISO(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function setDefaultDates() {
  fromDateInput.value = getTodayISO();
  toDateInput.value = getFutureISO(7);
}

function setStatus(id, text, className = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = className;
}

function activateView(viewName) {
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  views.forEach((view) => {
    view.classList.remove("active");
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add("active");

  pageTitle.textContent = navLabel(viewName);
  pageSubtitle.textContent = navSubtitle(viewName);
}

function navLabel(viewName) {
  const labels = {
    "market-overview": "Market Overview",
    "strategy-tester": "Strategy Tester",
    agents: "Agents",
    "heat-seeker": "Heat Seeker",
    "options-flow": "Options Flow",
    "smart-money": "Smart Money",
    "dark-pool": "Dark Pool",
    mag7: "Mag 7",
    futures: "Futures",
    commodities: "Commodities & Metals",
    fx: "FX Markets",
    "penny-scanner": "Penny Scanner",
    "earnings-vol": "Earnings Vol",
    sentiment: "Sentiment",
    "treasury-risks": "Treasury & Risks"
  };

  return labels[viewName] || "Dashboard";
}

function navSubtitle(viewName) {
  if (viewName === "heat-seeker") {
    return "Strike-level gamma and open interest positioning";
  }
  if (viewName === "market-overview") {
    return "Live market structure and options positioning";
  }
  return "Dashboard section";
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function loadTokenStatus() {
  const data = await fetchJson("/api/token-status");
  const connected = !!data.connected;

  setStatus(
    "status-auth",
    connected ? "Connected" : "Disconnected",
    connected ? "positive" : "negative"
  );

  if (connectBtn) {
    connectBtn.style.display = connected ? "none" : "inline-block";
  }

  return connected;
}

async function loadDashboard() {
  const symbol = symbolSelect.value;
  const strikeCount = strikeCountSelect.value;
  const fromDate = fromDateInput.value;
  const toDate = toDateInput.value;

  const params = new URLSearchParams({
    symbol,
    strikeCount,
    fromDate,
    toDate
  });

  const data = await fetchJson(`/api/dashboard?${params.toString()}`);
  state.quotes = data.quotes || {};
  state.heat = data.heat || null;
  state.symbol = symbol;

  renderQuotes();
  renderHeat();

  setStatus("status-quotes", "Ready", "positive");
  setStatus("status-heat", "Ready", "positive");
}

function pickQuote(symbol) {
  return state.quotes?.[symbol] || null;
}

function renderQuotes() {
  const spy = pickQuote("SPY");
  const spx = pickQuote("SPX");
  const vix = pickQuote("VIX");
  const selected = pickQuote(state.symbol);

  updateQuoteCard("ov-spy-price", "ov-spy-change", spy);
  updateQuoteCard("ov-spx-price", "ov-spx-change", spx);
  updateQuoteCard("ov-vix-price", "ov-vix-change", vix);

  document.getElementById("ov-selected-symbol").textContent = state.symbol;
  document.getElementById("ov-selected-price").textContent = selected?.quote?.lastPrice != null
    ? formatNumber(selected.quote.lastPrice, 2)
    : "--";
}

function updateQuoteCard(priceId, changeId, quoteObj) {
  const priceEl = document.getElementById(priceId);
  const changeEl = document.getElementById(changeId);

  if (!quoteObj?.quote) {
    priceEl.textContent = "--";
    changeEl.textContent = "--";
    changeEl.className = "card-meta";
    return;
  }

  const price = quoteObj.quote.lastPrice ?? quoteObj.quote.mark ?? null;
  const change = quoteObj.quote.netChange ?? null;
  const pct = quoteObj.quote.netPercentChange ?? null;

  priceEl.textContent = formatNumber(price, 2);
  changeEl.textContent = `${formatChange(change)} (${formatChange(pct)}%)`;
  changeEl.className = `card-meta ${change > 0 ? "positive" : change < 0 ? "negative" : "neutral"}`;
}

function renderHeat() {
  const heat = state.heat;
  if (!heat) return;

  const underlyingPrice = heat.underlyingPrice ?? null;
  const summary = heat.summary || {};
  const strikes = Array.isArray(heat.strikes) ? heat.strikes : [];

  document.getElementById("ov-selected-symbol").textContent = heat.requestedSymbol || state.symbol;
  document.getElementById("ov-selected-price").textContent = formatNumber(underlyingPrice, 2);

  document.getElementById("sum-call-wall").textContent = summary.strongestCallWall?.strike ?? "--";
  document.getElementById("sum-put-wall").textContent = summary.strongestPutWall?.strike ?? "--";
  document.getElementById("sum-pos-gex").textContent = summary.strongestPositiveGex?.strike ?? "--";
  document.getElementById("sum-neg-gex").textContent = summary.strongestNegativeGex?.strike ?? "--";

  document.getElementById("heat-underlying-price").textContent = formatNumber(underlyingPrice, 2);
  document.getElementById("heat-underlying-symbol").textContent =
    `${heat.requestedSymbol} → ${heat.actualSymbol}`;

  document.getElementById("heat-call-wall").textContent = summary.strongestCallWall?.strike ?? "--";
  document.getElementById("heat-call-wall-oi").textContent =
    summary.strongestCallWall ? `OI ${formatInteger(summary.strongestCallWall.callOpenInterest)}` : "--";

  document.getElementById("heat-put-wall").textContent = summary.strongestPutWall?.strike ?? "--";
  document.getElementById("heat-put-wall-oi").textContent =
    summary.strongestPutWall ? `OI ${formatInteger(summary.strongestPutWall.putOpenInterest)}` : "--";

  const totalNet = strikes.reduce((sum, row) => sum + (Number(row.netGex) || 0), 0);
  document.getElementById("heat-bias").textContent =
    totalNet > 0 ? "Positive Gamma" : totalNet < 0 ? "Negative Gamma" : "Neutral";
  document.getElementById("heat-contract-count").textContent =
    `${formatInteger(heat.contractCount)} contracts`;

  document.getElementById("level-spot").textContent = formatNumber(underlyingPrice, 2);
  document.getElementById("level-call-wall").textContent = summary.strongestCallWall?.strike ?? "--";
  document.getElementById("level-put-wall").textContent = summary.strongestPutWall?.strike ?? "--";
  document.getElementById("level-pos-gex").textContent = summary.strongestPositiveGex?.strike ?? "--";
  document.getElementById("level-neg-gex").textContent = summary.strongestNegativeGex?.strike ?? "--";

  renderHeatGrid(strikes);
  renderStrikeTable(strikes);

  debugOutput.textContent = JSON.stringify(heat, null, 2);
  setStatus("status-updated", new Date().toLocaleTimeString(), "neutral");
}

function renderHeatGrid(strikes) {
  const heatGrid = document.getElementById("heatGrid");
  heatGrid.innerHTML = "";

  const maxAbs = Math.max(...strikes.map((row) => Math.abs(Number(row.netGex) || 0)), 1);

  strikes.forEach((row) => {
    const abs = Math.abs(Number(row.netGex) || 0);
    const widthPct = Math.max((abs / maxAbs) * 100, 2);
    const positive = Number(row.netGex) >= 0;

    const wrap = document.createElement("div");
    wrap.className = "heat-row";

    wrap.innerHTML = `
      <div class="heat-strike">${formatNumber(row.strike, 2)}</div>
      <div class="heat-bar-wrap">
        <div class="heat-bar ${positive ? "pos" : "neg"}" style="width:${widthPct}%"></div>
      </div>
      <div class="heat-value ${positive ? "positive" : "negative"}">${formatCompact(row.netGex)}</div>
    `;

    heatGrid.appendChild(wrap);
  });
}

function renderStrikeTable(strikes) {
  const tbody = document.getElementById("strikeTableBody");
  tbody.innerHTML = "";

  strikes.forEach((row) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${formatNumber(row.strike, 2)}</td>
      <td>${formatInteger(row.callOpenInterest)}</td>
      <td>${formatInteger(row.putOpenInterest)}</td>
      <td class="positive">${formatCompact(row.callGex)}</td>
      <td class="negative">${formatCompact(row.putGex)}</td>
      <td class="${Number(row.netGex) >= 0 ? "positive" : "negative"}">${formatCompact(row.netGex)}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Loading...";

  setStatus("status-quotes", "Loading", "neutral");
  setStatus("status-heat", "Loading", "neutral");

  try {
    const connected = await loadTokenStatus();

    if (!connected) {
      debugOutput.textContent = "Schwab connection required. Click Connect Schwab.";
      setStatus("status-quotes", "Waiting", "neutral");
      setStatus("status-heat", "Waiting", "neutral");
      return;
    }

    await loadDashboard();
  } catch (err) {
    console.error(err);
    debugOutput.textContent = String(err.message || err);
    setStatus("status-heat", "Error", "negative");
    setStatus("status-quotes", "Error", "negative");
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  }
}

connectBtn.addEventListener("click", () => {
  window.location.href = "/login";
});

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activateView(btn.dataset.view);
  });
});

symbolSelect.addEventListener("change", () => {
  state.symbol = symbolSelect.value;
  refreshAll();
});

strikeCountSelect.addEventListener("change", refreshAll);
fromDateInput.addEventListener("change", refreshAll);
toDateInput.addEventListener("change", refreshAll);

refreshBtn.addEventListener("click", refreshAll);

setDefaultDates();
activateView("market-overview");
refreshAll();