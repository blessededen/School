// 폐교 매물 검색 페이지
const FAV_STORE = 'school_atlas_fav_listings';

let LISTINGS = [];
let FILTERED = [];
let MAP = null, MAP_LAYER = null;
let FILTER = { sido: '', status: '', minArea: 0, q: '', favOnly: false, sort: 'area_desc' };

function getFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_STORE) || '[]')); }
  catch { return new Set(); }
}
function saveFavs(set) { localStorage.setItem(FAV_STORE, JSON.stringify([...set])); }
function listingId(r) { return `${r.sido}|${r.school_name}`; }

// 활용현황 → 카테고리
function statusCat(s) {
  if (!s) return 'etc';
  if (/매각/.test(s)) return 'sale';
  if (/대부|임대/.test(s)) return 'rent';
  if (/미활용|미사용|폐쇄|비어/.test(s)) return 'idle';
  if (/자체|활용|사용|운영|임대중/.test(s)) return 'self';
  return 'etc';
}
const CAT_LABEL = { sale: '매각', rent: '대부', self: '자체활용', idle: '미활용', etc: '기타' };

function fmtArea(a) { return a ? `${a.toLocaleString('ko-KR')}㎡ (${Math.round(a / 3.3058).toLocaleString('ko-KR')}평)` : '—'; }
function fmtPrice(won) {
  if (!won) return null;
  if (won >= 100000000) return `${(won / 100000000).toFixed(1)}억원`;
  return `${Math.round(won / 10000).toLocaleString('ko-KR')}만원`;
}

async function init() {
  try {
    await loadAll();
    await loadListings();
  } catch (e) {
    console.error('데이터 로딩 실패:', e);
    hideLoader();
    document.getElementById('lst-cards').innerHTML =
      `<div style="grid-column:1/-1;padding:60px;text-align:center;color:var(--text-faint);">
        매물 데이터를 불러오지 못했습니다.<br><br>
        <code style="color:var(--accent-2)">${escapeHtmlL(e.message)}</code><br><br>
        로컬에서 <code>file://</code>로 열었다면 <code>python -m http.server</code>로 서버를 띄워 접속하거나,<br>
        배포본이면 <code>assets/data/listings.json</code>이 푸시됐는지 확인하세요.
      </div>`;
    return;
  } finally {
    hideLoader();
  }
  initReveal();

  if (!DATA.listings || !DATA.listings.records) {
    document.getElementById('lst-cards').innerHTML =
      '<div style="grid-column:1/-1;padding:60px;text-align:center;color:var(--text-faint);">listings.json 형식 오류</div>';
    return;
  }
  LISTINGS = DATA.listings.records;

  // KPI
  const cats = LISTINGS.map(r => statusCat(r.usage_status));
  document.getElementById('st-total').textContent = LISTINGS.length;
  document.getElementById('st-sale').textContent = cats.filter(c => c === 'sale').length;
  document.getElementById('st-rent').textContent = cats.filter(c => c === 'rent').length;
  document.getElementById('st-idle').textContent = cats.filter(c => c === 'idle').length;

  // 시도 드롭다운
  const sidos = [...new Set(LISTINGS.map(r => r.sido).filter(Boolean))]
    .sort((a, b) => LISTINGS.filter(r => r.sido === b).length - LISTINGS.filter(r => r.sido === a).length);
  const sel = document.getElementById('f-sido');
  sel.innerHTML = `<option value="">전체 시도</option>` +
    sidos.map(s => `<option value="${s}">${s} (${LISTINGS.filter(r => r.sido === s).length})</option>`).join('');

  // 집값 추세 배지 컨테이너 삽입
  const mapEl = document.getElementById('lst-map');
  const hb = document.createElement('div');
  hb.id = 'housing-badge';
  hb.style.cssText = 'margin-top:12px; padding:12px 14px; background:rgba(0,0,0,0.25); border:1px solid var(--line); border-radius:10px; font-size:12px; color:var(--text-dim); line-height:1.6;';
  hb.innerHTML = '시도를 선택하면 해당 지역 집값 추세가 표시됩니다.';
  mapEl.after(hb);

  buildMap();

  // 해시 복원
  const params = parseHash();
  if (params.sido) { FILTER.sido = params.sido; sel.value = params.sido; }
  if (params.status) { FILTER.status = params.status; document.getElementById('f-status').value = params.status; }

  // 이벤트
  sel.addEventListener('change', e => { FILTER.sido = e.target.value; apply(); });
  document.getElementById('f-status').addEventListener('change', e => { FILTER.status = e.target.value; apply(); });
  document.getElementById('f-area').addEventListener('input', e => {
    FILTER.minArea = +e.target.value;
    document.getElementById('f-area-val').textContent = `${FILTER.minArea.toLocaleString('ko-KR')}㎡`;
    apply();
  });
  document.getElementById('f-q').addEventListener('input', e => { FILTER.q = e.target.value.trim(); apply(); });
  document.getElementById('f-sort').addEventListener('change', e => { FILTER.sort = e.target.value; apply(); });
  document.getElementById('f-reset').addEventListener('click', resetFilters);
  document.getElementById('f-fav-only').addEventListener('click', () => {
    FILTER.favOnly = !FILTER.favOnly;
    document.getElementById('f-fav-only').classList.toggle('active', FILTER.favOnly);
    apply();
  });
  document.getElementById('dl-csv').addEventListener('click', downloadResults);

  updateFavCount();
  apply();
}

