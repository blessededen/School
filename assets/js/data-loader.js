// 공통 데이터 로더 — 모든 페이지에서 재사용
const DATA = {};

async function loadAll() {
  if (DATA._loaded) return DATA;
  const base = window.DATA_BASE || 'assets/data';
  const [closure, teacher, summary, geo, population] = await Promise.all([
    fetch(`${base}/closure.json`).then(r => r.json()),
    fetch(`${base}/teacher.json`).then(r => r.json()),
    fetch(`${base}/summary.json`).then(r => r.json()),
    fetch(`${base}/geo.json`).then(r => r.json()),
    fetch(`${base}/population.json`).then(r => r.json()),
  ]);
  DATA.closure = closure;
  DATA.teacher = teacher;
  DATA.summary = summary;
  DATA.geo = geo;
  DATA.population = population;
  DATA._loaded = true;
  return DATA;
}

// 시도 누적 폐교 → 색상 (퀀타일 기반 단색 스케일)
function closureColor(value, max) {
  if (!value) return '#1a2038';
  const t = Math.min(1, Math.log(value + 1) / Math.log(max + 1));
  // teal → magenta gradient
  const r = Math.round(77 + (255 - 77) * t);
  const g = Math.round(208 - (208 - 107) * t);
  const b = Math.round(225 - (225 - 138) * t);
  return `rgb(${r},${g},${b})`;
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ko-KR');
}

function animateNumber(el, target, duration = 1200) {
  const start = 0;
  const startTime = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(start + (target - start) * ease).toLocaleString('ko-KR');
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
