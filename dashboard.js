
// ── Render proxy fetch ─────────────────────────────────────────────────────
// IMPORTANT: Update PROXY_URL after deploying to Render
const PROXY_URL = "https://atg-dashboard.onrender.com/api/tanks";

async function fetchAllFromProxy() {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch(PROXY_URL, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error("Proxy error " + resp.status);
    return await resp.json();
  } catch(e) {
    clearTimeout(tid);
    throw e;
  }
}


// Parse alarms already in JSON format from proxy
function parseProxyAlarms(data) {
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    const catLower = (item.catdesc || "").toLowerCase();
    let severity = "alarm";
    if (catLower.includes("warn")) severity = "warning";
    if (catLower.includes("info")) severity = "information";
    let timeStr = "";
    if (item.tmactive) {
      const d    = new Date(parseInt(item.tmactive) * 1000);
      const mm   = String(d.getMonth() + 1).padStart(2, "0");
      const dd   = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      const t    = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      const dayStr = days === 0 ? "today" : days === 1 ? "1 day" : days + " days";
      timeStr = mm + "/" + dd + "/" + yyyy + " " + t + " (" + dayStr + " active)";
    }
    return {
      logNum:      item.itemnum || "",
      label:       item.itemlabel || "",
      tankLabel:   item.itemlabel || "",
      description: item.alarmdesc || item.catdesc || "Alarm",
      category:    item.catdesc || "Alarm",
      severity:    severity,
      timeActive:  timeStr,
    };
  });
}

const SITES = [
  { name: "Central Operations FMO",        addr: "2540 Westinghouse Blvd", url: "http://63.46.75.214:10001" },
  { name: "Northeast Remote Ops FMO",      addr: "7702 Burwell St",        url: "http://166.146.80.90:10001" },
  { name: "Heavy Equipment Shop FMO",      addr: "4120 New Bern Ave",      url: "http://63.46.75.226:10001" },
  { name: "Public Utilities Field Ops RW", addr: "3304 Lake Woodard Dr",   url: "http://63.46.75.230:10001" },
  { name: "Wilders Grove SWS",             addr: "610 Beacon Lake Dr",     url: "http://63.46.75.218:10001" },
  { name: "Marsh Creek PRCR",              addr: "4225 Daly Rd",           url: "http://63.46.75.228:10001" },
  { name: "Neuse River NRRF RW",           addr: "8500 Battle Bridge Rd",  url: "http://63.46.75.227:10001" },
];

const PROBE_LENGTHS = {
  "http://63.46.75.214:10001|1": 120,
  "http://63.46.75.214:10001|2": 120,
  "http://63.46.75.214:10001|3": 120,
  "http://63.46.75.214:10001|4": 120,
  "http://63.46.75.214:10001|5": 120,
  "http://63.46.75.214:10001|6": 82,
  "http://166.146.80.90:10001|1": 96,
  "http://166.146.80.90:10001|2": 96,
  "http://166.146.80.90:10001|3": 96,
  "http://166.146.80.90:10001|4": 96,
  "http://166.146.80.90:10001|5": 82,
  "http://63.46.75.226:10001|1": 96,
  "http://63.46.75.226:10001|2": 96,
  "http://63.46.75.226:10001|3": 96,
  "http://63.46.75.226:10001|4": 96,
  "http://63.46.75.226:10001|5": 96,
  "http://63.46.75.226:10001|6": 96,
  "http://63.46.75.226:10001|7": 48,
  "http://63.46.75.230:10001|1": 124,
  "http://63.46.75.230:10001|2": 124,
  "http://63.46.75.230:10001|3": 124,
  "http://63.46.75.218:10001|1": 132,
  "http://63.46.75.218:10001|2": 82,
  // Marsh Creek PRCR
  "http://63.46.75.228:10001|1": 78,
  "http://63.46.75.228:10001|2": 74,
  "http://63.46.75.228:10001|3": 74,
  "http://63.46.75.227:10001|1": 96,
};

function getProbeLength(siteUrl, tankId) {
  return PROBE_LENGTHS[siteUrl + "|" + tankId] || null;
}

const TANK_OVERRIDES = {
  "http://63.46.75.226:10001|2": {
    isWasteOil:   true,
    highAlertPct: 80,
    sortLast:     true,
  }
};

function getTankOverride(siteUrl, tankId) {
  return TANK_OVERRIDES[siteUrl + "|" + tankId] || null;
}

const URGENT_KEYWORDS  = ["delivery needed", "delivery need"];
const NOTABLE_KEYWORDS = ["high water", "water alarm", "overfill", "high product"];

// Normalize product names for consistent display
const PRODUCT_NAME_MAP = {
  "On-Road Diesel":  "On-road Diesel",
  "on-road diesel":  "On-road Diesel",
  "ON-ROAD DIESEL":  "On-road Diesel",
};

function normalizeFuelType(name) {
  return PRODUCT_NAME_MAP[name] || name;
}

let REFRESH_SECONDS = 300;
let refreshTimer    = null;
let countTimer      = null;
let allSiteResults  = [];

let _uid = 0;
function uid() { return "uid" + (++_uid); }

function barColor(pct) {
  if (pct >= 50) return "#47C13C";
  if (pct >= 25) return "#F79B0E";
  return "#E9050C";
}

function wasteOilBarColor(pct, alertPct) {
  if (pct >= alertPct)          return "#f44336";
  if (pct >= alertPct * 0.75)   return "#F79B0E";
  return "#47C13C";
}

function statusBadgeClass(sev) {
  if (!sev) return "sb-normal";
  switch (sev.toLowerCase()) {
    case "alarm":       return "sb-alarm";
    case "warning":     return "sb-warning";
    case "information": return "sb-info";
    default:            return "sb-normal";
  }
}

function rowClass(sev) {
  if (!sev) return "";
  switch (sev.toLowerCase()) {
    case "alarm":   return "alarm-row";
    case "warning": return "warn-row";
    default:        return "";
  }
}

function isUrgent(alarm) {
  const text = (alarm.description + " " + alarm.label + " " + alarm.category).toLowerCase();
  return URGENT_KEYWORDS.some(k => text.includes(k));
}

function isNotable(alarm) {
  const text = (alarm.description + " " + alarm.label + " " + alarm.category).toLowerCase();
  return NOTABLE_KEYWORDS.some(k => text.includes(k));
}

