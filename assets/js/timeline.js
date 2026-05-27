// 시계열 페이지
const PLOT_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Pretendard, Malgun Gothic, sans-serif', color: '#e4e8f2', size: 12 },
  margin: { l: 50, r: 20, t: 20, b: 50 },
  xaxis: { gridcolor: '#243049', zerolinecolor: '#243049' },
  yaxis: { gridcolor: '#243049', zerolinecolor: '#243049' },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 11 } },
  hoverlabel: { bgcolor: '#131829', bordercolor: '#4dd0e1', font: { color: '#e4e8f2' } },
};

const PLOT_CONFIG = { displayModeBar: false, responsive: true };

const SIDO_COLORS = {
  '경북': '#ff6b8a', '경남': '#ffd166', '강원': '#4dd0e1', '전남': '#a3d977',
  '충북': '#b39ddb', '경기': '#90caf9', '전북': '#ffab91', '충남': '#ce93d8',
  '제주': '#80cbc4', '대구': '#f48fb1', '부산': '#ffcc80', '인천': '#9fa8da',
  '울산': '#bcaaa4', '광주': '#80deea', '서울': '#aed581', '대전': '#ffe082', '세종': '#e0e0e0',
};

let SELECTED = new Set(['경북', '경남', '강원']);

async function init() {
  await loadAll();
  hideLoader();
  initReveal();

  drawNational();
  drawSidoAll();
  buildChips();
  drawCompare();

  document.getElementById('sel-mode').addEventListener('change', () => {
    drawSidoAll();
    drawCompare();
  });
  document.getElementById('btn-toggle-all').addEventListener('click', toggleAll);

  // 다운로드 버튼
  const panels = document.querySelectorAll('.panel');
  panelDownloadButton(panels[0], '전국 시계열 CSV', () => {
    const rows = Object.entries(DATA.closure.national_yearly)
      .map(([y, v]) => ({ year: +y, closures: v }))
      .sort((a, b) => a.year - b.year);
    return { name: 'national_yearly', csv: toCSV(rows) };
  });
  panelDownloadButton(panels[1], '시도별 패널 CSV', () => {
    const c = DATA.closure;
    const rows = [];
    c.sido.forEach(s => c.years.forEach((y, yi) =>
      rows.push({ sido: s, year: y, yearly: c.yearly[s][yi], cumulative: c.cumulative[s][yi] })
    ));
    return { name: 'sido_panel', csv: toCSV(rows) };
  });
  panelDownloadButton(panels[2], '선택 비교 CSV', () => {
    const c = DATA.closure;
    const sel = [...SELECTED];
    const rows = [];
    sel.forEach(s => c.years.forEach((y, yi) =>
      rows.push({ sido: s, year: y, value: getSeries(s, document.getElementById('sel-mode').value)[yi] })
    ));
    return { name: 'selected_comparison', csv: toCSV(rows) };
  });
}

function drawNational() {
  const c = DATA.closure;
  const years = Object.keys(c.national_yearly).map(Number).sort();
  const vals = years.map(y => c.national_yearly[y]);

  const trace = {
    x: years, y: vals,
    type: 'bar',
    marker: {
      color: vals.map(v => v >= 100 ? '#ff6b8a' : v >= 30 ? '#ffd166' : '#4dd0e1'),
    },
    hovertemplate: '<b>%{x}년</b><br>%{y}교 폐교<extra></extra>',
  };

  // 1999 정점 annotation
  const peakIdx = vals.indexOf(Math.max(...vals));
  const layout = {
    ...PLOT_LAYOUT,
    annotations: [{
      x: years[peakIdx], y: vals[peakIdx],
      text: `${years[peakIdx]} · ${vals[peakIdx]}교<br>정책 충격`,
      arrowcolor: '#ff6b8a', font: { color: '#ff6b8a' },
      ax: 60, ay: -40,
    }],
  };

  Plotly.newPlot('chart-national', [trace], layout, PLOT_CONFIG);
}

function getSeries(sido, mode) {
  const c = DATA.closure;
  if (mode === 'cumulative') return c.cumulative[sido];
  if (mode === 'yearly') return c.yearly[sido];
  if (mode === 'ma5') {
    const y = c.yearly[sido];
    return y.map((_, i) => {
      const slice = y.slice(Math.max(0, i - 4), i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }
}

function drawSidoAll() {
  const c = DATA.closure;
  const mode = document.getElementById('sel-mode').value;
  const traces = c.sido.map(s => ({
    x: c.years,
    y: getSeries(s, mode),
    type: 'scatter', mode: 'lines',
    name: s,
    line: { color: SIDO_COLORS[s] || '#666', width: ['경북', '경남', '강원'].includes(s) ? 2.5 : 1 },
    opacity: ['경북', '경남', '강원'].includes(s) ? 1 : 0.5,
    hovertemplate: `<b>${s}</b> %{x}년<br>%{y:.1f}교<extra></extra>`,
  }));
  Plotly.newPlot('chart-sido', traces, PLOT_LAYOUT, PLOT_CONFIG);
}

function buildChips() {
  const host = document.getElementById('sido-chips');
  host.innerHTML = DATA.closure.sido.map(s => `
    <button data-sido="${s}" class="chip-btn ${SELECTED.has(s) ? 'on' : ''}"
            style="background:${SELECTED.has(s) ? (SIDO_COLORS[s] || '#4dd0e1') : 'var(--bg-elev-2)'};
                   color:${SELECTED.has(s) ? '#0a0e1a' : 'var(--text)'};
                   border:1px solid var(--line); padding:6px 12px;
                   border-radius:99px; font-size:12px; cursor:pointer; font-weight:600;">
      ${s}
    </button>
  `).join('');
  host.querySelectorAll('.chip-btn').forEach(b => {
    b.addEventListener('click', () => {
      const s = b.dataset.sido;
      if (SELECTED.has(s)) SELECTED.delete(s); else SELECTED.add(s);
      buildChips();
      drawCompare();
    });
  });
}

function drawCompare() {
  const c = DATA.closure;
  const mode = document.getElementById('sel-mode').value;
  const sel = [...SELECTED];
  const traces = sel.map(s => ({
    x: c.years,
    y: getSeries(s, mode),
    type: 'scatter', mode: 'lines+markers',
    name: s,
    line: { color: SIDO_COLORS[s] || '#666', width: 2.5 },
    marker: { size: 4 },
    hovertemplate: `<b>${s}</b> %{x}년<br>%{y:.1f}교<extra></extra>`,
  }));
  Plotly.newPlot('chart-compare', traces, PLOT_LAYOUT, PLOT_CONFIG);
}

let _allOn = false;
function toggleAll() {
  if (_allOn) {
    SELECTED = new Set(['경북', '경남', '강원']);
  } else {
    SELECTED = new Set(DATA.closure.sido);
  }
  _allOn = !_allOn;
  buildChips();
  drawCompare();
}

document.addEventListener('DOMContentLoaded', init);
