// 예측 시뮬레이터 — TensorFlow.js 다항회귀
const F_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Pretendard, Malgun Gothic, sans-serif', color: '#e4e8f2', size: 12 },
  margin: { l: 50, r: 20, t: 20, b: 50 },
  xaxis: { gridcolor: '#243049' },
  yaxis: { gridcolor: '#243049', title: '연간 폐교 수' },
  legend: { bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: 1.12 },
  hoverlabel: { bgcolor: '#131829', bordercolor: '#4dd0e1', font: { color: '#e4e8f2' } },
};
const F_CONFIG = { displayModeBar: false, responsive: true };

let MODEL = { weights: null, sido: null };

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

  document.getElementById('sl-slope').addEventListener('input', updateLabels);
  document.getElementById('sl-policy').addEventListener('input', updateLabels);
  document.getElementById('sl-demo').addEventListener('input', updateLabels);
  document.getElementById('sl-slope').addEventListener('change', draw);
  document.getElementById('sl-policy').addEventListener('change', draw);
  document.getElementById('sl-demo').addEventListener('change', draw);

  document.getElementById('btn-retrain').addEventListener('click', trainAndDraw);

  updateLabels();
  await trainAndDraw();
}

function updateLabels() {
  document.getElementById('val-slope').textContent = `×${(+document.getElementById('sl-slope').value).toFixed(2)}`;
  document.getElementById('val-policy').textContent = `${document.getElementById('sl-policy').value}교`;
  const d = +document.getElementById('sl-demo').value;
  document.getElementById('val-demo').textContent = d < 0.9 ? '완화' : d > 1.1 ? '가속' : '기본';
}

async function trainAndDraw() {
  const sido = document.getElementById('sel-sido').value;
  const c = DATA.closure;

  // 2002년 이후 학습 (1차 파동 제외)
  const trainStart = 2002;
  const startIdx = c.years.indexOf(trainStart);
  const xs = c.years.slice(startIdx).map((y, i) => i);
  const ys = c.yearly[sido].slice(startIdx);

  const status = document.getElementById('model-status');
  status.textContent = '학습 시작... 다항회귀 (degree 2), epochs=600';

  // 정규화
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
      const loss = pred.sub(yTensor).square().mean();
      return loss;
    });
  }

  const weights = await w.data();
  MODEL = { weights: Array.from(weights), sido, xMean, xStd, startIdx, trainStart };

  xTensor.dispose(); yTensor.dispose(); w.dispose();

  status.innerHTML = `학습 완료 · ${sido}<br>
    가중치: [${MODEL.weights.map(v => v.toFixed(3)).join(', ')}]<br>
    학습 구간: ${trainStart}–${c.years[c.years.length - 1]} (${xs.length}개 관측)`;

  draw();
}

function draw() {
  if (!MODEL.weights) return;
  const c = DATA.closure;
  const sido = MODEL.sido;

  const slope = +document.getElementById('sl-slope').value;
  const policy = +document.getElementById('sl-policy').value;
  const demo = +document.getElementById('sl-demo').value;

  // 예측 구간
  const futureYears = [];
  for (let y = 2025; y <= 2035; y++) futureYears.push(y);

  const [w0, w1, w2] = MODEL.weights;
  const futureN = futureYears.map(y => {
    const x = c.years.indexOf(MODEL.trainStart) === -1 ? 0
              : (c.years.indexOf(y === 2025 ? 2024 : y) >= 0
                  ? c.years.indexOf(y) - MODEL.startIdx
                  : (y - MODEL.trainStart));
    return (x - MODEL.xMean) / MODEL.xStd;
  });

  // 단순화: 정규화된 t = (y - trainStart - xMean) / xStd
  const baseFuture = futureYears.map(y => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    return w0 + w1 * t + w2 * t * t;
  });

  // 슬라이더 적용: slope는 트렌드 기울기 배율, demo는 2차항 배율, policy는 절대값 더하기
  const adjFuture = futureYears.map((y, i) => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    const base = w0 + w1 * t * slope + w2 * t * t * demo;
    return Math.max(0, base + policy);
  });

  // 학습 fit (히스토리 위)
  const histYears = c.years.slice(MODEL.startIdx);
  const histVals = c.yearly[sido].slice(MODEL.startIdx);
  const fitVals = histYears.map(y => {
    const t = ((y - MODEL.trainStart) - MODEL.xMean) / MODEL.xStd;
    return w0 + w1 * t + w2 * t * t;
  });

  // 신뢰 밴드 (간단한 ±20% range)
  const upper = adjFuture.map(v => v * 1.3);
  const lower = adjFuture.map(v => Math.max(0, v * 0.7));

  const traces = [
    {
      x: c.years, y: c.yearly[sido],
      name: '실측', type: 'bar',
      marker: { color: 'rgba(77,208,225,0.4)' },
      hovertemplate: '<b>%{x}년</b> %{y}교<extra></extra>',
    },
    {
      x: histYears, y: fitVals,
      name: '모델 적합', type: 'scatter', mode: 'lines',
      line: { color: '#ffd166', width: 2, dash: 'dot' },
    },
    {
      x: [...futureYears, ...futureYears.slice().reverse()],
      y: [...upper, ...lower.slice().reverse()],
      fill: 'toself', fillcolor: 'rgba(255,107,138,0.15)',
      line: { color: 'transparent' },
      name: '시나리오 밴드', hoverinfo: 'skip',
      showlegend: true,
    },
    {
      x: futureYears, y: adjFuture,
      name: '예측 (사용자 시나리오)', type: 'scatter', mode: 'lines+markers',
      line: { color: '#ff6b8a', width: 3 }, marker: { size: 6 },
      hovertemplate: '<b>%{x}년</b> %{y:.1f}교 예측<extra></extra>',
    },
  ];

  Plotly.newPlot('chart-forecast', traces, F_LAYOUT, F_CONFIG);

  // 요약
  const sum2030 = Math.round(adjFuture[futureYears.indexOf(2030)] || 0);
  const sumNext10 = Math.round(adjFuture.reduce((a, b) => a + b, 0));
  const cumNow = c.totals[sido];
  document.getElementById('forecast-summary').innerHTML = `
    <strong>${sido}</strong> 2030년 예측 폐교: <strong style="color:var(--accent-2);font-size:18px;">${sum2030}</strong>교/년 ·
    2025–2035 누적: <strong style="color:var(--accent-2);font-size:18px;">${sumNext10}</strong>교 ·
    누적 합계는 <strong>${cumNow + sumNext10}</strong>교로 증가
  `;
}

document.addEventListener('DOMContentLoaded', init);
