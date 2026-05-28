// 공통 유틸: 토스트, 해시 라우팅, 다운로드, AI 인사이트, 리빌 옵저버

/* ── Toast ─────────────────────────────────────────── */
function toast(msg, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── Hash routing ───────────────────────────────────── */
function parseHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return {};
  const out = {};
  h.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return out;
}
function setHash(params) {
  const h = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  history.replaceState(null, '', h ? `#${h}` : location.pathname);
}

/* ── Download CSV/JSON ──────────────────────────────── */
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${filename} 다운로드`);
}

function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = v => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}

function panelDownloadButton(panel, label, getFn) {
  const tb = panel.querySelector('.panel-toolbar') || (() => {
    const e = document.createElement('div'); e.className = 'panel-toolbar';
    panel.style.position = 'relative';
    panel.appendChild(e); return e;
  })();
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = `${label} 다운로드`;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  btn.addEventListener('click', () => {
    const { name, csv, json } = getFn();
    if (csv) downloadBlob(csv, `${name}.csv`, 'text/csv;charset=utf-8');
    else if (json) downloadBlob(json, `${name}.json`, 'application/json;charset=utf-8');
  });
  tb.appendChild(btn);
}

/* ── Reveal on scroll ───────────────────────────────── */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  // 첫 화면(뷰포트 안)에 있는 패널은 즉시 show — 공란 사고 방지의 1차 보호망
  requestAnimationFrame(() => {
    els.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        el.classList.add('show');
      }
    });
  });

  // 스크롤 시 나머지를 점진적으로 show
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('show');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.02, rootMargin: '0px 0px -5% 0px' });
  els.forEach(el => { if (!el.classList.contains('show')) io.observe(el); });

  // 2차 보호망: 0.8초 후 그래도 안 보인 거 강제 show
  setTimeout(() => {
    document.querySelectorAll('.reveal:not(.show)').forEach(el => el.classList.add('show'));
  }, 800);
}

/* ── Loader ─────────────────────────────────────────── */
function showLoader() {
  let l = document.getElementById('loader');
  if (l) return;
  l = document.createElement('div');
  l.id = 'loader';
  l.innerHTML = `<div class="loader-ring"></div><div class="loader-text">데이터 로딩 중</div>`;
  document.body.appendChild(l);
}
function hideLoader() {
  const l = document.getElementById('loader');
  if (l) {
    l.classList.add('done');
    setTimeout(() => l.remove(), 500);
  }
}

/* ── AI insights generator (template-based) ─────────── */
function aiInsight(sido, opts = {}) {
  if (!sido || !DATA?.closure) return '시도를 선택하면 분석이 표시됩니다.';
  const c = DATA.closure;
  const total = c.totals[sido] || 0;
  const yearly = c.yearly[sido];
  const recent5 = yearly.slice(-5).reduce((a, b) => a + b, 0);
  const prev5 = yearly.slice(-10, -5).reduce((a, b) => a + b, 0);
  const accel = prev5 > 0 ? Math.round(((recent5 - prev5) / prev5) * 100) : 0;
  const peakIdx = yearly.indexOf(Math.max(...yearly));
  const peakYear = c.years[peakIdx];
  const peakVal = yearly[peakIdx];
  const rank = [...c.sido]
    .sort((a, b) => (c.totals[b] || 0) - (c.totals[a] || 0))
    .indexOf(sido) + 1;
  const nationalShare = ((total / c.meta.total) * 100).toFixed(1);

  // 인구 데이터
  let popLine = '';
  if (DATA.population) {
    const popChange = DATA.population.change_pct[sido];
    if (popChange !== null && popChange !== undefined) {
      const dir = popChange > 0 ? '증가' : '감소';
      popLine = ` 같은 시기 시도 인구는 <strong>${popChange > 0 ? '+' : ''}${popChange.toFixed(1)}%</strong> ${dir}.`;
    }
  }

  // 매물 데이터 (있으면)
  let listingLine = '';
  if (DATA.listings) {
    const inSido = DATA.listings.records.filter(r => r.sido === sido);
    if (inSido.length) {
      const reusable = inSido.filter(r => /매각|대부|미활용/.test(r.usage_status || '')).length;
      listingLine = ` 폐교재산 공개 ${inSido.length}건 중 활용·매각 가능 후보 약 ${reusable}건.`;
    }
  }

  // 가속/둔화 해석
  const accelText = accel > 30
    ? `최근 5년 폐교가 직전 5년 대비 <strong>${accel}% 증가</strong> — 가속 신호`
    : accel > 0
    ? `최근 5년이 직전 5년보다 다소 증가 (<strong>+${accel}%</strong>)`
    : accel < -30
    ? `최근 5년 폐교가 <strong>${Math.abs(accel)}% 감소</strong> — 완화 국면`
    : `최근 5년 폐교 흐름이 비교적 안정 (<strong>${accel}%</strong>)`;

  return `
    <span class="ai-label">AI 분석</span>
    <strong>${sido}</strong>는 누적 폐교 <strong>${total}교</strong>로 전국 ${rank}위(전체의 ${nationalShare}%)입니다.
    가장 많이 닫은 해는 <strong>${peakYear}년 ${peakVal}교</strong>.
    ${accelText}.${popLine}${listingLine}
    <span class="citation">출처: 학교알리미(폐교)·KOSIS DT_1B040A3(인구)·시도교육청 폐교재산(매물). 룰베이스 자동 생성.</span>
  `;
}