function parseDeliveryData(html) {
  // Returns { tankId: [ {dateOnly, grossVolume, startGrossVol, endGrossVol, tempCompGrossVol}, ... ] }
  const deliveryMap = {};
  try {
    const match = html.match(/const tankData\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (match) {
      const arr = JSON.parse(match[1]);
      arr.forEach(t => {
        if (t.id != null && t.deliveryData && t.deliveryData.length > 0) {
          deliveryMap[t.id] = t.deliveryData;
        }
      });
    }
  } catch (e) {}
  return deliveryMap;
}

function parseFuelTypes(html) {
  const fuelMap = {};
  try {
    const match = html.match(/const tankData\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (match) {
      const arr = JSON.parse(match[1]);
      if (arr.length > 0 && arr[0].fuelType) {
        arr.forEach(t => { if (t.id != null && t.fuelType) fuelMap[t.id] = t.fuelType; });
        if (Object.keys(fuelMap).length > 0) return fuelMap;
      }
    }
  } catch (e) {}
  const re = /<span[^>]+class=["']fuel-type["'][^>]*>([^<]+)<\/span>/g;
  let m, idx = 1;
  while ((m = re.exec(html)) !== null) fuelMap[idx++] = m[1].trim();
  return fuelMap;
}

// Parse alarms from JSON (getAlarms.php) or fall back to HTML (alarmspage.cgi)
function parseAlarmsResponse(body, resp) {
  // Try JSON first
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) {
      return data.map(item => {
        const catLower = (item.catdesc || "").toLowerCase();
        let severity = "alarm";
        if (catLower.includes("warn")) severity = "warning";
        if (catLower.includes("info")) severity = "information";

        // Convert Unix timestamp to readable date MM/DD/YYYY + days active
        let timeStr = "";
        if (item.tmactive) {
          const d    = new Date(parseInt(item.tmactive) * 1000);
          const mm   = String(d.getMonth() + 1).padStart(2, "0");
          const dd   = String(d.getDate()).padStart(2, "0");
          const yyyy = d.getFullYear();
          const t    = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          const days = Math.floor((Date.now() - d.getTime()) / 86400000);
          const dayStr = days === 0 ? "today" : days === 1 ? "1 day" : days + " days";
          timeStr = mm + "/" + dd + "/" + yyyy + " " + t + " (" + dayStr + " active)";
        }

        return {
          logNum:      item.itemnum || "",
          label:       item.itemlabel || "",
          description: item.alarmdesc || item.catdesc || "Alarm",
          category:    item.catdesc || "Alarm",
          severity:    severity,
          tankNum:     item.itemnum || "",
          tankLabel:   item.itemlabel || "",
          timeActive:  timeStr,
        };
      });
    }
  } catch(e) { /* fall through to HTML parser */ }
  return parseAlarms(body);
}

function parseAlarms(html) {
  const alarms = [];
  if (!html) return alarms;
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const lower = clean.toLowerCase();
  if (["no current alarm","no active alarm","no alarms","0 alarm"].some(p => lower.includes(p))) return [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let rowMatch, headerSkipped = false;
  while ((rowMatch = rowRe.exec(clean)) !== null) {
    const rowHtml = rowMatch[0];
    if (/<th/i.test(rowHtml)) { headerSkipped = true; continue; }
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cell;
    while ((cell = cellRe.exec(rowHtml)) !== null) {
      const text = cell[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
        .replace(/&nbsp;/g," ").replace(/&#\d+;/g,"")
        .replace(/\s+/g," ").trim();
      if (text.length > 0) cells.push(text);
    }
    if (cells.length < 2) continue;
    if (!headerSkipped) { headerSkipped = true; continue; }
    let logNum = "", label = "", description = "", category = "";
    if (cells.length >= 4)      { logNum=cells[0]; label=cells[1]; description=cells[2]; category=cells[3]; }
    else if (cells.length === 3) { label=cells[0]; description=cells[1]; category=cells[2]; }
    else                         { description=cells[0]; category=cells[1]; }
    const catLower = category.toLowerCase();
    let severity = "alarm";
    if (catLower.includes("warn")) severity = "warning";
    if (catLower.includes("info")) severity = "information";
    if (cells.join(" ").toLowerCase().includes("log#")) continue;
    if (description.length < 2) continue;
    alarms.push({ logNum, label, description, category, severity });
  }
  return alarms;
}

async function fetchSite(site) {
  const result = { name: site.name, addr: site.addr, url: site.url, tanks: [], alarms: [], error: null };
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 20000);
    const [invResp, cgiResp, alarmResp] = await Promise.all([
      fetch(site.url + "/php/Inventory.php",                       { signal: ctrl.signal, cache: "no-store" }),
      fetch(site.url + "/cgi-bin/getTankData.cgi?dataset=dynData", { signal: ctrl.signal, cache: "no-store" }),
      fetch(site.url + "/php/getAlarms.php?current=1",             { signal: ctrl.signal, cache: "no-store" }),
    ]);
    clearTimeout(tid);
    if (!cgiResp.ok) throw new Error("HTTP " + cgiResp.status);
    const [invHtml, cgiData, alarmHtml] = await Promise.all([
      invResp.text(), cgiResp.json(),
      alarmResp.ok ? alarmResp.text() : Promise.resolve(""),
    ]);
    if (!cgiData.tankData) throw new Error("No tank data in response");
    const fuelMap     = parseFuelTypes(invHtml);
    const deliveryMap = parseDeliveryData(invHtml);
    result.alarms  = parseAlarmsResponse(alarmHtml, alarmResp);
    const volUnits = cgiData.volUnitsStr || "G";
    cgiData.tankData.forEach(t => {
      const cap      = t.capacity || 1;
      const gross    = t.grossVolume || 0;
      const pct      = Math.round((gross / cap) * 1000) / 10;
      const override = getTankOverride(site.url, t.tankNum);
      // Apply capacity cap if configured (e.g. 20,000G tank with 12,000G legal fill limit)
      const cap2       = (override && override.capacityCap) ? override.capacityCap : cap;
      const pctCapped  = Math.min(Math.round((gross / cap2) * 1000) / 10, 100);
      const ullageCapped = Math.max(0, Math.round(cap2 * 0.9 - gross)); // ullage to 90% of cap

      result.tanks.push({
        id:          t.tankNum,
        fuelType:    normalizeFuelType(fuelMap[t.tankNum] || t.fuelType || "Tank " + t.tankNum),
        vol:         Math.round(t.productVolume || gross),
        pct:         pctCapped,
        ullage:      (override && override.capacityCap) ? ullageCapped : Math.round(t.adjustedUllage || 0),
        temp:        t.averageTemp != null ? t.averageTemp.toFixed(1) : null,
        fuelColor:   t.fuelColor || barColor(pctCapped),
        status:      t.statusIndStr || "Normal",
        severity:    t.statusIndSeverity || "Normal",
        volUnits:    volUnits,
        override:    override,
        grossHeight: t.grossHeight != null ? t.grossHeight.toFixed(2) : null,
        probeLength:   getProbeLength(site.url, t.tankNum),
        capacityCap:   (override && override.capacityCap) ? override.capacityCap : null,
        lastDelivery:  (deliveryMap[t.tankNum] && deliveryMap[t.tankNum].length > 0) ? deliveryMap[t.tankNum][0] : null,
      });
    });
    result.tanks.sort((a, b) => {
      const aLast = a.override && a.override.sortLast ? 1 : 0;
      const bLast = b.override && b.override.sortLast ? 1 : 0;
      if (aLast !== bLast) return aLast - bLast;
      return a.id - b.id;
    });
  } catch (e) {
    result.error = e.name === "AbortError" ? "Timed out after 20s" : e.message;
  }
  return result;
}

// ── HTML builders ──────────────────────────────────────────────────────────

function buildDeliveryTooltip(t) {
  const d = t.lastDelivery;
  if (!d) return "";
  const amt   = Math.round(d.grossVolume);
  const start = Math.round(d.startGrossVol);
  const end   = Math.round(d.endGrossVol);
  const tc    = Math.round(d.tempCompGrossVol);
  const sign  = amt >= 0 ? "+" : "";
  const tip   = "Last Delivery: " + d.dateOnly
    + "\n" + sign + amt.toLocaleString() + " G  (" + start.toLocaleString() + " to " + end.toLocaleString() + " G)"
    + "\nTemp Compensated: " + sign + tc.toLocaleString() + " G";
  return 'data-tooltip="' + tip.replace(/"/g, "&quot;") + '"';
}

function inchesStr(t) {
  if (!t.grossHeight) return "";
  var s = "<span class='t-ullage-sep'>|</span><span class='t-ullage-in-label'>IN:</span><span class='t-ullage-inches'>" + t.grossHeight + "\"";
  if (t.probeLength) s += " / " + t.probeLength + "\"";
  s += "</span>";
  return s;
}

function urgentAlarmHTML(a) {
  const isDelivery = (a.description + " " + a.label).toLowerCase().includes("delivery");
  const color  = isDelivery ? "#ff9800" : "#f44336";
  const bg     = isDelivery ? "#2d1f00" : "#2a0a0a";
  const border = isDelivery ? "#7e3d00" : "#5c1a1a";
  const icon   = isDelivery ? "&#9654;" : "&#9888;";
  return "<div class='urgent-alarm' style='background:" + bg + ";border-left:4px solid " + color + "'>"
    + "<div class='urgent-alarm-icon' style='color:" + color + "'>" + icon + "</div>"
    + "<div class='urgent-alarm-body'>"
    + "<div class='urgent-alarm-desc' style='color:" + color + "'>" + a.description + "</div>"
    + (a.label ? "<div class='urgent-alarm-label'>" + a.label + "</div>" : "")
    + "</div>"
    + "<div class='urgent-alarm-cat' style='color:" + color + "'>" + a.category + "</div>"
    + "</div>";
}

function otherAlarmHTML(a) {
  const sev   = a.severity || "alarm";
  const color = sev === "warning" ? "#ff9800" : sev === "information" ? "#03a9f4" : "#ef9a9a";
  const meta  = [a.tankLabel || a.label, a.timeActive].filter(Boolean).join("  ·  ");
  return "<div class='other-alarm-row'>"
    + "<span class='other-alarm-dot' style='background:" + color + "'></span>"
    + "<div class='other-alarm-body'>"
    +   "<span class='other-alarm-text'>" + a.description + "</span>"
    +   (meta ? "<span class='other-alarm-meta'>" + meta + "</span>" : "")
    + "</div>"
    + "<span class='other-alarm-cat' style='color:" + color + "'>" + a.category + "</span>"
    + "</div>";
}

function buildAlarmSection(alarms, siteUrl) {
  if (alarms.length === 0) {
    return "<div class='alarm-clear'><span class='alarm-ok-dot'></span>No active alarms</div>";
  }
  const urgent  = alarms.filter(a => isUrgent(a));
  const notable = alarms.filter(a => !isUrgent(a) && isNotable(a));
  const other   = alarms.filter(a => !isUrgent(a) && !isNotable(a));
  let html = "<div class='alarm-section-wrap'>";
  if (urgent.length > 0) {
    html += "<div class='urgent-alarms'>";
    urgent.forEach(a => { html += urgentAlarmHTML(a); });
    html += "</div>";
  }
  if (notable.length > 0) {
    html += "<div class='notable-alarms'>";
    notable.forEach(a => { html += otherAlarmHTML(a); });
    html += "</div>";
  }
  if (other.length > 0) {
    const id = uid();
    html += "<div class='other-alarms-wrap'>"
      + "<button class='other-alarms-toggle other-alarms-toggle-alert' data-target='" + id + "'>"
      + "&#9888; " + other.length + " alarm" + (other.length !== 1 ? "s" : "") + " &#9660;"
      + "</button>"
      + "<div class='other-alarms-list' id='" + id + "' style='display:none'>";
    other.forEach(a => { html += otherAlarmHTML(a); });
    html += "</div></div>";
  }
  html += "<div class='alarm-footer'>"
    + "<a class='alarm-view-link' href='" + siteUrl + "/reports.htm' target='_blank'>View full alarm report &#8599;</a>"
    + "</div>";
  html += "</div>";
  return html;
}

function buildTankRow(t) {
  const ov = t.override;
  if (ov && ov.isWasteOil) {
    const col     = wasteOilBarColor(t.pct, ov.highAlertPct);
    const isHigh  = t.pct >= ov.highAlertPct;
    const pctSafe = Math.min(t.pct, 100);
    return "<div class='tank-row waste-oil-row" + (isHigh ? " alarm-row" : "") + "' " + buildDeliveryTooltip(t) + ">"
      + "<div>"
      +   "<div class='t-name'>Tank " + t.id + "</div>"
      +   "<div class='t-type'>" + t.fuelType + " <span class='waste-tag'>WASTE</span></div>"
      +   "<span class='status-badge " + (isHigh ? "sb-alarm" : "sb-normal") + "'>" + (isHigh ? "DRAIN NEEDED" : "OK") + "</span>"
      + "</div>"
      + "<div>"
      +   (t.capacityCap
      ? (function() {
          var physCap  = (t.override && t.override.physicalCapacity) ? t.override.physicalCapacity : t.capacityCap;
          // Actual fill as % of physical capacity using raw gallons
          var physPct  = Math.min((t.vol / physCap) * 100, 100);
          // Cap line position as % of physical capacity bar width
          var capPct   = Math.min((t.capacityCap / physCap) * 100, 100);
          // Fill bar capped at the cap line
          var fillPct  = Math.min(physPct, capPct);
          // Any volume above cap shown in red
          var overPct  = Math.max(0, physPct - capPct);
          return "<div class='bar-wrap bar-wrap-capped' style='overflow:visible;position:relative'>"            + "<div class='bar-fill' style='width:" + fillPct.toFixed(2) + "%;background:" + col + ";position:absolute;top:0;bottom:0;left:0'></div>"            + (overPct > 0 ? "<div style='position:absolute;top:0;bottom:0;left:" + capPct.toFixed(2) + "%;width:" + overPct.toFixed(2) + "%;background:#f44336;z-index:2'></div>" : "")            + "<div class='bar-cap-zone' style='left:" + capPct.toFixed(2) + "%;width:" + (100 - capPct).toFixed(2) + "%'></div>"            + "<div class='bar-cap-line' style='left:" + capPct.toFixed(2) + "%'></div>"            + "</div>";
        })()
      : "<div class='bar-wrap'><div class='bar-fill' style='width:" + pctSafe + "%;background:" + col + "'></div></div>")
      +   "<div class='waste-ullage'>Drain alert at " + ov.highAlertPct + "%" + (t.temp ? "&nbsp; " + t.temp + "&deg;F" : "") + inchesStr(t) + "</div>"
      + "</div>"
      + "<div class='t-right'>"
      +   "<div class='t-vol'>" + t.vol.toLocaleString() + " G</div>"
      +   "<div class='t-pct' style='color:" + col + "'>" + t.pct + "%</div>"
      + "</div>"
      + "</div>";
  }
  const col     = t.fuelColor || barColor(t.pct);
  const rc      = rowClass(t.severity);
  const sbc     = statusBadgeClass(t.severity);
  const tempStr = t.temp ? "&nbsp;" + t.temp + "&deg;F" : "";
  const pctSafe = Math.min(t.pct, 100);
  const capTag  = t.capacityCap ? "<span class='cap-tag'>CAP " + t.capacityCap.toLocaleString() + " G</span>" : "";
  return "<div class='tank-row " + rc + "' " + buildDeliveryTooltip(t) + ">"
    + "<div>"
    +   "<div class='t-name'>Tank " + t.id + "</div>"
    +   "<div class='t-type'>" + t.fuelType + capTag + "</div>"
    +   "<span class='status-badge " + sbc + "'>" + t.status + "</span>"
    + "</div>"
    + "<div>"
    +   (t.capacityCap
      ? (function() {
          var physCap  = (t.override && t.override.physicalCapacity) ? t.override.physicalCapacity : t.capacityCap;
          // Actual fill as % of physical capacity using raw gallons
          var physPct  = Math.min((t.vol / physCap) * 100, 100);
          // Cap line position as % of physical capacity bar width
          var capPct   = Math.min((t.capacityCap / physCap) * 100, 100);
          // Fill bar capped at the cap line
          var fillPct  = Math.min(physPct, capPct);
          // Any volume above cap shown in red
          var overPct  = Math.max(0, physPct - capPct);
          return "<div class='bar-wrap bar-wrap-capped' style='overflow:visible;position:relative'>"            + "<div class='bar-fill' style='width:" + fillPct.toFixed(2) + "%;background:" + col + ";position:absolute;top:0;bottom:0;left:0'></div>"            + (overPct > 0 ? "<div style='position:absolute;top:0;bottom:0;left:" + capPct.toFixed(2) + "%;width:" + overPct.toFixed(2) + "%;background:#f44336;z-index:2'></div>" : "")            + "<div class='bar-cap-zone' style='left:" + capPct.toFixed(2) + "%;width:" + (100 - capPct).toFixed(2) + "%'></div>"            + "<div class='bar-cap-line' style='left:" + capPct.toFixed(2) + "%'></div>"            + "</div>";
        })()
      : "<div class='bar-wrap'><div class='bar-fill' style='width:" + pctSafe + "%;background:" + col + "'></div></div>")
    +   "<div class='t-ullage'><span class='t-ullage-label'>Ullage</span><span class='t-ullage-val'>" + t.ullage.toLocaleString() + " G</span>" + tempStr + inchesStr(t) + "</div>"
    + "</div>"
    + "<div class='t-right'>"
    +   "<div class='t-vol'>" + t.vol.toLocaleString() + " G</div>"
    +   "<div class='t-pct'>" + t.pct + "%</div>"
    + "</div>"
    + "</div>";
}

function buildCardHTML(site) {
  const hasError    = !!site.error;
  const hasData     = !hasError && site.tanks.length > 0;
  const urgent      = (site.alarms || []).filter(isUrgent);
  const totalAlarms = (site.alarms || []).length;
  const wasteHigh   = (site.tanks || []).some(t => t.override && t.override.isWasteOil && t.pct >= t.override.highAlertPct);
  let badgeClass, badgeText;
  if (hasError) {
    badgeClass = "b-error"; badgeText = "Offline";
  } else if (urgent.length > 0 || wasteHigh) {
    const count = urgent.length + (wasteHigh ? 1 : 0);
    badgeClass = "b-alarm"; badgeText = count + " Urgent";
  } else if (totalAlarms > 0) {
    badgeClass = "b-warn"; badgeText = totalAlarms + " Alarm" + (totalAlarms !== 1 ? "s" : "");
  } else {
    badgeClass = "b-ok"; badgeText = "Online (" + site.tanks.length + " tanks)";
  }
  const shortUrl = site.url.replace("http://", "");
  let html = "<div class='site-hdr'>"
    + "<div>"
    + "<div class='site-name'>" + site.name + "</div>"
    + "<div class='site-addr'>" + site.addr + "</div>"
    + "<a class='site-link' href='" + site.url + "/php/Inventory.php' target='_blank'>" + shortUrl + " &#8599;</a>"
    + "</div>"
    + "<span class='badge " + badgeClass + "'>" + badgeText + "</span>"
    + "</div>";
  if (hasError) {
    html += "<div class='err-msg'>&#9888; " + site.error + "</div>";
  } else if (hasData) {
    html += buildAlarmSection(site.alarms || [], site.url);
    html += "<div class='tank-list'>";
    site.tanks.forEach(t => { html += buildTankRow(t); });
    html += "</div>";
  } else {
    html += "<div class='placeholder'>No tank data received</div>";
  }
  return html;
}

// ── Collapse toggle ────────────────────────────────────────────────────────

document.addEventListener("click", function(e) {
  if (e.target && e.target.classList.contains("other-alarms-toggle")) {
    const targetId = e.target.getAttribute("data-target");
    const panel    = document.getElementById(targetId);
    if (!panel) return;
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    e.target.innerHTML  = open
      ? e.target.innerHTML.replace("&#9650;", "&#9660;")
      : e.target.innerHTML.replace("&#9660;", "&#9650;");
  }
});

// ── Refresh / countdown ────────────────────────────────────────────────────

function startAutoRefresh() {
  clearInterval(refreshTimer);
  clearInterval(countTimer);
  let countdown = REFRESH_SECONDS;
  updateCountdownDisplay(countdown);
  countTimer = setInterval(() => {
    countdown--;
    updateCountdownDisplay(countdown);
    if (countdown <= 0) clearInterval(countTimer);
  }, 1000);
  refreshTimer = setInterval(fetchAll, REFRESH_SECONDS * 1000);
}

function updateCountdownDisplay(s) {
  const el = document.getElementById("auto-lbl");
  if (!el) return;
  if (s >= 60) {
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    el.textContent = "Refresh in " + m + "m" + (sec > 0 ? " " + sec + "s" : "");
  } else {
    el.textContent = "Refresh in " + s + "s";
  }
}

function applyRefreshRate() {
  REFRESH_SECONDS = parseInt(document.getElementById("refresh-select").value, 10);
  try { localStorage.setItem('atg_refreshSeconds', REFRESH_SECONDS); } catch(e) {}
  startAutoRefresh();
}

// ── Main fetch ─────────────────────────────────────────────────────────────

async function fetchAll() {
  clearInterval(refreshTimer);
  clearInterval(countTimer);
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.textContent = "Loading\u2026";
  allSiteResults = new Array(SITES.length);
  const grid = document.getElementById("site-grid");
  grid.innerHTML = "";
  SITES.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "site-card";
    card.id = "card-" + i;
    card.innerHTML = "<div class='site-hdr'>"
      + "<div><div class='site-name'>" + s.name + "</div><div class='site-addr'>" + s.addr + "</div></div>"
      + "<span class='badge b-loading pulse'>Loading\u2026</span>"
      + "</div><div class='placeholder'>Fetching data\u2026</div>";
    grid.appendChild(card);
  });
  let online = 0, tanks = 0, alarmCount = 0, lowFuel = 0, totalVol = 0;

  let proxyResults;
  try {
    proxyResults = await fetchAllFromProxy();
  } catch(e) {
    // Mark all sites as errored
    SITES.forEach((s, i) => {
      allSiteResults[i] = { name: s.name, addr: s.addr, url: s.url, tanks: [], alarms: [], error: "Proxy unreachable: " + e.message };
      const card = document.getElementById("card-" + i);
      if (card) card.innerHTML = buildCardHTML(allSiteResults[i]);
    });
    document.getElementById("s-online").textContent = 0;
    document.getElementById("s-online").style.color = "#f44336";
    return;
  }

  // Process each site result from proxy — parse fuel types and alarms client-side
  proxyResults.forEach((proxyResult, i) => {
    let result = { name: proxyResult.name, addr: proxyResult.addr, url: proxyResult.url, tanks: [], alarms: [], error: proxyResult.error || null };

    if (!proxyResult.error && proxyResult.cgiData && proxyResult.cgiData.tankData) {
      const fuelMap     = proxyResult.invHtml ? parseFuelTypes(proxyResult.invHtml) : {};
      result.alarms     = Array.isArray(proxyResult.alarms) ? parseProxyAlarms(proxyResult.alarms) : [];
      const volUnits    = proxyResult.cgiData.volUnitsStr || "G";

      proxyResult.cgiData.tankData.forEach(t => {
        const cap      = t.capacity || 1;
        const gross    = t.grossVolume || 0;
        const pct      = Math.round((gross / cap) * 1000) / 10;
        const override = getTankOverride(proxyResult.url, t.tankNum);
        const cap2     = (override && override.capacityCap) ? override.capacityCap : cap;
        const pctCapped = Math.min(Math.round((gross / cap2) * 1000) / 10, 100);
        const ullageCapped = Math.max(0, Math.round(cap2 * 0.9 - gross));

        result.tanks.push({
          id:          t.tankNum,
          fuelType:    normalizeFuelType(fuelMap[t.tankNum] || t.fuelType || "Tank " + t.tankNum),
          vol:         Math.round(t.productVolume || gross),
          pct:         pctCapped,
          ullage:      (override && override.capacityCap) ? ullageCapped : Math.round(t.adjustedUllage || 0),
          temp:        t.averageTemp != null ? t.averageTemp.toFixed(1) : null,
          fuelColor:   t.fuelColor || barColor(pctCapped),
          status:      t.statusIndStr || "Normal",
          severity:    t.statusIndSeverity || "Normal",
          volUnits:    volUnits,
          override:    override,
          grossHeight: t.grossHeight != null ? t.grossHeight.toFixed(2) : null,
          probeLength: getProbeLength(proxyResult.url, t.tankNum),
          capacityCap: (override && override.capacityCap) ? override.capacityCap : null,
          lastDelivery: null,
        });
      });

      result.tanks.sort((a, b) => {
        const aLast = a.override && a.override.sortLast ? 1 : 0;
        const bLast = b.override && b.override.sortLast ? 1 : 0;
        if (aLast !== bLast) return aLast - bLast;
        return a.id - b.id;
      });
    }

    allSiteResults[i] = result;
    const card = document.getElementById("card-" + i);
    if (card) card.innerHTML = buildCardHTML(result);

    if (!result.error) {
      online++;
      result.tanks.forEach(t => {
        tanks++;
        if (!t.override || !t.override.isWasteOil) {
          totalVol += t.vol;
          if (t.pct < 25) lowFuel++;
        }
      });
      alarmCount += (result.alarms || []).length;
      alarmCount += result.tanks.filter(t => t.override && t.override.isWasteOil && t.pct >= t.override.highAlertPct).length;
    }

    document.getElementById("s-online").textContent  = online;
    document.getElementById("s-online").style.color  = online < SITES.length ? "#f44336" : "#fff";
    document.getElementById("s-tanks").textContent   = tanks || "\u2014";
    document.getElementById("s-alarms").textContent  = alarmCount;
    document.getElementById("s-alarms").style.color  = alarmCount > 0 ? "#f44336" : "#fff";
    document.getElementById("s-low").textContent     = lowFuel;
    document.getElementById("s-low").style.color     = lowFuel > 0 ? "#ff9800" : "#fff";
    document.getElementById("s-total-vol").textContent = totalVol > 0 ? totalVol.toLocaleString() : "\u2014";
  });
  const now = new Date();
  document.getElementById("ts").textContent =
    now.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + now.toLocaleTimeString();
  btn.disabled = false;
  btn.textContent = "\u27f3 Refresh All";
  buildFilterPills();
  applyProductFilter();
  startAutoRefresh();
}

document.getElementById("refresh-btn").addEventListener("click", fetchAll);
document.getElementById("refresh-select").addEventListener("change", applyRefreshRate);

// ── Restore saved refresh rate ─────────────────────────────────────────────
try {
  const saved = localStorage.getItem('atg_refreshSeconds');
  if (saved) {
    REFRESH_SECONDS = parseInt(saved, 10);
    const sel = document.getElementById("refresh-select");
    if (sel) sel.value = saved;
  }
} catch(e) {}

// ── Theme toggle ───────────────────────────────────────────────────────────

function applyTheme(light) {
  const btn = document.getElementById("theme-btn");
  if (light) {
    document.body.classList.add("light");
    btn.innerHTML = "&#9790; Dark";
  } else {
    document.body.classList.remove("light");
    btn.innerHTML = "&#9728; Light";
  }
}

function toggleTheme() {
  const isLight = document.body.classList.contains("light");
  const next = !isLight;
  applyTheme(next);
  try { localStorage.setItem('atg_lightMode', next ? '1' : ''); } catch(e) {}
}

try { if (localStorage.getItem('atg_lightMode')) applyTheme(true); } catch(e) {}

document.getElementById("theme-btn").addEventListener("click", toggleTheme);

// ── Alarm modal ────────────────────────────────────────────────────────────

function alarmModalColor(sev) {
  switch ((sev || "").toLowerCase()) {
    case "warning":     return { bg: "#2d1f00", dot: "#ff9800", cat: "#ff9800" };
    case "information": return { bg: "#001433", dot: "#03a9f4", cat: "#03a9f4" };
    default:            return { bg: "#2a0a0a", dot: "#f44336", cat: "#f44336" };
  }
}

function buildModalContent() {
  const body = document.getElementById("modal-body");
  let html = "";
  let totalCount = 0;
  allSiteResults.forEach(result => {
    if (!result || result.error) return;
    const siteAlarms = [];
    (result.alarms || []).forEach(a => {
      siteAlarms.push({
        desc:      a.description,
        label:     a.label,
        tankLabel: a.tankLabel || "",
        category:  a.category,
        severity:  a.severity,
        source:    a.logNum ? "Log #" + a.logNum : "",
        timeActive: a.timeActive || "",
      });
    });
    (result.tanks || []).forEach(t => {
      if (t.override && t.override.isWasteOil && t.pct >= t.override.highAlertPct) {
        siteAlarms.push({
          desc:     "Tank " + t.id + " \u2014 " + t.fuelType + " requires draining",
          label:    "Waste Oil High Level",
          category: "Action Required",
          severity: "alarm",
          source:   t.pct + "% full (alert at " + t.override.highAlertPct + "%)",
        });
      }
    });
    if (siteAlarms.length === 0) return;
    totalCount += siteAlarms.length;
    html += "<div class='modal-site'>";
    html += "<div class='modal-site-name'>" + result.name + " &mdash; " + result.addr + "</div>";
    siteAlarms.forEach(a => {
      const c = alarmModalColor(a.severity);
      html += "<div class='modal-alarm-row' style='background:" + c.bg + ";border-left:3px solid " + c.dot + "'>"
        + "<span class='modal-alarm-dot' style='background:" + c.dot + "'></span>"
        + "<div class='modal-alarm-body'>"
        +   "<div class='modal-alarm-desc' style='color:#ffffff'>" + a.desc + "</div>"
        +   "<div class='modal-alarm-meta' style='color:#b0b0b0'>"
        +     [a.tankLabel || a.label, a.source, a.timeActive].filter(Boolean).join("  ·  ")
        +   "</div>"
        + "</div>"
        + "<span class='modal-alarm-cat' style='color:" + c.cat + ";font-size:10px;font-weight:bold;text-transform:uppercase'>" + a.category + "</span>"
        + "</div>";
    });
    html += "</div>";
  });
  if (totalCount === 0) {
    html = "<div class='modal-no-alarms'>&#10003; No active alarms across all sites</div>";
  }
  body.innerHTML = html;
}

function openAlarmModal() {
  buildModalContent();
  document.getElementById("alarm-modal").style.display = "flex";
}

function closeAlarmModal() {
  document.getElementById("alarm-modal").style.display = "none";
}

document.getElementById("alarms-card").addEventListener("click", openAlarmModal);
document.getElementById("modal-close").addEventListener("click", closeAlarmModal);
document.getElementById("alarm-modal").addEventListener("click", function(e) {
  if (e.target === this) closeAlarmModal();
});

// ── Copy to clipboard ──────────────────────────────────────────────────────

function showCopyConfirm(msg) {
  const el = document.getElementById("copy-confirm");
  el.textContent = "\u2713 " + msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function copyTankLevels() {
  const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  let text = "FLEET ATG TANK LEVELS — " + now + "\n";
  text += "=".repeat(52) + "\n\n";
  allSiteResults.forEach(result => {
    if (!result) return;
    text += result.name + "\n";
    text += result.addr + "\n";
    if (result.error) {
      text += "  [OFFLINE — " + result.error + "]\n";
    } else {
      result.tanks.forEach(t => {
        const ov = t.override;
        if (ov && ov.isWasteOil) {
          const status = t.pct >= ov.highAlertPct ? "DRAIN NEEDED" : "OK";
          text += "  Tank " + t.id + " (" + t.fuelType + " WASTE)\n";
          text += "    Level:  " + t.pct + "%  |  " + t.vol.toLocaleString() + " G\n";
          text += "    Status: " + status + "\n";
        } else {
          const inStr = t.grossHeight ? t.grossHeight + "\"" + (t.probeLength ? " / " + t.probeLength + "\"" : "") : "";
          text += "  Tank " + t.id + " — " + t.fuelType + "\n";
          text += "    Level:  " + t.pct + "%  |  " + t.vol.toLocaleString() + " G\n";
          text += "    Ullage: " + t.ullage.toLocaleString() + " G";
          if (inStr) text += "  |  IN: " + inStr;
          if (t.temp) text += "  |  " + t.temp + "\u00b0F";
          text += "\n";
          text += "    Status: " + t.status + "\n";
        }
      });
    }
    text += "\n";
  });
  navigator.clipboard.writeText(text).then(() => showCopyConfirm("Tank levels copied"));
}

// Keywords to exclude from Copy Alarms (handled by Copy Order instead)
const EXCLUDE_FROM_ALARM_COPY = ["delivery needed", "delivery need", "low product", "product low", "low fuel", "low level"];

function copyAlarms() {
  const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  let text = "FLEET ATG ACTIVE ALARMS — " + now + "\n";
  text += "=".repeat(52) + "\n\n";
  let anyAlarms = false;
  allSiteResults.forEach(result => {
    if (!result || result.error) return;
    const siteAlarms = [];
    (result.alarms || []).forEach(a => {
      // Skip delivery needed and low product — those belong in Copy Order
      const combined = (a.description + " " + a.label + " " + a.category).toLowerCase();
      if (EXCLUDE_FROM_ALARM_COPY.some(k => combined.includes(k))) return;
      siteAlarms.push({
        desc:     a.description,
        label:    a.tankLabel || a.label,
        category: a.category,
        source:   a.logNum ? "Log #" + a.logNum : "",
        time:     a.timeActive || "",
      });
    });
    (result.tanks || []).forEach(t => {
      if (t.override && t.override.isWasteOil && t.pct >= t.override.highAlertPct) {
        siteAlarms.push({
          desc:     "Tank " + t.id + " \u2014 " + t.fuelType + " requires draining",
          label:    "Waste Oil High Level",
          category: "Action Required",
          source:   t.pct + "% full",
          time:     "",
        });
      }
    });
    if (siteAlarms.length === 0) return;
    anyAlarms = true;
    // Site header on one line
    text += result.name + ", " + result.addr + "\n";
    siteAlarms.forEach(a => {
      // All meta on same line as alarm, comma-separated
      const meta = [a.label, a.source, a.time].filter(Boolean).join("  \u00b7  ");
      text += "  [" + a.category + "] " + a.desc;
      if (meta) text += ",     " + meta;
      text += "\n";
    });
    text += "\n";
  });
  if (!anyAlarms) text += "No active alarms across all sites.\n";
  navigator.clipboard.writeText(text).then(() => showCopyConfirm("Alarms copied"));
}

document.getElementById("copy-levels-btn").addEventListener("click", copyTankLevels);
document.getElementById("copy-alarms-btn").addEventListener("click", copyAlarms);

// Start
fetchAll();

// ── Product filter ─────────────────────────────────────────────────────────

let activeFilters = new Set(); // empty = All

function buildFilterPills() {
  const container = document.getElementById("product-filters");
  if (!container) return;
  const checkbox = document.getElementById("filter-enabled");
  // Only show pills if checkbox is checked
  if (checkbox && !checkbox.checked) {
    container.style.display = "none";
    return;
  }
  if (checkbox && checkbox.checked) container.style.display = "flex";

  // Collect all unique product types from loaded results
  const products = new Set();
  allSiteResults.forEach(result => {
    if (!result || result.error) return;
    (result.tanks || []).forEach(t => {
      if (t.override && t.override.isWasteOil) return; // exclude waste oil from filter
      if (t.fuelType) products.add(t.fuelType);
    });
  });

  // Custom sort order — diesel group first, then ethanol group, then everything else alphabetically
  const ORDER = [
    "B20 Biodiesel",
    "On-road Diesel",
    "Off-road Diesel",
    "E10 Unleaded",
    "E85 Flex Fuel",
  ];
  const sorted = Array.from(products).sort((a, b) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;  // both in order list
    if (ai !== -1) return -1;                      // a is ordered, b is not
    if (bi !== -1) return 1;                       // b is ordered, a is not
    return a.localeCompare(b);                     // both unordered — alphabetical
  });

  // Build pills — preserve active state across rebuilds
  let html = "<button class='filter-pill pill-all" + (activeFilters.size === 0 ? " active" : "") + "' data-product='__all__'>All</button>";
  sorted.forEach(p => {
    const isActive = activeFilters.has(p);
    html += "<button class='filter-pill" + (isActive ? " active" : "") + "' data-product='" + p.replace(/'/g, "&#39;") + "'>" + p + "</button>";
  });
  container.innerHTML = html;

  // Wire up clicks
  container.querySelectorAll(".filter-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const product = btn.getAttribute("data-product");
      if (product === "__all__") {
        activeFilters.clear();
      } else {
        if (activeFilters.has(product)) {
          activeFilters.delete(product);
        } else {
          activeFilters.add(product);
        }
      }
      buildFilterPills();
      applyProductFilter();
    });
  });
}

