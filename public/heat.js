const state = {
    quotes: null,
    heat: null,
    symbol: "SPY",
    dteDays: 30
};

const navButtons = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

const symbolSelect = document.getElementById("symbolSelect");
const refreshBtn = document.getElementById("refreshBtn");
const connectBtn = document.getElementById("connectBtn");
const debugOutput = document.getElementById("debugOutput");

const symbolPills = document.querySelectorAll(".symbol-pill");
const dtePills = document.querySelectorAll(".dte-pill");

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
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return Number(value).toFixed(1);
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

    views.forEach((view) => view.classList.remove("active"));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add("active");
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

    connectBtn.style.display = connected ? "none" : "inline-block";
    return connected;
}

async function loadDashboard() {
    const symbol = symbolSelect.value;
    const today = getTodayISO();
    const toDate = getFutureISO(state.dteDays);

    const strikeCountBySymbol = {
        SPY: 70,
        SPX: 16,
        VIX: 30
    };

    const params = new URLSearchParams({
        symbol,
        strikeCount: String(strikeCountBySymbol[symbol] || 40),
        fromDate: today,
        toDate
    });

    const data = await fetchJson(`/api/dashboard?${params.toString()}`);
    state.quotes = data.quotes || {};
    state.heat = data.heat || null;
    state.symbol = symbol;

    renderOverview();
    renderHeatmap();

    setStatus("status-quotes", "Ready", "positive");
    setStatus("status-heat", "Ready", "positive");
    setStatus("status-updated", new Date().toLocaleTimeString(), "neutral");
}

function pickQuote(symbol) {
    return state.quotes?.[symbol] || null;
}

function renderOverview() {
    const heat = state.heat;
    if (!heat) return;

    const summary = heat.summary || {};
    const underlyingPrice = heat.underlyingPrice ?? null;

    document.getElementById("heat-underlying-price").textContent = formatNumber(underlyingPrice, 2);
    document.getElementById("heat-underlying-symbol").textContent =
        `${heat.requestedSymbol} → ${heat.actualSymbol}`;

    document.getElementById("heat-call-wall").textContent = summary.strongestCallWall?.strike ?? "--";
    document.getElementById("heat-call-wall-oi").textContent =
        summary.strongestCallWall
            ? `OI ${formatInteger(summary.strongestCallWall.callOpenInterest)}`
            : "--";

    document.getElementById("heat-put-wall").textContent = summary.strongestPutWall?.strike ?? "--";
    document.getElementById("heat-put-wall-oi").textContent =
        summary.strongestPutWall
            ? `OI ${formatInteger(summary.strongestPutWall.putOpenInterest)}`
            : "--";

    document.getElementById("king-strike-value").textContent =
        summary.kingStrike?.strike ?? "--";

    document.getElementById("king-strike-meta").textContent =
        summary.kingCell
            ? `${summary.kingCell.expKey.split(":")[0]} · ${formatCompact(summary.kingCell.netGex)}`
            : "--";

    const subtitle = document.getElementById("heatmapSubtitle");
    subtitle.textContent = `${heat.requestedSymbol} · Spot ${formatNumber(
        underlyingPrice,
        2
    )} · ${heat.contractCount.toLocaleString()} contracts`;
}

function mixColor(hex1, hex2, t) {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16)
    };
}

function getHeatCellColor(value, maxPositive, maxNegative) {
    const neutral = "#071122";
    const positive = "#DCFF1E";
    const negative = "#B423F0";

    const numeric = Number(value) || 0;

    if (numeric > 0) {
        const tRaw = maxPositive > 0 ? numeric / maxPositive : 0;
        const t = Math.min(Math.max(tRaw, 0), 1);
        const eased = Math.pow(t, 0.55);
        return mixColor(neutral, positive, eased);
    }

    if (numeric < 0) {
        const tRaw = maxNegative > 0 ? Math.abs(numeric) / maxNegative : 0;
        const t = Math.min(Math.max(tRaw, 0), 1);
        const eased = Math.pow(t, 0.55);
        return mixColor(neutral, negative, eased);
    }

    return neutral;
}

