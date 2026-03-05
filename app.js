mapboxgl.accessToken = "pk.eyJ1IjoiZXlhZDAyIiwiYSI6ImNtbWQ1ZGowMjBibDUycXNiMm9yeTd1NHoifQ.aUq1kh2qBAIUM6Hcxf5NGg";


// Site center from your link
const SITE_CENTER = [55.4352569, 25.020628]; // [lng, lat]
const SITE_ZOOM = 17;

let map;
let plots = [];
let selectedPlot = null;
let lastUser = null;
let followMe = true;
let rotating = true;
let rotateTimer = null;

// UI
const nearestPlotEl = document.getElementById("nearestPlot");
const distanceChip = document.getElementById("distanceChip");
const gpsStatus = document.getElementById("gpsStatus");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");
const navigateBtn = document.getElementById("navigateBtn");
const autoRotateChk = document.getElementById("autoRotate");
const followMeChk = document.getElementById("followMe");

init();

async function init() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: SITE_CENTER,
    zoom: SITE_ZOOM,
    pitch: 60,
    bearing: -20,
    antialias: true
  });

  map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

  // Load plots
  const res = await fetch("./plots.json");
  plots = await res.json();

  map.on("load", () => {
    add3D(map);
    addPlotPins();
    startLiveLocation();
    startAutoRotate();
  });

  searchBtn.addEventListener("click", searchAny);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") searchAny(); });

  clearBtn.addEventListener("click", clearSearch);

  navigateBtn.addEventListener("click", () => {
    if (!selectedPlot || !lastUser) return;
    openGoogleDirections(lastUser, [selectedPlot.lng, selectedPlot.lat]);
  });

  autoRotateChk.addEventListener("change", () => {
    rotating = autoRotateChk.checked;
    if (rotating) startAutoRotate();
    else stopAutoRotate();
  });

  followMeChk.addEventListener("change", () => {
    followMe = followMeChk.checked;
  });
}

// --------- 3D / Terrain / Sky / Buildings ----------
function add3D(map) {
  // Terrain (3D ground)
  map.addSource("mapbox-dem", {
    type: "raster-dem",
    url: "mapbox://mapbox.mapbox-terrain-dem-v1",
    tileSize: 512,
    maxzoom: 14
  });

  map.setTerrain({ source: "mapbox-dem", exaggeration: 1.35 });

  // Sky layer (nice 3D look)
  map.addLayer({
    id: "sky",
    type: "sky",
    paint: {
      "sky-type": "atmosphere",
      "sky-atmosphere-sun": [0.0, 0.0],
      "sky-atmosphere-sun-intensity": 12
    }
  });

  // 3D buildings (only where available)
  const layers = map.getStyle().layers;
  const labelLayerId = layers.find(
    (l) => l.type === "symbol" && l.layout && l.layout["text-field"]
  )?.id;

  map.addLayer(
    {
      id: "3d-buildings",
      source: "composite",
      "source-layer": "building",
      filter: ["==", "extrude", "true"],
      type: "fill-extrusion",
      minzoom: 15,
      paint: {
        "fill-extrusion-opacity": 0.85,
        "fill-extrusion-height": [
          "interpolate", ["linear"], ["zoom"],
          15, 0,
          16, ["get", "height"]
        ],
        "fill-extrusion-base": [
          "interpolate", ["linear"], ["zoom"],
          15, 0,
          16, ["get", "min_height"]
        ]
      }
    },
    labelLayerId
  );
}

// --------- Plot Pins ----------
function addPlotPins() {
  for (const p of plots) {
    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.background = "linear-gradient(135deg, #ff3b30, #ffcc00)";
    el.style.border = "2px solid white";
    el.style.boxShadow = "0 8px 18px rgba(0,0,0,.25)";

    new mapboxgl.Marker(el)
      .setLngLat([p.lng, p.lat])
      .setPopup(new mapboxgl.Popup({ offset: 22 }).setHTML(pinPopupHTML(p)))
      .addTo(map);

    el.addEventListener("click", () => {
      selectedPlot = p;
      navigateBtn.disabled = !lastUser;
    });
  }
}

function pinPopupHTML(p) {
  const title = escapeHtml(p.name || p.plot_id);
  const id = escapeHtml(p.plot_id || "");
  const tags = Array.isArray(p.tags) ? p.tags.join(", ") : "";
  return `
    <div style="font-family:Arial; font-weight:800; font-size:13px;">${title}</div>
    <div style="font-family:Arial; font-size:12px; color:#555; margin-top:4px;">${id}</div>
    ${tags ? `<div style="font-family:Arial; font-size:11px; color:#777; margin-top:6px;">${escapeHtml(tags)}</div>` : ""}
  `;
}