function applyProductFilter() {
  const grid  = document.getElementById("site-grid");
  if (!grid) return;
  const cards = grid.querySelectorAll(".site-card");

  // All selected or nothing selected = show everything
  if (activeFilters.size === 0) {
    cards.forEach(card => {
      card.style.display = "";
      card.querySelectorAll(".tank-row").forEach(r => { r.style.display = ""; });
    });
    return;
  }

  cards.forEach((card, i) => {
    const result = allSiteResults[i];
    if (!result || result.error) return;

    let cardHasMatch = false;
    const rows = card.querySelectorAll(".tank-row");

    rows.forEach((row, ri) => {
      const tank = (result.tanks || [])[ri];
      if (!tank) { row.style.display = "none"; return; }

      // Waste oil always visible when filters active
      if (tank.override && tank.override.isWasteOil) {
        row.style.display = "";
        return;
      }

      const match = activeFilters.has(tank.fuelType);
      row.style.display = match ? "" : "none";
      if (match) cardHasMatch = true;
    });

    card.style.display = cardHasMatch ? "" : "none";
  });
}

// ── Filter toggle checkbox ─────────────────────────────────────────────────

(function() {
  const checkbox  = document.getElementById("filter-enabled");
  const pillsWrap = document.getElementById("product-filters");
  if (!checkbox || !pillsWrap) return;

  checkbox.addEventListener("change", function() {
    if (this.checked) {
      pillsWrap.style.display = "flex";
      // Build pills now in case data already loaded
      buildFilterPills();
    } else {
      activeFilters.clear();
      pillsWrap.style.display = "none";
      applyProductFilter();
    }
    // Save checkbox state
    try { localStorage.setItem('atg_filterEnabled', this.checked ? '1' : ''); } catch(e) {}
  });

  // Restore saved state
  try {
    if (localStorage.getItem('atg_filterEnabled')) {
      checkbox.checked = true;
      pillsWrap.style.display = "flex";
    }
  } catch(e) {}
})();

