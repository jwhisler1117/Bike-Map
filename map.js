// Import Mapbox (ESM)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
// Import D3 (ESM)
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ✅ Your Mapbox token
mapboxgl.accessToken = 'pk.eyJ1IjoiandoaXNsZXIxMTE3IiwiYSI6ImNtaHRrYWZzdzF6YmwycnEwMmVxeGU5cHYifQ.yp1rbNFWqnbk_1kfoRJKQw';

// ✅ Initialize map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Nice UX: zoom/rotation controls
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

/* -------------------------
   Helper (global) for D3 overlay
--------------------------*/

// Convert lon/lat to pixel coords in current view
function getCoords(station) {
  const lng = +station.lon; // ensure numbers
  const lat = +station.lat;
  const p = map.project(new mapboxgl.LngLat(lng, lat));
  return { cx: p.x, cy: p.y };
}

// Select the overlay SVG once
const svg = d3.select('#map').select('#overlay');

/* -------------------------
   Step 2: Bike lane layers
--------------------------*/
map.on('load', async () => {
  // Shared style for both cities
  const bikeLinePaint = {
    'line-color': '#32D400',
    'line-opacity': 0.6,
    'line-width': [
      'interpolate', ['linear'], ['zoom'],
      10, 1.5,
      12, 3,
      14, 5
    ]
  };

  // --- Boston bike lanes ---
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLinePaint
  });

  // --- Cambridge bike lanes ---
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...bikeLinePaint, 'line-dasharray': [2, 2] } // dashed = Cambridge
  });

  /* -------------------------
     Step 3: Bluebikes stations (D3 + SVG)
  --------------------------*/

  // 3.1 Fetch & normalize the JSON
  const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

  let stationsRaw;
  try {
    const json = await d3.json(STATIONS_URL);

    // The lab mentions two possible shapes; normalize either:
    // A) { data: { stations: [...] } }  (GBFS-ish)
    // B) [ { NAME, Lat, Long, ... }, ... ] (flat array with capitalized fields)
    stationsRaw = json?.data?.stations ?? json;

    // Map into a consistent shape we’ll use everywhere
    var stations = stationsRaw.map(s => ({
      name: s.NAME ?? s.name ?? s.station_name ?? s.station ?? 'Unknown',
      lat: +(s.Lat ?? s.lat ?? s.latitude ?? s.Latitude),
      lon: +(s.Long ?? s.lon ?? s.longitude ?? s.Longitude),
      municipality: s.Municipality ?? s.municipality ?? '',
      docks: +(s['Total Docks'] ?? s.capacity ?? s.docks ?? 0)
    })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon));

    console.log('Loaded stations:', stations.length);
  } catch (err) {
    console.error('Error loading stations JSON:', err);
    return; // bail if we have no data
  }

  // 3.2 Append circles to the SVG
  const circles = svg.selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.85);

  // 3.3 Position updater (initial + on interactions)
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  // Initial draw
  updatePositions();

  // Keep markers aligned as the map changes
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
});

// Log Mapbox errors (useful if a source URL fails CORS, etc.)
map.on('error', e => console.error('Mapbox error:', e && e.error));