function buildMap() {
  MAP = L.map('lst-map', { zoomControl: false, attributionControl: false, minZoom: 5, maxZoom: 9 })
    .setView([36.3, 127.8], 6);
  paintMap();
}

function paintMap() {
  if (MAP_LAYER) MAP.removeLayer(MAP_LAYER);
  const counts = {};
  LISTINGS.forEach(r => { if (r.sido) counts[r.sido] = (counts[r.sido] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));

  MAP_LAYER = L.geoJSON(DATA.geo, {
    style: f => {
      const sido = f.properties.sido;
      const v = counts[sido] || 0;
      const t = v ? Math.min(1, Math.log(v + 1) / Math.log(max + 1)) : 0;
      return {
        fillColor: v ? `rgb(${Math.round(77 + 178 * t)},${Math.round(208 - 101 * t)},${Math.round(225 - 87 * t)})` : '#141a2e',
        weight: sido === FILTER.sido ? 2.5 : 0.7,
        color: sido === FILTER.sido ? '#fff' : '#3a4868',
        fillOpacity: 0.85,
      };
    },
    onEachFeature: (f, layer) => {
      const sido = f.properties.sido;
      const v = counts[sido] || 0;
      layer.bindTooltip(`<b>${sido}</b><br>폐교재산 ${v}건`, { className: 'tooltip-leaflet', sticky: true });
      layer.on('click', () => {
        FILTER.sido = (FILTER.sido === sido) ? '' : sido;
        document.getElementById('f-sido').value = FILTER.sido;
        paintMap(); apply();
      });
    },
  }).addTo(MAP);
}

function apply() {
  const favs = getFavs();
  FILTERED = LISTINGS.filter(r => {
    if (FILTER.sido && r.sido !== FILTER.sido) return false;
    if (FILTER.status && statusCat(r.usage_status) !== FILTER.status) return false;
    if (FILTER.minArea && (!r.land_area || r.land_area < FILTER.minArea)) return false;
    if (FILTER.favOnly && !favs.has(listingId(r))) return false;
    if (FILTER.q) {
      const hay = `${r.school_name} ${r.sido} ${r.sigungu || ''} ${r.jibun_address || ''} ${r.road_address || ''} ${r.usage_detail || ''}`;
      if (!hay.includes(FILTER.q)) return false;
    }
    return true;
  });

  // 정렬
  const s = FILTER.sort;
  FILTERED.sort((a, b) => {
    if (s === 'area_desc') return (b.land_area || 0) - (a.land_area || 0);
    if (s === 'area_asc') return (a.land_area || 1e12) - (b.land_area || 1e12);
    if (s === 'year_desc') return (b.closure_year || 0) - (a.closure_year || 0);
    if (s === 'year_asc') return (a.closure_year || 9999) - (b.closure_year || 9999);
    if (s === 'name') return (a.school_name || '').localeCompare(b.school_name || '');
    return 0;
  });

  render();
  updateHousingBadge();
  setHash({ sido: FILTER.sido, status: FILTER.status });
  paintMap();
}

function updateHousingBadge() {
  const hb = document.getElementById('housing-badge');
  if (!hb) return;
  const h = DATA.housing;
  if (!FILTER.sido) {
    if (!h) { hb.innerHTML = '시도를 선택하면 해당 지역 집값 추세가 표시됩니다.'; return; }
    // 전국: 폐교 많은 시도 vs 집값
    hb.innerHTML = `<b style="color:var(--text)">집값 추세 (한국부동산원, ${h.years[0]}→${h.years[h.years.length-1]})</b><br>시도를 선택하면 그 지역 집값 변화율이 표시됩니다.`;
    return;
  }
  if (!h || h.change_full[FILTER.sido] == null) {
    hb.innerHTML = `<b style="color:var(--text)">${FILTER.sido}</b> · 집값 데이터 없음`;
    return;
  }
  const full = h.change_full[FILTER.sido];
  const y1 = h.change_1y[FILTER.sido];
  const dir = full > 0 ? '상승' : '하락';
  const color = full > 0 ? 'var(--accent)' : 'var(--accent-2)';
  const idx = h.index[FILTER.sido];
  hb.innerHTML = `
    <b style="color:var(--text)">${FILTER.sido} 집값 추세</b>
    <span style="color:var(--text-faint)">· 한국부동산원 종합 매매가격지수</span><br>
    ${h.years[0]}→${h.years[h.years.length-1]} <b style="color:${color}; font-size:15px;">${full > 0 ? '+' : ''}${full}%</b> ${dir}
    ${y1 != null ? `· 최근 1년 ${y1 > 0 ? '+' : ''}${y1}%` : ''}
    <div style="margin-top:6px; font-size:10.5px; color:var(--text-faint);">지수 기준 ${h.meta.base} · 절대가격 아님(추세)</div>
  `;
}

function render() {
  const host = document.getElementById('lst-cards');
  const empty = document.getElementById('lst-empty');
  document.getElementById('result-count').textContent = FILTERED.length;

  if (!FILTERED.length) { host.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const favs = getFavs();
  // 너무 많으면 200개까지만 그리기 (성능)
  const slice = FILTERED.slice(0, 200);
  host.innerHTML = slice.map((r, i) => {
    const cat = statusCat(r.usage_status);
    const fav = favs.has(listingId(r));
    const price = fmtPrice(r.sale_price_kwon) || (r.rent_price_kwon ? fmtPrice(r.rent_price_kwon) + '/년' : null);
    return `
      <div class="lcard" data-i="${i}">
        <button class="lc-fav ${fav ? 'on' : ''}" data-fav="${i}" title="관심">${fav ? '♥' : '♡'}</button>
        <div class="lc-name">${escapeHtmlL(r.school_name)}</div>
        <div class="lc-loc">${r.sido || ''}${r.sigungu ? ' ' + r.sigungu : ''}${r.closure_year ? ' · ' + r.closure_year + '년 폐교' : ''}</div>
        <div class="lc-tags">
          <span class="lc-tag ${cat}">${r.usage_status || CAT_LABEL[cat]}</span>
          ${r.school_level ? `<span class="lc-tag etc">${r.school_level}</span>` : ''}
          ${price ? `<span class="lc-tag sale">${price}</span>` : ''}
        </div>
        <div class="lc-meta">
          ${r.land_area ? `대지 <b>${fmtArea(r.land_area)}</b><br>` : ''}
          ${r.building_area ? `건물 <b>${r.building_area.toLocaleString('ko-KR')}㎡</b><br>` : ''}
          ${(r.jibun_address || r.road_address) ? `📍 ${escapeHtmlL(r.jibun_address || r.road_address)}` : '<span style="color:var(--text-faint)">주소 미공개</span>'}
        </div>
      </div>`;
  }).join('') + (FILTERED.length > 200 ? `<div style="grid-column:1/-1;text-align:center;color:var(--text-faint);padding:16px;">상위 200건 표시 — 필터로 좁혀보세요 (전체 ${FILTERED.length}건)</div>` : '');

  host.querySelectorAll('.lcard').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.lc-fav')) return;
      openDetail(slice[+el.dataset.i]);
    });
  });
  host.querySelectorAll('.lc-fav').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const r = slice[+b.dataset.fav];
      const favs = getFavs();
      const id = listingId(r);
      if (favs.has(id)) favs.delete(id); else favs.add(id);
      saveFavs(favs);
      b.classList.toggle('on');
      b.textContent = favs.has(id) ? '♥' : '♡';
      updateFavCount();
      if (FILTER.favOnly) apply();
    });
  });
}

