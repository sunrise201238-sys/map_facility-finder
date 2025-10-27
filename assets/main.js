/* =========================
   Facility Finder - main.js
   ========================= */

/* ---- i18n 安全取字；若 i18n.js 尚未載入或沒有該 key，回傳 fallback 或 key ---- */
function t(key, fallback) {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      const v = window.i18n.t(key);
      if (typeof v === 'string' && v) return v;
    }
  } catch (_) {}
  return (fallback !== undefined) ? fallback : key;
}

const $ = (q) => document.querySelector(q);

/* ---------- Categories (labels/colors/Overpass) ---------- */
const CATEGORY_DEFS = {
  temple: {
    label: "宗教場所",
    color: "#f59e0b",
    overpass: (lat, lon, r) => `
    (
      node["amenity"="place_of_worship"](around:${r},${lat},${lon});
      way["amenity"="place_of_worship"](around:${r},${lat},${lon});
      relation["amenity"="place_of_worship"](around:${r},${lat},${lon});
    );`,
  },
  grave: {
    label: "墓地",
    color: "#ef4444",
    overpass: (lat, lon, r) => `
    (
      node["landuse"="cemetery"](around:${r},${lat},${lon});
      way["landuse"="cemetery"](around:${r},${lat},${lon});
      relation["landuse"="cemetery"](around:${r},${lat},${lon});
      node["amenity"="grave_yard"](around:${r},${lat},${lon});
      way["amenity"="grave_yard"](around:${r},${lat},${lon});
      relation["amenity"="grave_yard"](around:${r},${lat},${lon});
    );`,
  },
  fuel: {
    label: "加油站",
    color: "#10b981",
    overpass: (lat, lon, r) => `
    (
      node["amenity"="fuel"](around:${r},${lat},${lon});
      way["amenity"="fuel"](around:${r},${lat},${lon});
      relation["amenity"="fuel"](around:${r},${lat},${lon});
    );`,
  },
  cafe: {
    label: "網咖",
    color: "#8b5cf6",
    overpass: (lat, lon, r) => `
    (
      node["amenity"="internet_cafe"](around:${r},${lat},${lon});
      way["amenity"="internet_cafe"](around:${r},${lat},${lon});
      relation["amenity"="internet_cafe"](around:${r},${lat},${lon});
    );`,
  },
  arcade: {
    label: "電子遊樂場",
    color: "#161ef9",
    overpass: (lat, lon, r) => `
    (
      node["leisure"="amusement_arcade"](around:${r},${lat},${lon});
      way["leisure"="amusement_arcade"](around:${r},${lat},${lon});
      relation["leisure"="amusement_arcade"](around:${r},${lat},${lon});
    );`,
  },
};

/* ---------- Overpass endpoints (rotating fallback) ---------- */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

/* ---------- Map state ---------- */
let map;
let centerMarker;
let circle;
let markers = [];
let currentCenter = { lat: 25.047675, lon: 121.517055 }; // Taipei default

/* ---------- UI helpers ---------- */
function setStatus(msg, busy = false) {
  const st = $("#status");
  const tEl = $("#statusText");
  if (tEl) tEl.textContent = msg;
  if (st) st.classList.toggle("busy", busy);
}

function pin(color) {
  return L.divIcon({
    className: "",
    html:
      '<div style="width:18px;height:18px;background:' +
      color +
      ';border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.25)"></div>',
  });
}

/* ---------- Map & circle ---------- */
function initMap() {
  map = L.map("map").setView([currentCenter.lat, currentCenter.lon], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);

  centerMarker = L.marker([currentCenter.lat, currentCenter.lon], {
    draggable: true,
    icon: L.divIcon({
      className: "",
      html:
        '<div style="width:22px;height:22px;background:#3FA7F5;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.25)"></div>',
    }),
  }).addTo(map);

  centerMarker.on("moveend", (e) => {
    const ll = e.target.getLatLng();
    currentCenter = { lat: ll.lat, lon: ll.lng };
    redrawCircle();
  });

  circle = L.circle([currentCenter.lat, currentCenter.lon], {
    radius: +$("#radiusInput").value,
    color: "#5cc0ff",
    fill: false,
  }).addTo(map);

  // click to move center (no auto-search)
  map.on("click", (e) => {
    currentCenter = { lat: e.latlng.lat, lon: e.latlng.lng };
    centerMarker.setLatLng(e.latlng);
    redrawCircle();
  });
}

function redrawCircle() {
  const r = +$("#radiusInput").value;
  circle.setLatLng([currentCenter.lat, currentCenter.lon]);
  circle.setRadius(r);
}

/* ---------- Radius binding ---------- */
function bindRadius() {
  const a = $("#radiusInput");
  const b = $("#radiusRange");
  const sync = (src, dst) => {
    dst.value = src.value;
    redrawCircle();
  };
  a.addEventListener("input", () => sync(a, b));
  b.addEventListener("input", () => sync(b, a));
}

