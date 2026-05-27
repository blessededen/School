// 한반도 시도 인터랙티브 지도 (Leaflet)
let MAP_STATE = {
  map: null,
  layer: null,
  selectedSido: null,
  year: 2024,
  mode: 'cumulative', // 'cumulative' | 'yearly'
  listeners: [],
};

function onSidoChange(cb) { MAP_STATE.listeners.push(cb); }
function emitSidoChange(sido) {
  MAP_STATE.selectedSido = sido;
  MAP_STATE.listeners.forEach(fn => fn(sido));
}

function buildMap(containerId = 'map') {
  const map = L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 6,
    maxZoom: 9,
  }).setView([36.4, 127.9], 7);
  MAP_STATE.map = map;
  paintLayer();
  return map;
}

function getValueFor(sido) {
  const c = DATA.closure;
  if (MAP_STATE.mode === 'cumulative') {
    const yi = c.years.indexOf(MAP_STATE.year);
    return c.cumulative[sido]?.[yi] ?? 0;
  }
  const yi = c.years.indexOf(MAP_STATE.year);
  return c.yearly[sido]?.[yi] ?? 0;
}

function paintLayer() {
  const { map, year } = MAP_STATE;
  if (!map) return;
  if (MAP_STATE.layer) map.removeLayer(MAP_STATE.layer);

  // 누적 모드: 전체 기간(시도×연도) 최대값으로 고정 정규화 → 시간 흐름에 따라 빨강이 점진 강조됨
  // 단년 모드: 그해 최대로 상대 정규화 (그해 시도간 분포 강조)
  let maxVal;
  if (MAP_STATE.mode === 'cumulative') {
    if (!MAP_STATE._globalCumMax) {
      MAP_STATE._globalCumMax = Math.max(
        ...DATA.closure.sido.flatMap(s => DATA.closure.cumulative[s])
      );
    }
    maxVal = MAP_STATE._globalCumMax;
  } else {
    maxVal = Math.max(...DATA.closure.sido.map(s => getValueFor(s)));
  }

  MAP_STATE.layer = L.geoJSON(DATA.geo, {
    style: feat => {
      const sido = feat.properties.sido;
      const v = getValueFor(sido);
      return {
        fillColor: closureColor(v, maxVal),
        weight: sido === MAP_STATE.selectedSido ? 2.5 : 0.7,
        color: sido === MAP_STATE.selectedSido ? '#fff' : '#3a4868',
        fillOpacity: 0.85,
      };
    },
    onEachFeature: (feat, layer) => {
      const sido = feat.properties.sido;
      const v = getValueFor(sido);
      const label = MAP_STATE.mode === 'cumulative'
        ? `${MAP_STATE.year}년 누적`
        : `${MAP_STATE.year}년 단년`;
      layer.bindTooltip(
        `<b>${sido}</b><br>${label} <span style="color:#4dd0e1;font-weight:700">${v}</span>교`,
        { className: 'tooltip-leaflet', direction: 'top', sticky: true }
      );
      layer.on('click', () => {
        emitSidoChange(sido);
        paintLayer();
      });
      layer.on('mouseover', e => e.target.setStyle({ weight: 2, color: '#fff' }));
      layer.on('mouseout', e => {
        if (sido !== MAP_STATE.selectedSido) {
          e.target.setStyle({ weight: 0.7, color: '#3a4868' });
        }
      });
    },
  }).addTo(map);
}

function setYear(y) {
  MAP_STATE.year = y;
  paintLayer();
  MAP_STATE.listeners.forEach(fn => fn(MAP_STATE.selectedSido));
}

function setMode(m) {
  MAP_STATE.mode = m;
  paintLayer();
}
