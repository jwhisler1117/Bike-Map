// Import Mapbox (ESM) and D3 (ESM)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ✅ Your Mapbox public token
mapboxgl.accessToken = 'pk.eyJ1IjoiandoaXNsZXIxMTE3IiwiYSI6ImNtaHRrYWZzdzF6YmwycnEwMmVxeGU5cHYifQ.yp1rbNFWqnbk_1kfoRJKQw';

// Create the base map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston/Cambridge
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Nav controls
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// Helper: convert lon/lat to current pixel coords
function getCoords(station) {
  const lng = +station.lon;
  const lat = +station.lat;
  const p = map.project(new mapboxgl.LngLat(lng, lat));
  return { cx: p.x, cy: p.y };
}

// Select overlay elements
const svg = d3.select('#overlay');
const tooltip = d3.select('#tooltip');

/* -------------------------
   Step 2: Bike lane layers
--------------------------*/
map.on('load', async () => {
  // Shared paint for line layers
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

  // Boston
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLinePaint
  });

  // Cambridge
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...bikeLinePaint, 'line-dasharray': [2, 2] }
  });

  /* -------------------------
     Step 3: Stations (D3 circles)
  --------------------------*/
  const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

  let stationsRaw, stations;
  try {
    const json = await d3.json(STATIONS_URL);
    stationsRaw = json?.data?.stations ?? json;

    stations = stationsRaw.map(s => ({
      id: (s.short_name ?? s.Number ?? s.station_id ?? s.number ?? '').toString(),
      name: s.NAME ?? s.name ?? s.station_name ?? s.station ?? 'Unknown',
      lat: +(s.Lat ?? s.lat ?? s.latitude ?? s.Latitude),
      lon: +(s.Long ?? s.lon ?? s.longitude ?? s.Longitude),
      municipality: s.Municipality ?? s.municipality ?? '',
      docks: +(s['Total Docks'] ?? s.capacity ?? s.docks ?? 0)
    })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon));
  } catch (e) {
    console.error('Error loading stations JSON:', e);
    return;
  }

  // Draw base circles (we’ll size them after traffic loads)
  svg.selectAll('circle')
    .data(stations, d => d.id)
    .enter()
    .append('circle')
    .attr('r', 3);

  /* -------------------------
     Step 4: Trips + traffic
  --------------------------*/
  const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  let trips = [];
  try {
    trips = await d3.csv(TRIPS_URL, d => ({
      start: d.start_station_id?.toString() ?? '',
      end:   d.end_station_id?.toString() ?? '',
      started_at: d.started_at,
      ended_at: d.ended_at
    }));
  } catch (e) {
    console.error('Error loading trips CSV:', e);
  }

  const departures = d3.rollup(trips, v => v.length, d => d.start);
  const arrivals   = d3.rollup(trips, v => v.length, d => d.end);

  stations = stations.map(st => {
    const dep = departures.get(st.id) ?? 0;
    const arr = arrivals.get(st.id) ?? 0;
    return { ...st, departures: dep, arrivals: arr, totalTraffic: dep + arr };
  });

  // Area-accurate radius scale
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic) || 0])
    .range([0, 25]);

  // Update circles with radii + data join (ensure we have titles/events)
  const circles = svg.selectAll('circle')
    .data(stations, d => d.id);

  const circlesEnter = circles.enter()
    .append('circle');

  circlesEnter.merge(circles)
    .attr('r', d => radiusScale(d.totalTraffic));

  circles.exit().remove();

  /* -------------------------
     Step 4.4: HTML tooltip (follow cursor)
  --------------------------*/
  // Add interaction handlers on circles
  svg.selectAll('circle')
    .on('mouseenter', function (event, d) {
      tooltip
        .style('opacity', 1)
        .attr('aria-hidden', 'false')
        .html(`
          <strong>${d.name}</strong>
          <div><b>${d.totalTraffic.toLocaleString()}</b> total trips</div>
          <div>${d.departures.toLocaleString()} departures · ${d.arrivals.toLocaleString()} arrivals</div>
        `);
    })
    .on('mousemove', function (event) {
      // Position tooltip near the cursor, with some padding
      const pad = 12;
      tooltip.style('left', `${event.clientX + pad}px`)
             .style('top',  `${event.clientY + pad}px`);
    })
    .on('mouseleave', function () {
      tooltip.style('opacity', 0).attr('aria-hidden', 'true');
    });

  /* -------------------------
     Keep circles aligned with the map
  --------------------------*/
  function updatePositions() {
    svg.selectAll('circle')
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
});

// Helpful error logging
map.on('error', e => console.error('Mapbox error:', e && e.error));