function openDetail(r) {
  const cat = statusCat(r.usage_status);
  const price = fmtPrice(r.sale_price_kwon);
  const rent = fmtPrice(r.rent_price_kwon);
  const modal = document.getElementById('lst-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="ai-modal-backdrop"></div>
    <div class="ai-modal" style="width:min(560px,92vw);">
      <h3>${escapeHtmlL(r.school_name)}</h3>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;">
        <span class="lc-tag ${cat}">${r.usage_status || CAT_LABEL[cat]}</span>
        ${r.school_level ? `<span class="lc-tag etc">${r.school_level}</span>` : ''}
        ${r.closure_year ? `<span class="lc-tag etc">${r.closure_year}년 폐교</span>` : ''}
      </div>
      <table style="width:100%; font-size:13px; line-height:1.9;">
        <tr><td style="color:var(--text-dim); width:90px;">위치</td><td>${r.sido || '—'} ${r.sigungu || ''}</td></tr>
        <tr><td style="color:var(--text-dim);">지번주소</td><td>${escapeHtmlL(r.jibun_address) || '—'}</td></tr>
        <tr><td style="color:var(--text-dim);">도로명</td><td>${escapeHtmlL(r.road_address) || '—'}</td></tr>
        <tr><td style="color:var(--text-dim);">대지면적</td><td>${fmtArea(r.land_area)}</td></tr>
        <tr><td style="color:var(--text-dim);">건물면적</td><td>${r.building_area ? r.building_area.toLocaleString('ko-KR') + '㎡' : '—'}</td></tr>
        ${price ? `<tr><td style="color:var(--text-dim);">매각가</td><td style="color:var(--accent-2);font-weight:700;">${price}</td></tr>` : ''}
        ${rent ? `<tr><td style="color:var(--text-dim);">연 대부료</td><td style="color:var(--accent-3);font-weight:700;">${rent}</td></tr>` : ''}
        ${r.usage_detail ? `<tr><td style="color:var(--text-dim);">활용내역</td><td>${escapeHtmlL(r.usage_detail)}</td></tr>` : ''}
        <tr><td style="color:var(--text-dim);">문의</td><td>${escapeHtmlL(r.contact) || '해당 시도교육청'}</td></tr>
      </table>
      <p style="margin-top:14px; font-size:11px; color:var(--text-faint); line-height:1.6;">
        ⚠️ 공개데이터 기준이라 최신 상태·실제 거래가능 여부는 다를 수 있습니다.
        정확한 정보는 ${r.sido || ''} 교육청 폐교재산 담당 부서에 확인하세요.
      </p>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <button class="btn" id="md-close">닫기</button>
        ${(r.jibun_address || r.road_address) ? `<a class="btn primary" target="_blank" rel="noopener"
          href="https://map.naver.com/v5/search/${encodeURIComponent(r.jibun_address || r.road_address)}">네이버 지도에서 보기</a>` : ''}
      </div>
    </div>`;
  modal.querySelector('.ai-modal-backdrop').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('md-close').addEventListener('click', () => modal.style.display = 'none');
}

function resetFilters() {
  FILTER = { sido: '', status: '', minArea: 0, q: '', favOnly: false, sort: 'area_desc' };
  document.getElementById('f-sido').value = '';
  document.getElementById('f-status').value = '';
  document.getElementById('f-area').value = 0;
  document.getElementById('f-area-val').textContent = '0㎡';
  document.getElementById('f-q').value = '';
  document.getElementById('f-sort').value = 'area_desc';
  document.getElementById('f-fav-only').classList.remove('active');
  apply();
}

function updateFavCount() {
  document.getElementById('fav-count').textContent = `(${getFavs().size})`;
}

function downloadResults() {
  const rows = FILTERED.map(r => ({
    학교명: r.school_name, 시도: r.sido, 시군구: r.sigungu || '',
    폐교연도: r.closure_year || '', 학교급: r.school_level || '',
    활용현황: r.usage_status || '', 대지면적_㎡: r.land_area || '',
    건물면적_㎡: r.building_area || '', 주소: r.jibun_address || r.road_address || '',
    매각가_원: r.sale_price_kwon || '', 대부료_원: r.rent_price_kwon || '',
    문의: r.contact || '',
  }));
  downloadBlob(toCSV(rows), `폐교매물_${FILTER.sido || '전국'}_${FILTERED.length}건.csv`, 'text/csv;charset=utf-8');
}

function escapeHtmlL(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

document.addEventListener('DOMContentLoaded', init);
