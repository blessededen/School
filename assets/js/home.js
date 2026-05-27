// 홈 — 지도 + 사이드 + 슬라이더 + 검색 + AI + 다운로드 + 해시 라우팅
async function initHome() {
  await loadAll();
  hideLoader();
  initReveal();

  // KPI
  const s = DATA.summary;
  animateNumber(document.getElementById('kpi-total'), s.total_closures);
  document.getElementById('kpi-period').textContent = `${s.year_range[0]}–${s.year_range[1]}`;
  animateNumber(document.getElementById('kpi-peak'), s.peak_value);
  document.getElementById('kpi-peak-year').textContent = `${s.peak_year}년 한 해`;

  if (s.pop_top_drop) {
    document.getElementById('kpi-pop-name').textContent = s.pop_top_drop.sido;
    const pctEl = document.getElementById('kpi-pop-pct');
    pctEl.textContent = s.pop_top_drop.pct.toFixed(1);
  }

  // 해시에서 초기 상태 복원
  const params = parseHash();
  if (params.year) MAP_STATE.year = parseInt(params.year);
  if (params.mode) MAP_STATE.mode = params.mode;
  if (params.sido) MAP_STATE.selectedSido = params.sido;

  // 지도
  buildMap('map');

  // 슬라이더 초기값 반영
  const slider = document.getElementById('year-slider');
  slider.value = MAP_STATE.year;
  document.getElementById('year-display').textContent = MAP_STATE.year;

  // 모드 버튼 active 동기화
  document.getElementById('mode-cum').classList.toggle('active', MAP_STATE.mode === 'cumulative');
  document.getElementById('mode-yr').classList.toggle('active', MAP_STATE.mode === 'yearly');

  // 시도 리스트
  renderSidoList();
  if (MAP_STATE.selectedSido) renderStory(MAP_STATE.selectedSido);

  // 슬라이더
  slider.addEventListener('input', e => {
    const y = parseInt(e.target.value);
    document.getElementById('year-display').textContent = y;
    setYear(y);
    syncHash();
  });

  document.getElementById('mode-cum').addEventListener('click', () => {
    setMode('cumulative');
    document.getElementById('mode-cum').classList.add('active');
    document.getElementById('mode-yr').classList.remove('active');
    renderSidoList();
    syncHash();
  });
  document.getElementById('mode-yr').addEventListener('click', () => {
    setMode('yearly');
    document.getElementById('mode-yr').classList.add('active');
    document.getElementById('mode-cum').classList.remove('active');
    renderSidoList();
    syncHash();
  });

  document.getElementById('play').addEventListener('click', playTimeline);
  document.getElementById('share').addEventListener('click', () => {
    syncHash();
    navigator.clipboard?.writeText(location.href);
    toast('현재 상태 URL이 클립보드에 복사되었습니다');
  });

  // 검색
  document.getElementById('sido-search').addEventListener('input', e => {
    const q = e.target.value.trim();
    const match = DATA.closure.sido.find(s => s.includes(q) || s.startsWith(q));
    if (match && q.length > 0) {
      emitSidoChange(match);
      paintLayer();
      renderSidoList();
      syncHash();
    }
  });

  onSidoChange(sido => {
    renderSidoList();
    renderStory(sido);
    syncHash();
  });

  // 다운로드 버튼
  document.querySelectorAll('.panel').forEach((panel, i) => {
    if (i === 0) {
      panelDownloadButton(panel, '폐교 패널 CSV', () => ({
        name: 'closure_panel',
        csv: panelToCSV(),
      }));
    } else if (i === 1) {
      panelDownloadButton(panel, '시도별 합계 CSV', () => ({
        name: 'closure_totals',
        csv: totalsToCSV(),
      }));
    }
  });
}

function syncHash() {
  setHash({
    sido: MAP_STATE.selectedSido,
    year: MAP_STATE.year,
    mode: MAP_STATE.mode,
  });
}

function panelToCSV() {
  const c = DATA.closure;
  const rows = [];
  c.sido.forEach(s => {
    c.years.forEach((y, yi) => {
      rows.push({ sido: s, year: y, yearly: c.yearly[s][yi], cumulative: c.cumulative[s][yi] });
    });
  });
  return toCSV(rows);
}

function totalsToCSV() {
  const c = DATA.closure;
  const yi = c.years.indexOf(MAP_STATE.year);
  const rows = c.sido.map(s => ({
    sido: s,
    year: MAP_STATE.year,
    cumulative: c.cumulative[s][yi],
    yearly: c.yearly[s][yi],
  }));
  return toCSV(rows);
}

let _playing = null;
function playTimeline() {
  const btn = document.getElementById('play');
  if (_playing) {
    clearInterval(_playing); _playing = null;
    btn.textContent = '▶ 재생';
    return;
  }
  btn.textContent = '⏸ 정지';
  const slider = document.getElementById('year-slider');
  let y = parseInt(slider.value);
  _playing = setInterval(() => {
    y = (y >= 2024) ? 1976 : y + 1;
    slider.value = y;
    slider.dispatchEvent(new Event('input'));
  }, 220);
}

function renderSidoList() {
  const c = DATA.closure;
  const yi = c.years.indexOf(MAP_STATE.year);
  const rows = c.sido.map(s => ({
    sido: s,
    val: MAP_STATE.mode === 'cumulative' ? c.cumulative[s][yi] : c.yearly[s][yi],
  })).sort((a, b) => b.val - a.val);
  const max = Math.max(1, ...rows.map(r => r.val));

  const host = document.getElementById('sido-list');
  host.innerHTML = rows.map(r => `
    <div class="row ${r.sido === MAP_STATE.selectedSido ? 'active' : ''}" data-sido="${r.sido}">
      <span class="name">${r.sido}</span>
      <div class="bar"><div class="fill" style="width:${(r.val / max) * 100}%"></div></div>
      <span class="num">${r.val}</span>
    </div>
  `).join('');

  host.querySelectorAll('.row').forEach(el => {
    el.addEventListener('click', () => {
      emitSidoChange(el.dataset.sido);
      paintLayer();
      renderSidoList();
    });
  });
}

function renderStory(sido) {
  document.getElementById('story').innerHTML = aiInsight(sido);
}

document.addEventListener('DOMContentLoaded', initHome);
