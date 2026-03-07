mapboxgl.accessToken = "pk.eyJ1IjoiZXlhZDAyIiwiYSI6ImNtbWQ1ZGowMjBibDUycXNiMm9yeTd1NHoifQ.aUq1kh2qBAIUM6Hcxf5NGg";

const SITE_CENTER = [55.4352569, 25.020628];
const SITE_ZOOM = 17;
const SEARCH_ZOOM = 18;
const INITIAL_BEARING = -20;
const INITIAL_PITCH = 60;

let map;
let plots = [];
let selectedPlot = null;
let lastUser = null;
let followMe = true;
let rotating = true;
let rotateTimer = null;

let youAreHereMarker = null;
let selectedRingMarker = null;
let hasInitialLocationFocus = false;

// UI
const nearestPlotEl = document.getElementById("nearestPlot");
const distanceChip = document.getElementById("distanceChip");
const gpsStatus = document.getElementById("gpsStatus");
const plotSearch = document.getElementById("plotSearch");
const plotOptions = document.getElementById("plotOptions");
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
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
    antialias: true
  });

  map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

  const res = await fetch(`./plots.json?v=${Date.now()}`);
  plots = await res.json();

  populatePlotOptions();

  map.on("load", () => {
    addSelectionHighlightLayersSafe();
    addPlotPins();
    add3DSafe();
    startLiveLocation();
  });

  searchBtn.addEventListener("click", searchAny);

  plotSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchAny();
  });

  plotSearch.addEventListener("change", () => {
    if (plotSearch.value.trim()) searchAny();
  });

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

function populatePlotOptions() {
  plotOptions.innerHTML = "";

  const sorted = [...plots].sort((a, b) => {
    const aText = String(a.plot_id || "").toUpperCase();
    const bText = String(b.plot_id || "").toUpperCase();
    return aText.localeCompare(bText, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });

  for (const p of sorted) {
    const option = document.createElement("option");
    const pid = String(p.plot_id || "").trim();

    option.value = pid;   // only plot_id
    // do NOT set option.label

    plotOptions.appendChild(option);
  }
}

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
      .setPopup(new mapboxgl.Popup({ offset: 22 }).setText(p.name || p.plot_id))
      .addTo(map);

    el.addEventListener("click", () => {
      stopRotationAndFollow();
      selectedPlot = p;
      navigateBtn.disabled = !lastUser;
      setSelectedHighlightSafe(p);
      setSelectedRingMarker(p);

      plotSearch.value = p.plot_id || p.name || "";

      map.easeTo({
        center: [p.lng, p.lat],
        zoom: SEARCH_ZOOM,
        pitch: 45,
        bearing: 0,
        duration: 1200
      });
    });
  }
}

function startLiveLocation() {
  if (!navigator.geolocation) {
    gpsStatus.textContent = "GPS: Not supported";
    nearestPlotEl.textContent = "No GPS";
    return;
  }

  gpsStatus.textContent = "GPS: Waiting…";

  navigator.geolocation.watchPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude];
      lastUser = lngLat;

      gpsStatus.textContent = `GPS: OK (${Math.round(pos.coords.accuracy)}m)`;

      if (!youAreHereMarker) {
        const el = buildYouAreHereElement();
        youAreHereMarker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        youAreHereMarker.setLngLat(lngLat);
      }

      if (!hasInitialLocationFocus) {
        hasInitialLocationFocus = true;

        map.easeTo({
          center: lngLat,
          zoom: SITE_ZOOM,
          pitch: INITIAL_PITCH,
          bearing: INITIAL_BEARING,
          duration: 1400
        });

        if (rotating) {
          setTimeout(() => {
            if (autoRotateChk.checked) startAutoRotate();
          }, 1500);
        }
      } else if (followMe) {
        map.easeTo({
          center: lngLat,
          zoom: Math.max(map.getZoom(), SITE_ZOOM),
          duration: 650
        });
      }

      const nearest = findNearestPlot(lngLat);
      if (nearest) {
        nearestPlotEl.textContent = nearest.name || nearest.plot_id || "—";
        distanceChip.textContent = `Distance: ${Math.round(nearest.distance_m)} m`;
      } else {
        nearestPlotEl.textContent = "No plots loaded";
        distanceChip.textContent = "Distance: — m";
      }

      navigateBtn.disabled = !selectedPlot;
    },
    () => {
      gpsStatus.textContent = "GPS: Blocked";
      nearestPlotEl.textContent = "Allow location";
      distanceChip.textContent = "Distance: — m";
    },
    { enableHighAccuracy: true, maximumAge: 1200, timeout: 12000 }
  );
}