/* ---------- Overpass helpers ---------- */
async function overpassQuery(query) {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      console.warn("Overpass failed:", url, e);
    }
  }
  throw new Error("All Overpass endpoints failed");
}

function elementsToPoints(elements) {
  const pts = [];
  for (const el of elements) {
    if (el.type === "node") {
      pts.push({
        lat: el.lat,
        lon: el.lon,
        tags: el.tags || {},
        id: el.id,
        type: el.type,
      });
    } else if (el.type === "way" || el.type === "relation") {
      const lat = (el.center && el.center.lat) || el.lat;
      const lon = (el.center && el.center.lon) || el.lon;
      if (lat && lon) {
        pts.push({
          lat,
          lon,
          tags: el.tags || {},
          id: el.id,
          type: el.type,
        });
      }
    }
  }
  return pts;
}

function dist(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sLatA = toRad(a.lat);
  const sLatB = toRad(b.lat);
  const aH =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(sLatA) * Math.cos(sLatB) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aH));
}

function getCheckedTypes() {
  return Array.from(document.querySelectorAll(".cat:checked")).map(
    (c) => c.value
  );
}

function buildQuery(lat, lon, r, types) {
  const parts = types.map((key) => CATEGORY_DEFS[key].overpass(lat, lon, r));
  return `[out:json][timeout:25];
  (
    ${parts.join("\n")}
  );
  out center tags;`;
}

/* ---------- Main search (Overpass) ---------- */
function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

async function runSearch() {
  const types = getCheckedTypes();
  if (!types.length) {
    setStatus("請至少勾選一個類別。");
    return;
  }

  // 狀態列：查詢中（使用 i18n）
  setStatus(t('map.status.searching', '查詢中…'), true);
  clearMarkers();
  const list = $("#resultList");
  const countsEl = $("#counts");
  if (list) list.innerHTML = "";
  if (countsEl) countsEl.innerHTML = "";

  const r = +$("#radiusInput").value;
  const q = buildQuery(currentCenter.lat, currentCenter.lon, r, types);

  let json;
  try {
    json = await overpassQuery(q);
  } catch (e) {
    setStatus(t('map.status.overpassFail', 'Overpass API 失敗或逾時，請稍後再試。'));
    return;
  }

  const pts = elementsToPoints(json.elements || []);
  const within = pts.filter(
    (p) => dist(currentCenter, { lat: p.lat, lon: p.lon }) <= r
  );

  // counts and pins
  const counts = {};
  for (const t of types) counts[t] = 0;

  within.forEach((p) => {
    const t = p.tags || {};
    let typeKey = null;
    if (t.amenity === "place_of_worship") typeKey = "temple";
    else if (t.landuse === "cemetery" || t.amenity === "grave_yard")
      typeKey = "grave";
    else if (t.amenity === "fuel") typeKey = "fuel";
    else if (t.amenity === "internet_cafe") typeKey = "cafe";
    else if (t.leisure === "amusement_arcade") typeKey = "arcade";
    if (!typeKey || !types.includes(typeKey)) return;

    counts[typeKey]++;
    const m = L.marker([p.lat, p.lon], {
      icon: pin(CATEGORY_DEFS[typeKey].color),
    }).addTo(map);
    m.bindPopup(
      `<strong>${t.name || "(未命名)"}</strong><br><span class="small">${typeKey}</span>`
    );
    markers.push(m);
  });

  // counts（使用 i18n 的 cat.* 名稱）— 儲存 data 以便語言切換重繪
  const frag = document.createDocumentFragment();
  for (const k of types) {
    const s = document.createElement("span");
    s.className = "badge";
    s.dataset.type = k;
    s.dataset.count = String(counts[k] || 0);
    s.innerHTML =
      `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CATEGORY_DEFS[k].color};border:2px solid #fff"></span>` +
      `${t('cat.' + k, CATEGORY_DEFS[k].label)}：${s.dataset.count}`;
    frag.appendChild(s);
  }
  if (countsEl) countsEl.appendChild(frag);

  // list
  within.sort(
    (a, b) =>
      dist(currentCenter, { lat: a.lat, lon: a.lon }) -
      dist(currentCenter, { lat: b.lat, lon: b.lon })
  );
  if (list) {
    for (const p of within) {
      const t = p.tags || {};
      const name = t.name || "(未命名)";
      const osm = `https://www.openstreetmap.org/${p.type}/${p.id}`;
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<div><strong>${name}</strong></div>
      <div class="small">${t.amenity || t.landuse || t.leisure || ""} · ${p.lat.toFixed(
        6
      )}, ${p.lon.toFixed(6)} · <a href="${osm}" target="_blank">OSM</a></div>`;
      list.appendChild(item);
    }
  }

  // 查詢完成（使用 i18n）
  setStatus(t('map.status.ready', '完成。'));
}

/* ---------- Bind core UI ---------- */
function bindUI() {
  const doSearch = $("#doSearch");
  if (doSearch) doSearch.addEventListener("click", runSearch);

  const useLoc = $("#useLoc");
  if (useLoc) {
    useLoc.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("此瀏覽器不支援定位");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentCenter = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          };
          map.setView([currentCenter.lat, currentCenter.lon], 16);
          centerMarker.setLatLng([currentCenter.lat, currentCenter.lon]);
          redrawCircle();
        },
        (err) => alert("無法取得位置：" + err.message)
      );
    });
  }
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  bindRadius();
  initMap();
  bindUI();
  // 預設狀態顯示（i18n）
  setStatus(t('map.status.ready', 'Ready.'));

  // 語言切換：不重新查詢，僅就地重繪狀態與計數徽章
  document.addEventListener('i18n:changed', () => {
    const st = document.getElementById('status');
    const busy = !!st && st.classList.contains('busy');
    setStatus(t(busy ? 'map.status.searching' : 'map.status.ready'), busy);

    document.querySelectorAll('#counts .badge').forEach((b) => {
      const k = b.dataset.type;
      const c = b.dataset.count || '0';
      b.innerHTML =
        `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CATEGORY_DEFS[k].color};border:2px solid #fff"></span>` +
        `${t('cat.' + k, CATEGORY_DEFS[k].label)}：${c}`;
    });
  });
});

