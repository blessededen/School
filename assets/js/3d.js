// deck.gl 3D 컬럼 시각화
const SIDO_CENTROID = {
  '서울': [126.978, 37.566],
  '부산': [129.075, 35.180],
  '대구': [128.601, 35.871],
  '인천': [126.705, 37.456],
  '광주': [126.851, 35.160],
  '대전': [127.385, 36.350],
  '울산': [129.311, 35.539],
  '세종': [127.289, 36.480],
  '경기': [127.150, 37.450],
  '강원': [128.200, 37.800],
  '충북': [127.700, 36.800],
  '충남': [126.800, 36.500],
  '전북': [127.200, 35.800],
  '전남': [126.900, 34.900],
  '경북': [128.700, 36.400],
  '경남': [128.250, 35.250],
  '제주': [126.500, 33.450],
};

let DECK = null;
let HEIGHT_SCALE = 20;
let MODE = 'all'; // 'all' | 'peaks'
let ROTATE = false;
let _rotateRAF = null;
let _viewState = {
  longitude: 127.8, latitude: 36.0, zoom: 6.2,
  pitch: 50, bearing: -10,
};

async function init() {
  await loadAll();
  hideLoader();
  initReveal();
  buildDeck();

  document.getElementById('height-scale').addEventListener('input', e => {
    HEIGHT_SCALE = +e.target.value;
    document.getElementById('height-val').textContent = `×${HEIGHT_SCALE}`;
    buildDeck();
  });
  document.getElementById('btn-rotate').addEventListener('click', toggleRotate);
  document.getElementById('btn-mode').addEventListener('click', () => {
    MODE = MODE === 'all' ? 'peaks' : 'all';
    buildDeck();
  });
}

function getColumnData() {
  const c = DATA.closure;
  const arr = [];
  c.sido.forEach(s => {
    const center = SIDO_CENTROID[s];
    if (!center) return;
    c.years.forEach((y, yi) => {
      const v = c.yearly[s][yi];
      if (v <= 0) return;
      if (MODE === 'peaks' && v < 20) return;
      // 연도를 위경도에 살짝 offset 줘서 막대들이 안 겹치게
      const yearOffset = (y - 2000) / 50 * 0.2;
      arr.push({
        position: [center[0] + yearOffset, center[1]],
        height: v,
        sido: s,
        year: y,
      });
    });
  });
  return arr;
}

function buildDeck() {
  const data = getColumnData();
  const maxVal = Math.max(...data.map(d => d.height));

  const layer = new deck.ColumnLayer({
    id: 'closures-col',
    data,
    diskResolution: 12,
    radius: 4500,
    extruded: true,
    pickable: true,
    elevationScale: HEIGHT_SCALE * 100,
    getPosition: d => d.position,
    getElevation: d => d.height,
    getFillColor: d => {
      const t = d.height / maxVal;
      return [
        Math.round(77 + (255 - 77) * t),
        Math.round(208 - (208 - 107) * t),
        Math.round(225 - (225 - 138) * t),
        220,
      ];
    },
    getLineColor: [255, 255, 255, 80],
    lineWidthMinPixels: 0.5,
  });

  // 시도 라벨 layer
  const labels = Object.entries(SIDO_CENTROID).map(([s, p]) => ({
    position: p, text: s,
  }));
  const labelLayer = new deck.TextLayer({
    id: 'labels',
    data: labels,
    getPosition: d => d.position,
    getText: d => d.text,
    getSize: 14,
    getColor: [228, 232, 242, 220],
    fontFamily: 'Pretendard, Malgun Gothic, sans-serif',
    background: true,
    getBackgroundColor: [10, 14, 26, 180],
    backgroundPadding: [4, 2],
  });

  if (DECK) DECK.finalize();
  DECK = new deck.Deck({
    parent: document.getElementById('deck-host'),
    initialViewState: _viewState,
    controller: true,
    onViewStateChange: ({ viewState }) => {
      _viewState = viewState;
      DECK.setProps({ viewState });
    },
    layers: [labelLayer, layer],
    getTooltip: ({ object }) => object && {
      html: `<b>${object.sido}</b> · ${object.year}년<br>폐교 <b style="color:#4dd0e1">${object.height}</b>교`,
      style: {
        background: 'rgba(10,14,26,0.95)',
        border: '1px solid #4dd0e1',
        borderRadius: '8px',
        color: '#e4e8f2',
        fontSize: '12px',
        padding: '8px 12px',
      },
    },
  });
}

function toggleRotate() {
  ROTATE = !ROTATE;
  document.getElementById('btn-rotate').textContent = ROTATE ? '⏸ 정지' : '자동 회전';
  if (ROTATE) {
    const tick = () => {
      _viewState = { ..._viewState, bearing: _viewState.bearing + 0.2 };
      DECK.setProps({ viewState: _viewState });
      if (ROTATE) _rotateRAF = requestAnimationFrame(tick);
    };
    tick();
  } else if (_rotateRAF) {
    cancelAnimationFrame(_rotateRAF);
  }
}

document.addEventListener('DOMContentLoaded', init);
