mapboxgl.accessToken = "pk.eyJ1IjoiZXlhZDAyIiwiYSI6ImNtbWQ1ZGowMjBibDUycXNiMm9yeTd1NHoifQ.aUq1kh2qBAIUM6Hcxf5NGg";

const SITE_CENTER = [55.4352569, 25.020628]; // [lng, lat]
const SITE_ZOOM = 17;

let map, userMarker;
let plots = [];
let selectedPlot = null;
let lastUser = null;

const nearestPlotEl = document.getElementById("nearestPlot");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const navigateBtn = document.getElementById("navigateBtn");

init();

async function init() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: SITE_CENTER,
    zoom: SITE_ZOOM
  });

  map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

  const res = await fetch("./plots.json");
  plots = await res.json();

  map.on("load", () => {
    addPlotPins();
    startLiveLocation();
  });

  searchBtn.addEventListener("click", searchPlot);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") searchPlot(); });

  navigateBtn.addEventListener("click", () => {
    if (!selectedPlot || !lastUser) return;
    openGoogleDirections(lastUser, [selectedPlot.lng, selectedPlot.lat]);
  });
}

function addPlotPins() {
  for (const p of plots) {
    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.background = "#111";
    el.style.border = "2px solid white";

    const m = new mapboxgl.Marker(el)
      .setLngLat([p.lng, p.lat])
      .setPopup(new mapboxgl.Popup({ offset: 20 }).setText(p.plot_id))
      .addTo(map);

    el.addEventListener("click", () => {
      selectedPlot = p;
      navigateBtn.disabled = !lastUser;
    });
  }
}

function startLiveLocation() {
  if (!navigator.geolocation) {
    nearestPlotEl.textContent = "Location not supported";
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude];
      lastUser = lngLat;

      if (!userMarker) {
        userMarker = new mapboxgl.Marker({ color: "#ff0000" })
          .setLngLat(lngLat)
          .addTo(map);
        map.flyTo({ center: lngLat, zoom: SITE_ZOOM });
      } else {
        userMarker.setLngLat(lngLat);
      }

      const nearest = findNearestPlot(lngLat);
      nearestPlotEl.textContent = nearest ? nearest.plot_id : "No plots loaded";

      navigateBtn.disabled = !selectedPlot;
    },
    () => {
      nearestPlotEl.textContent = "Location blocked (allow permission)";
    },
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
  );
}

function findNearestPlot(userLngLat) {
  if (!plots.length) return null;
  const user = turf.point(userLngLat);

  let best = null;
  let bestDist = Infinity;

  for (const p of plots) {
    const pt = turf.point([p.lng, p.lat]);
    const d = turf.distance(user, pt, { units: "meters" });
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function searchPlot() {
  const q = (searchInput.value || "").trim().toLowerCase();
  if (!q) return;

  const p = plots.find(x => x.plot_id.toLowerCase() === q);
  if (!p) { alert("Plot not found"); return; }

  selectedPlot = p;
  map.flyTo({ center: [p.lng, p.lat], zoom: SITE_ZOOM + 1 });
  navigateBtn.disabled = !lastUser;
}

function openGoogleDirections(fromLngLat, toLngLat) {
  const from = `${fromLngLat[1]},${fromLngLat[0]}`;
  const to = `${toLngLat[1]},${toLngLat[0]}`;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=walking`;
  window.open(url, "_blank");
}