// --------- Live Location (Animated pulsing dot) ----------
function startLiveLocation() {
  if (!navigator.geolocation) {
    gpsStatus.textContent = "GPS: Not supported";
    nearestPlotEl.textContent = "No GPS";
    return;
  }

  gpsStatus.textContent = "GPS: Waiting…";

  // Add pulsing dot image for user
  const pulsingDot = makePulsingDot(map);

  if (!map.hasImage("pulsing-dot")) {
    map.addImage("pulsing-dot", pulsingDot, { pixelRatio: 2 });
  }

  if (!map.getSource("user")) {
    map.addSource("user", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
  }

  if (!map.getLayer("user-dot")) {
    map.addLayer({
      id: "user-dot",
      type: "symbol",
      source: "user",
      layout: { "icon-image": "pulsing-dot" }
    });
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude];
      lastUser = lngLat;

      gpsStatus.textContent = `GPS: OK (${Math.round(pos.coords.accuracy)}m)`;

      // Update user dot
      map.getSource("user").setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: lngLat },
          properties: {}
        }]
      });

      // Follow user (optional)
      if (followMe) {
        map.easeTo({
          center: lngLat,
          zoom: Math.max(map.getZoom(), SITE_ZOOM),
          duration: 650
        });
      }

      // Nearest plot
      const nearest = findNearestPlot(lngLat);
      if (nearest) {
        nearestPlotEl.textContent = nearest.plot_id || nearest.name || "—";
        distanceChip.textContent = `Distance: ${Math.round(nearest.distance_m)} m`;
      } else {
        nearestPlotEl.textContent = "No plots loaded";
        distanceChip.textContent = "Distance: — m";
      }

      navigateBtn.disabled = !selectedPlot;
    },
    (err) => {
      console.error(err);
      gpsStatus.textContent = "GPS: Blocked";
      nearestPlotEl.textContent = "Allow location";
      distanceChip.textContent = "Distance: — m";
    },
    { enableHighAccuracy: true, maximumAge: 1200, timeout: 12000 }
  );
}

// Animated pulsing dot (Mapbox example style)
function makePulsingDot(map) {
  const size = 140;

  return {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),

    onAdd: function () {
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      this.context = canvas.getContext("2d");
    },

    render: function () {
      const t = (performance.now() % 1000) / 1000;

      const radius = (size / 2) * 0.18;
      const outerRadius = (size / 2) * (0.18 + 0.25 * t);
      const ctx = this.context;

      ctx.clearRect(0, 0, this.width, this.height);

      // Outer circle
      ctx.beginPath();
      ctx.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 160, 255, ${0.20 * (1 - t)})`;
      ctx.fill();

      // Inner dot
      ctx.beginPath();
      ctx.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 140, 255, 1)";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 8;
      ctx.fill();
      ctx.stroke();

      this.data = ctx.getImageData(0, 0, this.width, this.height).data;

      map.triggerRepaint();
      return true;
    }
  };
}

// --------- Nearest plot ----------
function findNearestPlot(userLngLat) {
  if (!plots.length) return null;

  const user = turf.point(userLngLat);
  let best = null;
  let bestDist = Infinity;

  for (const p of plots) {
    const pt = turf.point([p.lng, p.lat]);
    const d = turf.distance(user, pt, { units: "meters" });

    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }

  if (!best) return null;
  return { ...best, distance_m: bestDist };
}

// --------- Search (works with OLD plots.json and NEW fields) ----------
function normalizeLoose(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\.\-_/]/g, ""); // remove . - _ /
}

function getSearchHaystack(p) {
  const parts = [];
  if (p.plot_id) parts.push(p.plot_id);
  if (p.name) parts.push(p.name);
  if (Array.isArray(p.aliases)) parts.push(...p.aliases);
  if (Array.isArray(p.tags)) parts.push(...p.tags);
  return normalizeLoose(parts.join(" | "));
}

function searchAny() {
  const raw = String(searchInput.value || "").trim();
  const q = normalizeLoose(raw);
  if (!q) return;

  // 1) Exact match priority
  let match = plots.find(p => {
    const pid = normalizeLoose(p.plot_id);
    const nm = normalizeLoose(p.name);
    const aliases = Array.isArray(p.aliases) ? p.aliases.map(normalizeLoose) : [];
    return pid === q || nm === q || aliases.includes(q);
  });

  // 2) Partial match
  if (!match) {
    match = plots.find(p => getSearchHaystack(p).includes(q));
  }

  if (!match) {
    alert("Plot/Area not found. Try Plot ID or keyword (Emergency / rest / assembly / first aid).");
    return;
  }

  selectedPlot = match;

  map.easeTo({
    center: [match.lng, match.lat],
    zoom: SITE_ZOOM + 1,
    pitch: 65,
    bearing: map.getBearing() + 15,
    duration: 900
  });

  navigateBtn.disabled = !lastUser;
}

// --------- Clear button ----------
function clearSearch() {
  searchInput.value = "";
  selectedPlot = null;
  navigateBtn.disabled = true;

  map.easeTo({
    center: SITE_CENTER,
    zoom: SITE_ZOOM,
    pitch: 60,
    bearing: -20,
    duration: 650
  });
}

// --------- Directions ----------
function openGoogleDirections(fromLngLat, toLngLat) {
  const from = `${fromLngLat[1]},${fromLngLat[0]}`;
  const to = `${toLngLat[1]},${toLngLat[0]}`;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=walking`;
  window.open(url, "_blank");
}

// --------- Auto rotate ----------
function startAutoRotate() {
  stopAutoRotate();
  rotating = autoRotateChk.checked;
  if (!rotating) return;

  rotateTimer = setInterval(() => {
    const b = map.getBearing();
    map.easeTo({ bearing: b + 0.6, duration: 120, easing: (t) => t });
  }, 120);
}

function stopAutoRotate() {
  if (rotateTimer) clearInterval(rotateTimer);
  rotateTimer = null;
}

// --------- Helper ----------
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}