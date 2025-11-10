import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1IjoiandoaXNsZXIxMTE3IiwiYSI6ImNtaHRrYWZzdzF6YmwycnEwMmVxeGU5cHYifQ.yp1rbNFWqnbk_1kfoRJKQw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

/* Helpers */
const svg = d3.select('#overlay');
const tooltip = d3.select('#tooltip');
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');
function formatTime(mins) {
  if (mins < 0) return '';
  const d = new Date(0, 0, 0, 0, mins);
  return d.toLocaleString('en-US', { timeStyle: 'short' });
}
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function getCoords(st) {
  const p = map.project(new mapboxgl.LngLat(+st.lon, +st.lat));
  return { cx: p.x, cy: p.y };
}

/* Flow color quantize scale */
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

/* Precompute buckets */
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

/* Fast retrieval */
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  let min = (minute - 60 + 1440) % 1440;
  let max = (minute + 60) % 1440;
  if (min > max) {
    return tripsByMinute.slice(min).concat(tripsByMinute.slice(0, max)).flat();
  }
  return tripsByMinute.slice(min, max).flat();
}

/* Compute arrivals/departures for each station */
function computeStationTraffic(stations, timeFilter = -1) {
  const deps = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );
  const arrs = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );
  return stations.map(s => {
    const departures = deps.get(s.id) ?? 0;
    const arrivals = arrs.get(s.id) ?? 0;
    return { ...s, departures, arrivals, totalTraffic: departures + arrivals };
  });
}

/* ───────── Load map + data ───────── */
map.on('load', async () => {
  const linePaint = {
    'line-color': '#32D400',
    'line-width': 3,
    'line-opacity': 0.6,
  };
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({ id: 'bike-boston', type: 'line', source: 'boston_route', paint: linePaint });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...linePaint, 'line-dasharray': [2, 2] },
  });

  /* Stations */
  const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  const baseStations = stationData.data.stations.map(s => ({
    id: s.short_name.toString(),
    name: s.name,
    lat: +s.lat,
    lon: +s.lon,
  }));

  svg.selectAll('circle')
    .data(baseStations, d => d.id)
    .enter()
    .append('circle')
    .attr('r', 3);

  /* Trips + bucketing */
  await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', t => {
    t.started_at = new Date(t.started_at);
    t.ended_at = new Date(t.ended_at);
    const s = minutesSinceMidnight(t.started_at);
    const e = minutesSinceMidnight(t.ended_at);
    departuresByMinute[s].push(t);
    arrivalsByMinute[e].push(t);
    return t;
  });

  const radiusScale = d3.scaleSqrt().domain([0, 1]).range([0, 25]);

  function updatePositions() {
    svg.selectAll('circle')
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);

  /* Tooltip handlers */
  const enter = (e, d) => {
    tooltip
      .style('opacity', 1)
      .html(
        `<strong>${d.name}</strong>
         <div>${d.totalTraffic.toLocaleString()} trips</div>
         <div>${d.departures} dep · ${d.arrivals} arr</div>`
      );
  };
  const move = e =>
    tooltip.style('left', `${e.clientX + 12}px`).style('top', `${e.clientY + 12}px`);
  const leave = () => tooltip.style('opacity', 0);

  /* Main render/update */
  function renderForTime(timeFilter) {
    const stations = computeStationTraffic(baseStations, timeFilter);
    const maxT = d3.max(stations, d => d.totalTraffic) || 1;
    radiusScale.domain([0, maxT]);
    radiusScale.range(timeFilter === -1 ? [1.5, 18] : [2, 24]);

    const u = svg.selectAll('circle')
      .data(stations, d => d.id)
      .join('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d => {
        const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0.5;
        return stationFlow(ratio);
      })
      .on('mouseenter', enter)
      .on('mousemove', move)
      .on('mouseleave', leave);

    updatePositions();
  }

  function updateTimeDisplay() {
    const t = Number(timeSlider.value);
    if (t === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(t);
      anyTimeLabel.style.display = 'none';
    }
    renderForTime(t);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  renderForTime(-1);
});
