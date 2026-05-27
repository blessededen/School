// 폐교 vs 인구 vs 교원 비교
const LAYOUT_DARK = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Pretendard, Malgun Gothic, sans-serif', color: '#e8edf7', size: 12 },
  margin: { l: 60, r: 60, t: 30, b: 50 },
  xaxis: { gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)' },
  yaxis: { gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)' },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 11 }, orientation: 'h', y: 1.15 },
  hoverlabel: { bgcolor: 'rgba(6,9,15,0.95)', bordercolor: '#5eead4', font: { color: '#e8edf7' } },
};
const CONFIG = { displayModeBar: false, responsive: true };

let SELECTED_SIDO = '경북';

async function init() {
  await loadAll();
  hideLoader();
  initReveal();

  // 해시에서 시도 복원
  const params = parseHash();
  if (params.sido && DATA.closure.sido.includes(params.sido)) {
    SELECTED_SIDO = params.sido;
  }

  buildChips();
  drawDual();
  drawScatter();
  drawDensity();
  updateInsight();
  attachDownloads();

  mountChat(document.getElementById('chat-panel'), () => SELECTED_SIDO);
}

function buildChips() {
  const host = document.getElementById('sido-chips');
  host.innerHTML = DATA.closure.sido.map(s => `
    <button data-sido="${s}" class="chip-btn ${s === SELECTED_SIDO ? 'on' : ''}">${s}</button>
  `).join('');
  host.querySelectorAll('.chip-btn').forEach(b => {
    b.addEventListener('click', () => {
      SELECTED_SIDO = b.dataset.sido;
      buildChips();
      drawDual();
      updateInsight();
      setHash({ sido: SELECTED_SIDO });
      document.dispatchEvent(new Event('sido-focus-changed'));
    });
  });
}

function drawDual() {
  try {
    const c = DATA.closure;
    const t = DATA.teacher;
    const p = DATA.population;
    const sido = SELECTED_SIDO;

    const years = p.years;
    const closeArr = years.map(y => {
      const yi = c.years.indexOf(y);
      return yi >= 0 ? c.yearly[sido][yi] : 0;
    });
    const popArr = p.population[sido] || [];
    const hires = years.map(y => {
      const ti = t.years.indexOf(y);
      return ti >= 0 ? t.new_hires[sido][ti] : null;
    });

    // 3개 서브플롯 — 각자 독립 Y축. 오버레이 트릭 안 씀 → 안전
    const traces = [
      {
        x: years, y: closeArr,
        name: '폐교(연간)', type: 'bar',
        marker: { color: 'rgba(255,107,157,0.75)' },
        xaxis: 'x', yaxis: 'y',
        hovertemplate: '<b>%{x}년</b> 폐교 %{y}교<extra></extra>',
      },
      {
        x: years, y: popArr,
        name: '인구 (KOSIS 실데이터)', type: 'scatter', mode: 'lines+markers',
        line: { color: '#5eead4', width: 3, shape: 'spline' },
        marker: { size: 6, color: '#5eead4' },
        fill: 'tozeroy', fillcolor: 'rgba(94,234,212,0.08)',
        xaxis: 'x2', yaxis: 'y2',
        hovertemplate: '<b>%{x}년</b> 인구 %{y:,}명<extra></extra>',
      },
      {
        x: years, y: hires,
        name: '신규 임용 (추정)', type: 'scatter', mode: 'lines+markers',
        line: { color: '#ffd166', width: 2, dash: 'dot' },
        marker: { size: 5, color: '#ffd166' },
        xaxis: 'x3', yaxis: 'y3',
        hovertemplate: '<b>%{x}년</b> 임용 %{y}명<extra></extra>',
      },
    ];

    const layout = {
      ...LAYOUT_DARK,
      title: { text: `${sido}`, font: { size: 14, color: '#5eead4' }, x: 0.02 },
      grid: { rows: 3, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
      xaxis:  { ...LAYOUT_DARK.xaxis, matches: 'x3', showticklabels: false },
      xaxis2: { ...LAYOUT_DARK.xaxis, matches: 'x3', showticklabels: false },
      xaxis3: { ...LAYOUT_DARK.xaxis },
      yaxis:  { ...LAYOUT_DARK.yaxis, title: { text: '폐교', font: { color: '#ff6b9d', size: 11 } } },
      yaxis2: { ...LAYOUT_DARK.yaxis, title: { text: '인구', font: { color: '#5eead4', size: 11 } } },
      yaxis3: { ...LAYOUT_DARK.yaxis, title: { text: '임용(추정)', font: { color: '#ffd166', size: 11 } } },
      margin: { l: 70, r: 20, t: 36, b: 40 },
    };

    Plotly.newPlot('chart-dual', traces, layout, CONFIG);
  } catch (e) {
    console.error('drawDual failed:', e);
    const el = document.getElementById('chart-dual');
    if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-faint);">차트 렌더링 실패: ${e.message}</div>`;
  }
}