function buildYouAreHereElement() {
  const wrap = document.createElement("div");
  wrap.className = "you-marker";

  const pulse = document.createElement("div");
  pulse.className = "pulse";

  const dot = document.createElement("div");
  dot.className = "dot";
  dot.textContent = "🚶";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "You are here";

  wrap.appendChild(pulse);
  wrap.appendChild(dot);
  wrap.appendChild(label);

  return wrap;
}

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

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function searchAny() {
  const raw = String(plotSearch.value || "").trim();
  const q = normalizeKey(raw);
  if (!q) return;

  stopRotationAndFollow();

  let match = plots.find(
    (p) => normalizeKey(p.plot_id) === q || normalizeKey(p.name) === q
  );

  if (!match) {
    match = plots.find((p) => {
      const pid = normalizeKey(p.plot_id);
      const nm = normalizeKey(p.name);
      return (pid && pid.includes(q)) || (nm && nm.includes(q));
    });
  }

  if (!match) {
    alert("Plot/Area not found. Check Plot ID or Area Name.");
    return;
  }

  selectedPlot = match;
  navigateBtn.disabled = !lastUser;

  setSelectedHighlightSafe(match);
  setSelectedRingMarker(match);

  plotSearch.value = match.plot_id || "";

  map.easeTo({
    center: [match.lng, match.lat],
    zoom: SEARCH_ZOOM,
    pitch: 35,
    bearing: 0,
    duration: 1200
  });
}

function clearSearch() {
  plotSearch.value = "";
  selectedPlot = null;
  navigateBtn.disabled = true;

  clearSelectedHighlightSafe();
  removeSelectedRingMarker();

  followMe = true;
  followMeChk.checked = true;

  map.easeTo({
    center: lastUser || SITE_CENTER,
    zoom: SITE_ZOOM,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
    duration: 900
  });

  if (autoRotateChk.checked) {
    rotating = true;
    setTimeout(() => {
      startAutoRotate();
    }, 1000);
  }
}

function openGoogleDirections(fromLngLat, toLngLat) {
  const from = `${fromLngLat[1]},${fromLngLat[0]}`;
  const to = `${toLngLat[1]},${toLngLat[0]}`;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=walking`;
  window.open(url, "_blank");
}

function startAutoRotate() {
  stopAutoRotate();
  rotating = autoRotateChk.checked;
  if (!rotating) return;

  rotateTimer = setInterval(() => {
    const b = map.getBearing();
    map.easeTo({
      bearing: b + 0.6,
      duration: 120,
      easing: (t) => t
    });
  }, 120);
}

function stopAutoRotate() {
  if (rotateTimer) clearInterval(rotateTimer);
  rotateTimer = null;
}

function stopRotationAndFollow() {
  stopAutoRotate();
  rotating = false;
  followMe = false;
  followMeChk.checked = false;
}

function addSelectionHighlightLayersSafe() {
  try {
    if (!map.getSource("selected-point")) {
      map.addSource("selected-point", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }

    if (!map.getLayer("selected-glow")) {
      map.addLayer({
        id: "selected-glow",
        type: "circle",
        source: "selected-point",
        paint: {
          "circle-radius": 22,
          "circle-color": "rgba(255, 59, 48, 0.20)"
        }
      });
    }

    if (!map.getLayer("selected-ring")) {
      map.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "selected-point",
        paint: {
          "circle-radius": 14,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 4,
          "circle-stroke-color": "rgba(255, 59, 48, 0.95)"
        }
      });
    }

    if (!map.getLayer("selected-dot")) {
      map.addLayer({
        id: "selected-dot",
        type: "circle",
        source: "selected-point",
        paint: {
          "circle-radius": 6,
          "circle-color": "rgba(255, 204, 0, 1)",
          "circle-stroke-width": 2,
          "circle-stroke-color": "white"
        }
      });
    }
  } catch (e) {
    console.warn("Highlight layers failed, using HTML fallback only:", e);
  }
}

function setSelectedHighlightSafe(p) {
  try {
    const src = map.getSource("selected-point");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { plot_id: p.plot_id, name: p.name || "" }
      }]
    });
  } catch (e) {
    console.warn("setSelectedHighlightSafe failed:", e);
  }
}

function clearSelectedHighlightSafe() {
  try {
    const src = map.getSource("selected-point");
    if (!src) return;
    src.setData({ type: "FeatureCollection", features: [] });
  } catch (e) {
    console.warn("clearSelectedHighlightSafe failed:", e);
  }
}

function setSelectedRingMarker(p) {
  removeSelectedRingMarker();
  const el = document.createElement("div");
  el.className = "sel-ring";
  selectedRingMarker = new mapboxgl.Marker({ element: el, anchor: "center" })
    .setLngLat([p.lng, p.lat])
    .addTo(map);
}

function removeSelectedRingMarker() {
  if (selectedRingMarker) {
    selectedRingMarker.remove();
    selectedRingMarker = null;
  }
}

function add3DSafe() {
  try {
    if (!map.getSource("mapbox-dem")) {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });
    }

    if (!map.getLayer("sky")) {
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 0.0],
          "sky-atmosphere-sun-intensity": 12
        }
      });
    }

    const layers = map.getStyle().layers || [];
    const labelLayerId = layers.find(
      (l) => l.type === "symbol" && l.layout && l.layout["text-field"]
    )?.id;

    if (!map.getLayer("3d-buildings")) {
      map.addLayer(
        {
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 15,
          paint: {
            "fill-extrusion-opacity": 0.35,
            "fill-extrusion-height": [
              "interpolate",
              ["linear"],
              ["zoom"],
              15, 0,
              16, ["get", "height"]
            ],
            "fill-extrusion-base": [
              "interpolate",
              ["linear"],
              ["zoom"],
              15, 0,
              16, ["get", "min_height"]
            ]
          }
        },
        labelLayerId
      );
    }
  } catch (e) {
    console.warn("3D extras skipped:", e);
  }
}