// ── Copy Order ─────────────────────────────────────────────────────────────

// Vendor compartment sizes in gallons, largest to smallest
const COMPARTMENTS = [2500, 2500, 1700, 1500, 1000];

// Max delivery caps by product group
function getDeliveryCap(fuelType) {
  const f = (fuelType || "").toLowerCase();
  if (f.includes("diesel") || f.includes("b20") || f.includes("biodiesel")) return 8500;
  return 7500; // unleaded, flex fuel, e85, def, etc.
}

// Determine if a tank needs an order
function tankNeedsOrder(t) {
  if (!t) return false;
  if (t.override && t.override.isWasteOil) return false;
  // Needs order if: severity is alarm/warning, OR pct < 25, OR delivery needed alarm text
  if (t.severity && (t.severity.toLowerCase() === "alarm" || t.severity.toLowerCase() === "warning")) return true;
  if (t.pct < 25) return true;
  return false;
}

// Calculate recommended order amount using compartment combinations
// Fill up to cap without exceeding it, using largest compartments first
function recommendOrder(currentVol, fuelType, capacityCap) {
  const cap      = getDeliveryCap(fuelType);
  const effCap   = capacityCap ? Math.min(cap, capacityCap) : cap;
  const space    = Math.max(0, effCap - currentVol);
  if (space <= 0) return 0;

  // Fill compartments greedily from largest to smallest without exceeding space
  let total = 0;
  for (const comp of COMPARTMENTS) {
    if (total + comp <= space) {
      total += comp;
    }
  }
  return total;
}


