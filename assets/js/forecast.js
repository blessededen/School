// 예측 시뮬레이터 — TensorFlow.js 다항회귀 + 시나리오 프리셋
const F_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Pretendard, Malgun Gothic, sans-serif', color: '#e8edf7', size: 12 },
  margin: { l: 50, r: 20, t: 20, b: 50 },
  xaxis: { gridcolor: 'rgba(255,255,255,0.06)' },
  yaxis: { gridcolor: 'rgba(255,255,255,0.06)', title: '연간 폐교 수' },
  legend: { bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: 1.12 },
  hoverlabel: { bgcolor: 'rgba(6,9,15,0.95)', bordercolor: '#5eead4', font: { color: '#e8edf7' } },
};
const F_CONFIG = { displayModeBar: false, responsive: true };

const PRESETS = {
  worst: { slope: 1.3, policy: 20, demo: 1.4, label: '최악' },
  base:  { slope: 1.0, policy: 0,  demo: 1.0, label: '현 추세' },
  best:  { slope: 0.7, policy: -15, demo: 0.85, label: '회복' },
};

let MODEL = { weights: null, sido: null };
let CURRENT_PRESET = 'base';

async function init() {
  await loadAll();
  hideLoader();
  initReveal();

  const params = parseHash();
  const initialSido = (params.sido && DATA.closure.sido.includes(params.sido)) ? params.sido : '경북';

  const sel = document.getElementById('sel-sido');
  sel.innerHTML = DATA.closure.sido.map(s => `<option value="${s}">${s}</option>`).join('');
  sel.value = initialSido;
  sel.addEventListener('change', () => {
    setHash({ sido: sel.value });
    trainAndDraw();
  });

  // 시나리오 프리셋 버튼
  document.querySelectorAll('.preset-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_PRESET = preset;
      applyPreset(preset);
      draw();
    });
  });

  // 고급 토글
  document.getElementById('adv-toggle').addEventListener('click', () => {
    const p = document.getElementById('adv-panel');
    const t = document.getElementById('adv-toggle');
    p.classList.toggle('show');
    t.firstElementChild.textContent = p.classList.contains('show') ? '▼' : '▶';
  });

  // 슬라이더 (수동 조절 시 프리셋 active 해제)
  ['sl-slope', 'sl-policy', 'sl-demo'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      updateLabels();
      document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
      CURRENT_PRESET = 'custom';
    });
    document.getElementById(id).addEventListener('change', draw);
  });

  applyPreset('base');
  updateLabels();
  await trainAndDraw();

  panelDownloadButton(document.querySelectorAll('.panel')[1], '예측 결과 CSV', () => {
    return { name: `forecast_${MODEL.sido}_${CURRENT_PRESET}`, csv: lastForecastCSV() };
  });
}

function applyPreset(name) {
  const p = PRESETS[name] || PRESETS.base;
  document.getElementById('sl-slope').value = p.slope;
  document.getElementById('sl-policy').value = p.policy;
  document.getElementById('sl-demo').value = p.demo;
  updateLabels();
}

function updateLabels() {
  document.getElementById('val-slope').textContent = `×${(+document.getElementById('sl-slope').value).toFixed(2)}`;
  const pol = +document.getElementById('sl-policy').value;
  document.getElementById('val-policy').textContent = `${pol >= 0 ? '+' : ''}${pol}교`;
  const d = +document.getElementById('sl-demo').value;
  document.getElementById('val-demo').textContent = d < 0.9 ? '완화' : d > 1.1 ? '가속' : '기본';
}

async function trainAndDraw() {
  const sido = document.getElementById('sel-sido').value;
  const c = DATA.closure;

  const trainStart = 2002;
  const startIdx = c.years.indexOf(trainStart);
  const xs = c.years.slice(startIdx).map((y, i) => i);
  const ys = c.yearly[sido].slice(startIdx);

  const status = document.getElementById('model-status');
  status.textContent = '학습 시작 (다항회귀 deg 2, 600 epoch)';

  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const xStd = Math.sqrt(xs.reduce((a, b) => a + (b - xMean) ** 2, 0) / xs.length);
  const xN = xs.map(x => (x - xMean) / xStd);

  const xTensor = tf.tensor2d(xN.map(x => [1, x, x * x]));
  const yTensor = tf.tensor1d(ys);

  const w = tf.variable(tf.randomNormal([3]));
  const optim = tf.train.adam(0.05);

  for (let e = 0; e < 600; e++) {
    optim.minimize(() => {
      const pred = xTensor.matMul(w.reshape([3, 1])).squeeze();
      return pred.sub(yTensor).square().mean();
    });
  }

  const weights = await w.data();
  MODEL = { weights: Array.from(weights), sido, xMean, xStd, startIdx, trainStart };

  xTensor.dispose(); yTensor.dispose(); w.dispose();

  status.innerHTML = `<strong style="color:var(--accent)">학습 완료</strong> · ${sido}<br>
    weights: [${MODEL.weights.map(v => v.toFixed(2)).join(', ')}]<br>
    학습 구간: ${trainStart}–2024 (${xs.length} obs)`;

  draw();
}