/* ===========================================================
   Fuzzy search (global-only), POI-first, JSONP, stay-open
   - No CORS issues (JSONP only)
   - Always global (never uses viewbox/bounded)
   - Photon first; fallback to Nominatim
   - POI-first ranking: stations > common POIs > addresses
   =========================================================== */
(function () {
  const input = document.getElementById("searchBox");
  const goBtn = document.getElementById("doSearch");
  if (!input) return;

  // Floating dropdown attached to <body>
  let layer = document.getElementById("sbLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "sbLayer";
    layer.style.cssText = "position:absolute;z-index:2147483647;display:none";
    const ul = document.createElement("ul");
    ul.id = "sbList";
    ul.style.cssText =
      "list-style:none;margin:0;padding:0;min-width:280px;max-height:260px;overflow:auto;background:#0e1726;border:1px solid #253045;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,.35)";
    layer.appendChild(ul);
    document.body.appendChild(layer);
  }
  const ul = document.getElementById("sbList");

  function placeLayer() {
    const r = input.getBoundingClientRect();
    layer.style.left = window.scrollX + r.left + "px";
    layer.style.top = window.scrollY + r.bottom + 6 + "px";
    layer.style.width = r.width + "px";
  }
  window.addEventListener("resize", () => {
    if (layer.style.display !== "none") placeLayer();
  });
  window.addEventListener("scroll", () => {
    if (layer.style.display !== "none") placeLayer();
  });
  input.addEventListener("focus", () => {
    if (ul.children.length) {
      placeLayer();
      layer.style.display = "block";
    }
  });

  // JSONP helper
  function jsonp(url, cbParam) {
    return new Promise((resolve, reject) => {
      const cb = "__cb_" + Math.random().toString(36).slice(2);
      const sep = url.indexOf("?") >= 0 ? "&" : "?";
      const u = url + sep + (cbParam || "callback") + "=" + cb;
      const s = document.createElement("script");
      let done = false;
      window[cb] = (data) => {
        if (done) return;
        done = true;
        try {
          resolve(data || []);
        } finally {
          try {
            delete window[cb];
          } catch (e) {}
          s.remove();
        }
      };
      s.onerror = () => {
        if (done) return;
        done = true;
        try {
          delete window[cb];
        } catch (e) {}
        reject(new Error("jsonp failed"));
      };
      s.src = u;
      document.body.appendChild(s);
      setTimeout(() => {
        if (!done) {
          done = true;
          try {
            delete window[cb];
          } catch (e) {}
          s.remove();
          reject(new Error("jsonp timeout"));
        }
      }, 12000);
    });
  }

  // Providers (global only)
  async function geocodePhoton(q) {
    const data = await jsonp(
      "https://photon.komoot.io/api/?q=" +
        encodeURIComponent(q) +
        "&limit=8&lang=zh",
      "callback"
    );
    const feats = (data && data.features) || [];
    return feats.map((f) => {
      const coords =
        f.geometry && Array.isArray(f.geometry.coordinates)
          ? f.geometry.coordinates
          : [null, null];
      const lon = coords[0];
      const lat = coords[1];
      const p = f.properties || {};
      const parts = [p.name, p.street, p.city, p.country].filter(Boolean);
      return {
        lat,
        lon,
        display_name: parts.join(", ") || p.name || "",
        src: "photon",
        osm_key: p.osm_key || "",
        osm_value: p.osm_value || "",
      };
    });
  }

  // Always-global Nominatim lookup (no viewbox/bounded, ignores bounds)
  async function geocodeNominatim(q /*, bounds */) {
    const base =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&namedetails=0&limit=8&q=";
    const url = base + encodeURIComponent(q);
    const arr = await Promise.race([jsonp(url, "callback"), jsonp(url, "json_callback")]);
    return (arr || []).map((r) => ({
      lat: +r.lat,
      lon: +r.lon,
      display_name: r.display_name || r.name || "",
      src: "nominatim",
      class: r.class || "",
      type: r.type || "",
    }));
  }

  // POI-first scoring
  function scorePOI(it) {
    const text = (it.display_name || "").toLowerCase();
    const isStationText = /station|車站|捷運|地鐵|高鐵|火車/.test(text);

    const key = it.osm_key || it.class || "";
    const val = it.osm_value || it.type || "";

    const isStation =
      key === "railway" && (val === "station" || val === "stop" || val === "halt");
    const isMetro =
      (key === "railway" && val === "subway_entrance") ||
      (key === "public_transport" && /station|stop/.test(val));
    const isPOI = ["amenity", "tourism", "leisure", "shop"].includes(key);

    let s = 0;
    if (isStation || isMetro) s += 100;
    if (isStationText) s += 40;
    if (isPOI) s += 20;
    if (["place", "highway", "boundary"].includes(key)) s -= 10; // addresses lower
    return s;
  }

  async function smartGeocode(q) {
    try {
      const a = await geocodePhoton(q);
      if (a && a.length) return a;
    } catch (e) {}
    try {
      const b = await geocodeNominatim(q);
      return b || [];
    } catch (e) {}
    return [];
  }

  // Render & interactions
  let timer;
  let active = -1;
  let ticket = 0;
  let lastItems = [];

  function setActive(i) {
    active = i;
    [...ul.children].forEach((li, idx) => {
      li.style.background = idx === active ? "#152234" : "";
    });
  }

  function render(items) {
    lastItems = items.slice(0, 8);
    ul.innerHTML = "";
    active = -1;
    lastItems.forEach((it, idx) => {
      const li = document.createElement("li");
      li.textContent = it.display_name || "";
      li.style.cssText =
        "padding:10px 12px;cursor:pointer;border-bottom:1px solid #1b2636";
      li.addEventListener("mouseenter", () => setActive(idx));
      li.addEventListener("mouseleave", () => setActive(-1));
      li.addEventListener("click", () => select(it));
      ul.appendChild(li);
    });
    if (lastItems.length) {
      placeLayer();
      layer.style.display = "block";
    } else {
      layer.style.display = "none";
    }
  }

  function select(item) {
    layer.style.display = "none";
    if (!item) return;

    const lat = +item.lat;
    const lon = +item.lon;

    // update app center
    currentCenter = { lat, lon };

    // recenter map & move the cyan center marker
    map.setView([lat, lon], 16);
    centerMarker.setLatLng([lat, lon]);

    // keep the radius circle in sync
    redrawCircle();

    // optional: show the chosen label in the box
    input.value = item.display_name || "";
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) {
      ul.innerHTML = "";
      layer.style.display = "none";
      return;
    }
    timer = setTimeout(async () => {
      const my = ++ticket;
      let items = [];
      try {
        items = await smartGeocode(q);
      } catch (e) {
        items = [];
      }
      if (my !== ticket) return;
      items.sort((a, b) => scorePOI(b) - scorePOI(a));
      render(items);
    }, 220);
  });

  input.addEventListener("keydown", async (e) => {
    if (layer.style.display !== "none") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.min(active + 1, ul.children.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const li = ul.children[active];
        if (li) {
          li.click();
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        layer.style.display = "none";
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (lastItems.length) {
        select(lastItems[active >= 0 ? active : 0]);
        return;
      }
      const q = input.value.trim();
      if (!q) return;
      try {
        const arr = await smartGeocode(q);
        arr.sort((a, b) => scorePOI(b) - scorePOI(a));
        if (arr && arr.length) select(arr[0]);
      } catch (err) {}
    }
  });

  if (goBtn) {
    goBtn.addEventListener("click", async (ev) => {
      const q = input.value.trim();
      if (!q) return;
      ev.preventDefault();
      try {
        const arr = await smartGeocode(q);
        arr.sort((a, b) => scorePOI(b) - scorePOI(a));
        if (arr && arr.length) select(arr[0]);
      } catch (err) {}
    });
  }

  // Only hide when clicking outside input, list, or the search button
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t === input || t === goBtn || layer.contains(t)) return;
    layer.style.display = "none";
  });
})();