function getTextColor(value, maxPositive, maxNegative) {
    const numeric = Number(value) || 0;

    let t = 0;
    if (numeric > 0) {
        t = maxPositive > 0 ? numeric / maxPositive : 0;
    } else if (numeric < 0) {
        t = maxNegative > 0 ? Math.abs(numeric) / maxNegative : 0;
    }

    return t > 0.55 ? "#031019" : "#eaf3ff";
}

function renderHeatmap() {
    const heat = state.heat;
    if (!heat) return;

    const head = document.getElementById("heatmapHead");
    const body = document.getElementById("heatmapBody");

    head.innerHTML = "";
    body.innerHTML = "";

    let matrix = Array.isArray(heat.matrix) ? heat.matrix : [];
    const expirations = Array.isArray(heat.expirations) ? heat.expirations : [];
    const spot = Number(heat.underlyingPrice ?? 0);

    const displayBandBySymbol = {
        SPY: 30,
        SPX: 150,
        VIX: 10
    };

    const band = displayBandBySymbol[heat.requestedSymbol] || 30;

    matrix = matrix.filter((row) => Math.abs(Number(row.strike) - spot) <= band);
    const kingCell = heat.summary?.kingCell || null;
    const kingStrike = heat.summary?.kingStrike?.strike ?? null;

    const allValues = matrix.flatMap((row) => row.cells.map((cell) => Number(cell.netGex) || 0));
    const positiveValues = allValues.filter((v) => v > 0);
    const negativeValues = allValues.filter((v) => v < 0);

    const maxPositive = Math.max(...positiveValues, 1);
    const maxNegative = Math.max(...negativeValues.map((v) => Math.abs(v)), 1);

    const trHead = document.createElement("tr");
    const strikeTh = document.createElement("th");
    strikeTh.textContent = "STRIKE";
    trHead.appendChild(strikeTh);

    expirations.forEach((expKey) => {
        const th = document.createElement("th");
        th.textContent = expKey.split(":")[0];
        trHead.appendChild(th);
    });

    head.appendChild(trHead);

    matrix.forEach((row) => {
        const tr = document.createElement("tr");

        const strikeTd = document.createElement("td");
        strikeTd.className = "strike-cell";
        if (row.strike === kingStrike) {
            strikeTd.classList.add("king-strike");
        }
        strikeTd.textContent = formatNumber(row.strike, 1);
        tr.appendChild(strikeTd);

        row.cells.forEach((cell) => {
            const td = document.createElement("td");
            td.className = "gex-cell";

            if (
                kingCell &&
                cell.expKey === kingCell.expKey &&
                cell.strike === kingCell.strike
            ) {
                td.classList.add("king-cell");
            }

            if (Math.abs(cell.strike - spot) <= 0.01 || Math.abs(cell.strike - spot) < 0.6) {
                td.classList.add("current-strike");
            }

            const bg = getHeatCellColor(cell.netGex, maxPositive, maxNegative);
            const fg = getTextColor(cell.netGex, maxPositive, maxNegative);

            td.innerHTML = `<div class="gex-cell-inner">${formatCompact(cell.netGex)}</div>`;
            td.style.background = bg;
            td.style.color = fg;

            tr.appendChild(td);
        });

        body.appendChild(tr);
    });

    debugOutput.textContent = JSON.stringify(heat, null, 2);
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

symbolPills.forEach((pill) => {
    pill.addEventListener("click", () => {
        symbolPills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");

        const symbol = pill.dataset.symbol;
        symbolSelect.value = symbol === "QQQ" || symbol === "IWM" ? "SPY" : symbol;
        state.symbol = symbolSelect.value;
        refreshAll();
    });
});

dtePills.forEach((pill) => {
    pill.addEventListener("click", () => {
        dtePills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        state.dteDays = Number(pill.dataset.days || 30);
        refreshAll();
    });
});

symbolSelect.addEventListener("change", () => {
    state.symbol = symbolSelect.value;

    symbolPills.forEach((p) => {
        p.classList.toggle("active", p.dataset.symbol === symbolSelect.value);
    });

    refreshAll();
});

refreshBtn.addEventListener("click", refreshAll);

activateView("heat-seeker");
refreshAll();