// Products classified as fuel (for fuel order)
const FUEL_PRODUCTS = [
  "e10 unleaded", "e85 flex fuel", "b20 biodiesel",
  "on-road diesel", "off-road diesel"
];

function isFuelProduct(fuelType) {
  return FUEL_PRODUCTS.some(p => (fuelType || "").toLowerCase().includes(p.split(" ")[0]) || (fuelType || "").toLowerCase() === p);
}

function isLubeProduct(fuelType) {
  if (!fuelType) return false;
  const f = fuelType.toLowerCase();
  // Exclude fuel products and waste oil
  if (FUEL_PRODUCTS.some(p => f === p)) return false;
  if (f.includes("waste")) return false;
  return true;
}

function orderTimestamp() {
  const now     = new Date();
  const mm      = String(now.getMonth() + 1).padStart(2, "0");
  const dd      = String(now.getDate()).padStart(2, "0");
  const yyyy    = now.getFullYear();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return mm + "/" + dd + "/" + yyyy + " " + timeStr;
}

// Build order text filtered by a product classifier function
// Build both HTML (for modal display) and plain text (for copy)
function buildOrderContent(title, productFilter) {
  const timestamp = orderTimestamp();
  let html      = "<div class='order-modal-header'>" + title + " &mdash; " + timestamp + "</div>";
  let plainText = title + " - " + timestamp + "\n\n";
  let anyOrders = false;

  allSiteResults.forEach(result => {
    if (!result || result.error) return;

    const siteTanks = (result.tanks || []).filter(t =>
      tankNeedsOrder(t) && productFilter(t.fuelType)
    );
    const orderableTanks = siteTanks.filter(t =>
      isFuelProduct(t.fuelType)
        ? recommendOrder(t.vol, t.fuelType, t.capacityCap) > 0
        : (t.ullage || 0) > 0
    );
    if (orderableTanks.length === 0) return;

    anyOrders = true;
    const siteLine = result.name + ", " + result.addr;
    html      += "<div class='order-site-block'>";
    html      += "<div class='order-site-name'>" + siteLine + "</div>";
    plainText += siteLine.toUpperCase() + "\n";

    orderableTanks.forEach(t => {
      const inStr       = t.grossHeight ? " (" + t.grossHeight + " in)" : "";
      const recommended = isFuelProduct(t.fuelType)
        ? recommendOrder(t.vol, t.fuelType, t.capacityCap)
        : t.ullage;
      const recFmt  = recommended.toLocaleString();
      const tankRef = "Tank " + t.id + " - " + t.fuelType;
      const current = "Current level " + t.vol.toLocaleString() + " G" + inStr;

      // HTML line — caps for quantity and product
      html += "<div class='order-tank-line'>"
        + recFmt + " G of " + t.fuelType.toUpperCase()
        + " for " + tankRef + ", " + current
        + "</div>";

      // Plain text line
      plainText += "\t" + recFmt + " G of " + t.fuelType.toUpperCase()
        + " for " + tankRef + ", " + current + "\n";
    });

    html      += "</div>";
    plainText += "\n";
  });

  if (!anyOrders) {
    html      += "<div class='order-empty'>&#10003; No tanks currently requiring an order.</div>";
    plainText += "No tanks currently requiring an order.\n";
  }

  return { html, plainText, title, timestamp };
}