let LAST_FORECAST = null;

function draw() {
  if (!MODEL.weights) return;
  const c = DATA.closure;
  const sido = MODEL.sido;

  const slope = +document.getElementById('sl-slope').value;
  const policy = +document.getElementById('sl-policy').value;
  const demo = +document.getElementById('sl-demo').value;

  const futureYears = [];
  for (let y = 2025; y <= 2035; y++) futureYears.push(y);

  const [w0, w1, w2] = MODEL.weights;

  const baseFuture = futureYears.map(y => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    return Math.max(0, w0 + w1 * t + w2 * t * t);
  });
  const adjFuture = futureYears.map(y => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    return Math.max(0, w0 + w1 * t * slope + w2 * t * t * demo + policy);
  });

  const histYears = c.years.slice(MODEL.startIdx);
  const histVals = c.yearly[sido].slice(MODEL.startIdx);
  const fitVals = histYears.map(y => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    return Math.max(0, w0 + w1 * t + w2 * t * t);
  });

  const upper = adjFuture.map(v => v * 1.3);
  const lower = adjFuture.map(v => Math.max(0, v * 0.7));

  const traces = [
    {
      x: c.years, y: c.yearly[sido],
      name: '실측', type: 'bar',
      marker: { color: 'rgba(200,210,230,0.35)' },
      hovertemplate: '<b>%{x}년</b> 실측 %{y}교<extra></extra>',
    },
    {
      x: histYears, y: fitVals,
      name: '학습 적합선', type: 'scatter', mode: 'lines',
      line: { color: '#ffd166', width: 2, dash: 'dot' },
      hovertemplate: '<b>%{x}년</b> 모델 fit %{y:.1f}<extra></extra>',
    },
    {
      x: [...futureYears, ...futureYears.slice().reverse()],
      y: [...upper, ...lower.slice().reverse()],
      fill: 'toself', fillcolor: 'rgba(255,107,157,0.18)',
      line: { color: 'transparent' },
      name: '±30% 불확실성', hoverinfo: 'skip',
    },
    {
      x: futureYears, y: adjFuture,
      name: `예측 (${PRESETS[CURRENT_PRESET]?.label || '커스텀'})`,
      type: 'scatter', mode: 'lines+markers',
      line: { color: '#ff6b9d', width: 3, shape: 'spline' },
      marker: { size: 7, color: '#ff6b9d', line: { color: '#fff', width: 1.5 } },
      hovertemplate: '<b>%{x}년</b> 예측 %{y:.1f}교<extra></extra>',
    },
  ];

  Plotly.newPlot('chart-forecast', traces, F_LAYOUT, F_CONFIG);

  // 요약 카드
  const v2030 = Math.round(adjFuture[futureYears.indexOf(2030)] || 0);
  const vDecade = Math.round(adjFuture.reduce((a, b) => a + b, 0));
  const vTotal = c.totals[sido] + vDecade;

  document.getElementById('sum-2030').textContent = v2030.toLocaleString('ko-KR');
  document.getElementById('sum-decade').textContent = vDecade.toLocaleString('ko-KR');
  document.getElementById('sum-total').textContent = vTotal.toLocaleString('ko-KR');

  LAST_FORECAST = { sido, preset: CURRENT_PRESET, years: futureYears, values: adjFuture };
}

function lastForecastCSV() {
  if (!LAST_FORECAST) return '';
  const rows = LAST_FORECAST.years.map((y, i) => ({
    year: y,
    sido: LAST_FORECAST.sido,
    scenario: LAST_FORECAST.preset,
    predicted_closures: LAST_FORECAST.values[i].toFixed(2),
  }));
  return toCSV(rows);
}

document.addEventListener('DOMContentLoaded', init);