function drawScatter() {
  try { _drawScatter(); }
  catch (e) {
    console.error('drawScatter failed:', e);
    const el = document.getElementById('chart-scatter');
    if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-faint);">${e.message}</div>`;
  }
}
function _drawScatter() {
  const c = DATA.closure;
  const p = DATA.population;
  const points = c.sido.map(s => {
    const recent5 = c.yearly[s].slice(-5).reduce((a, b) => a + b, 0);
    const popChange = p.change_pct[s];
    return { sido: s, x: recent5, y: popChange ?? 0, size: c.totals[s] };
  });

  const trace = {
    x: points.map(p => p.x),
    y: points.map(p => p.y),
    text: points.map(p => p.sido),
    mode: 'markers+text',
    type: 'scatter',
    textposition: 'top center',
    textfont: { size: 11, color: '#e8edf7' },
    marker: {
      size: points.map(p => Math.max(10, Math.sqrt(p.size) * 2.5)),
      color: points.map(p => p.y),
      colorscale: [[0, '#ff6b9d'], [0.5, '#ffd166'], [1, '#5eead4']],
      showscale: true,
      colorbar: { title: '인구변화%', tickfont: { color: '#e8edf7' }, len: 0.6 },
      line: { color: '#06090f', width: 1.5 },
      opacity: 0.92,
    },
    hovertemplate: '<b>%{text}</b><br>최근5년 폐교 %{x}교<br>인구변화 %{y:.1f}%<extra></extra>',
  };

  const layout = {
    ...LAYOUT_DARK,
    xaxis: { ...LAYOUT_DARK.xaxis, title: '2020–2024 폐교 합계 (교)' },
    yaxis: { ...LAYOUT_DARK.yaxis, title: '인구 변화율 (%) 2016→2025', zeroline: true, zerolinecolor: 'rgba(255,255,255,0.2)' },
  };

  Plotly.newPlot('chart-scatter', [trace], layout, CONFIG);
}

function drawDensity() {
  try { _drawDensity(); }
  catch (e) {
    console.error('drawDensity failed:', e);
    const el = document.getElementById('chart-density');
    if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-faint);">${e.message}</div>`;
  }
}
function _drawDensity() {
  const c = DATA.closure;
  const p = DATA.population;
  const rows = c.sido.map(s => {
    const pop = p.population[s]?.[p.population[s].length - 1] || 1;
    const density = (c.totals[s] / pop) * 10000;
    return { sido: s, value: density, pop, total: c.totals[s] };
  }).sort((a, b) => b.value - a.value);

  const trace = {
    x: rows.map(r => r.value),
    y: rows.map(r => r.sido),
    type: 'bar', orientation: 'h',
    marker: {
      color: rows.map(r => r.value),
      colorscale: [[0, '#5eead4'], [0.5, '#ffd166'], [1, '#ff6b9d']],
      line: { color: 'rgba(0,0,0,0.3)', width: 0.5 },
    },
    text: rows.map(r => `${r.value.toFixed(2)}`),
    textposition: 'outside',
    textfont: { color: '#8893ad', size: 11 },
    hovertemplate: '<b>%{y}</b><br>인구 1만명당 %{x:.2f}교<br>누적 %{customdata[0]}교 / 인구 %{customdata[1]:,}명<extra></extra>',
    customdata: rows.map(r => [r.total, r.pop]),
  };

  const layout = {
    ...LAYOUT_DARK,
    margin: { l: 60, r: 60, t: 20, b: 50 },
    xaxis: { ...LAYOUT_DARK.xaxis, title: '인구 1만명당 누적 폐교' },
    yaxis: { ...LAYOUT_DARK.yaxis, autorange: 'reversed' },
  };

  Plotly.newPlot('chart-density', [trace], layout, CONFIG);
}

function updateInsight() {
  document.getElementById('insight-panel').innerHTML = aiInsight(SELECTED_SIDO);
}

function attachDownloads() {
  const panels = document.querySelectorAll('.panel');
  // dual
  panelDownloadButton(panels[1], '듀얼 시계열 CSV', () => {
    const c = DATA.closure, p = DATA.population, t = DATA.teacher;
    const rows = p.years.map(y => {
      const yi = c.years.indexOf(y), ti = t.years.indexOf(y);
      return {
        year: y, sido: SELECTED_SIDO,
        closures: yi >= 0 ? c.yearly[SELECTED_SIDO][yi] : 0,
        population: p.population[SELECTED_SIDO][p.years.indexOf(y)],
        new_hires_est: ti >= 0 ? t.new_hires[SELECTED_SIDO][ti] : null,
      };
    });
    return { name: `dual_${SELECTED_SIDO}`, csv: toCSV(rows) };
  });
  // scatter
  panelDownloadButton(panels[2], '산점도 CSV', () => {
    const c = DATA.closure, p = DATA.population;
    const rows = c.sido.map(s => ({
      sido: s,
      recent5y_closures: c.yearly[s].slice(-5).reduce((a, b) => a + b, 0),
      pop_change_pct: p.change_pct[s],
      total_cumulative: c.totals[s],
    }));
    return { name: 'scatter_acceleration', csv: toCSV(rows) };
  });
  // density
  panelDownloadButton(panels[3], '인구밀도 CSV', () => {
    const c = DATA.closure, p = DATA.population;
    const rows = c.sido.map(s => {
      const pop = p.population[s]?.[p.population[s].length - 1] || 0;
      return {
        sido: s,
        cumulative: c.totals[s],
        population_2025: pop,
        per_10k: pop ? (c.totals[s] / pop) * 10000 : null,
      };
    });
    return { name: 'closures_per_10k', csv: toCSV(rows) };
  });
}

document.addEventListener('DOMContentLoaded', init);