let currentOrderText = "";

function openOrderModal(title, productFilter) {
  const result = buildOrderContent(title, productFilter);
  currentOrderText = result.plainText;
  document.getElementById("order-modal-title").textContent = title;
  document.getElementById("order-modal-body").innerHTML    = result.html;
  document.getElementById("order-modal").style.display    = "flex";
}

function closeOrderModal() {
  document.getElementById("order-modal").style.display = "none";
}

document.getElementById("copy-fuel-order-btn").addEventListener("click", () =>
  openOrderModal("COR FLEET ATG SUGGESTED FUEL ORDER", isFuelProduct)
);
document.getElementById("copy-lube-order-btn").addEventListener("click", () =>
  openOrderModal("COR FLEET ATG SUGGESTED LUBE/FLUID ORDER", isLubeProduct)
);
document.getElementById("order-modal-close").addEventListener("click", closeOrderModal);
document.getElementById("order-modal").addEventListener("click", function(e) {
  if (e.target === this) closeOrderModal();
});
document.getElementById("order-modal-copy").addEventListener("click", function() {
  navigator.clipboard.writeText(currentOrderText).then(() => {
    this.textContent = "\u2713 Copied!";
    setTimeout(() => { this.innerHTML = "&#128203; Copy"; }, 2000);
  });
});
