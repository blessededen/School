// 실시간 LLM 채팅 — Google Gemini (gemini-2.5-flash) 전용, BYOK
// 키는 브라우저 localStorage에만 저장. 서버 없음. 직접 API 호출.

const AI_KEY_STORE = 'school_atlas_gemini_key';
const GEMINI_MODEL = 'gemini-2.5-flash';

function getKey() {
  return (localStorage.getItem(AI_KEY_STORE) || '').trim();
}
function saveKey(k) {
  localStorage.setItem(AI_KEY_STORE, k);
}

/* ── 시스템 프롬프트 빌더 ─────────────────────────────── */
function buildSystemPrompt(focusSido) {
  if (!window.DATA?.closure) return 'You are a data analyst.';

  const c = DATA.closure;
  const p = DATA.population || {};
  const h = DATA.housing || {};

  let context = `당신은 한국 학교 폐교 데이터 전문 분석가입니다. 사용자가 한국어로 묻습니다.
간결하고 구체적으로 답하세요. 수치 인용 시 출처를 명시. 모르면 모른다고 답하세요.

[데이터셋 요약]
- 전체 폐교: ${c.meta.total}교 (1976–2024, 학교알리미 통합본 실데이터)
- 학교급: 초등 ${c.by_level.filter(r => r['학교급'] === '초').reduce((a,b)=>a+b['폐교수'],0)}교, 중 ${c.by_level.filter(r => r['학교급'] === '중').reduce((a,b)=>a+b['폐교수'],0)}교, 고 ${c.by_level.filter(r => r['학교급'] === '고').reduce((a,b)=>a+b['폐교수'],0)}교
- 시도별 누적 (상위 5): ${[...c.sido].sort((a,b)=>c.totals[b]-c.totals[a]).slice(0,5).map(s=>`${s} ${c.totals[s]}교`).join(', ')}
- 인구: KOSIS 주민등록인구 2016–2025 (실데이터)
- 집값: 한국부동산원 주택매매가격지수 2021–2026 (실데이터, 추세)
- 폐교 매물: 시도교육청 폐교재산 공개데이터 (활용현황·면적·주소·일부 매각/대부가)`;

  if (focusSido && c.sido.includes(focusSido)) {
    const yearly = c.yearly[focusSido];
    const peakIdx = yearly.indexOf(Math.max(...yearly));
    const recent5 = yearly.slice(-5).reduce((a,b)=>a+b,0);
    const popChange = p.change_pct?.[focusSido];
    const priceChange = h.change_full?.[focusSido];

    context += `

[현재 사용자가 보고 있는 시도: ${focusSido}]
- 누적 폐교: ${c.totals[focusSido]}교 (전국 ${[...c.sido].sort((a,b)=>c.totals[b]-c.totals[a]).indexOf(focusSido)+1}위)
- 단년 최대: ${c.years[peakIdx]}년 ${yearly[peakIdx]}교
- 최근 5년(2020-2024) 폐교: ${recent5}교
- 인구 변화율 (2016→2025): ${popChange !== undefined ? popChange.toFixed(2) + '%' : 'N/A'}
- 집값 변화율 (2021→2026): ${priceChange != null ? priceChange + '%' : 'N/A'}`;
  }

  context += `

답변은 3-5문장 내로 짧게. 마크다운 강조(**) 적극 활용. 데이터에 없는 추측은 금지.`;
  return context;
}

/* ── Gemini API 호출 ─────────────────────────────────── */
async function askAI(userPrompt, focusSido) {
  const key = getKey();
  if (!key) throw new Error('NO_KEY');

  const sys = buildSystemPrompt(focusSido);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.4,
        // gemini-2.5-flash는 기본 thinking이 출력 토큰을 잠식 → 답변 잘림 방지 위해 thinking 끔
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      const em = j?.error?.message || '';
      if (r.status === 429 || /quota|rate/i.test(em)) {
        throw new Error('QUOTA');
      }
      if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(em)) {
        throw new Error('BAD_KEY');
      }
      msg = em || msg;
    } catch (e) {
      if (e.message === 'QUOTA' || e.message === 'BAD_KEY') throw e;
    }
    throw new Error(msg);
  }

  const j = await r.json();
  const cand = j.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) {
    // 차단/빈응답 원인 표시
    const fr = cand?.finishReason || j.promptFeedback?.blockReason || '';
    if (fr === 'SAFETY' || j.promptFeedback?.blockReason) return '(안전 필터로 응답이 차단되었습니다. 질문을 바꿔보세요.)';
    return '(응답이 비어있습니다. 질문을 바꿔보세요.)';
  }
  if (cand?.finishReason === 'MAX_TOKENS') {
    return text + '\n\n…(응답이 길어 잘렸습니다. 더 구체적으로 물어보면 완결된 답을 받을 수 있어요.)';
  }
  return text;
}

/* ── 키 설정 모달 ────────────────────────────────────── */
function openKeyModal() {
  const cur = getKey();
  let modal = document.getElementById('ai-key-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'ai-key-modal';
  modal.innerHTML = `
    <div class="ai-modal-backdrop"></div>
    <div class="ai-modal">
      <h3>AI 챗 키 설정 — Google Gemini</h3>
      <p class="ai-modal-warn">
        ⚠️ 키는 <strong>이 브라우저의 localStorage에만</strong> 저장됩니다.
        서버로 보내지 않고 Gemini API에 직접 호출합니다. 키 비용·할당량은 본인 부담이므로
        신뢰하는 환경에서만 사용하세요. 모델: <strong>${GEMINI_MODEL}</strong>
      </p>
      <label class="ai-field">
        <span>Gemini API 키 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="font-size:11px;">(무료 발급)</a></span>
        <input type="password" id="ai-key-input" placeholder="AIza..." value="${cur}" autocomplete="off" />
      </label>
      <div class="ai-modal-actions">
        <button class="btn" id="ai-key-clear">키 삭제</button>
        <button class="btn primary" id="ai-key-save">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('ai-key-save').addEventListener('click', () => {
    const k = document.getElementById('ai-key-input').value.trim();
    if (k) saveKey(k);
    modal.remove();
    toast('Gemini 키 저장됨 · 이제 질문해 보세요');
    document.dispatchEvent(new Event('ai-key-changed'));
  });
  document.getElementById('ai-key-clear').addEventListener('click', () => {
    localStorage.removeItem(AI_KEY_STORE);
    document.getElementById('ai-key-input').value = '';
    toast('키 삭제됨');
  });
  modal.querySelector('.ai-modal-backdrop').addEventListener('click', () => modal.remove());
}

/* ── 채팅 패널 ────────────────────────────────────────── */
function mountChat(hostEl, getFocusSido) {
  hostEl.innerHTML = `
    <div class="chat-header">
      <span class="ai-label">AI 분석</span>
      <span class="chat-provider">Google Gemini · ${GEMINI_MODEL}</span>
      <button class="icon-btn chat-settings" id="chat-settings-btn" title="Gemini 키 설정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
    <div class="chat-history" id="chat-history">
      <div class="chat-msg ai">데이터에 대해 자유롭게 질문하세요. 시도를 선택하면 그 시도 컨텍스트가 자동 첨부됩니다. 키가 없으면 우상단 ⚙ 클릭.</div>
    </div>
    <div class="chat-suggested" id="chat-suggested"></div>
    <div class="chat-input-row">
      <input type="text" id="chat-input" placeholder="예: 경북이 왜 1위가 됐어?" />
      <button class="btn primary" id="chat-send">전송</button>
    </div>
    <div class="chat-foot">
      Google Gemini (<span>${GEMINI_MODEL}</span>) · 응답은 실시간 API 호출 · 키는 localStorage에만 저장
    </div>
  `;

  document.getElementById('chat-settings-btn').addEventListener('click', openKeyModal);

  const renderSuggested = () => {
    const focus = getFocusSido();
    const suggested = focus ? [
      `${focus}이 폐교 1위가 된 이유는?`,
      `${focus}의 인구·집값·폐교 관계 분석`,
      `${focus}에서 폐교 매입한다면 어떤 점을 봐야 해?`,
    ] : [
      '1999년 폐교 정점이 왜 생겼어?',
      '폐교 많은 지역과 집값 하락은 관계있어?',
      '본교 vs 분교 폐교 차이는?',
    ];
    document.getElementById('chat-suggested').innerHTML = suggested.map(q =>
      `<button class="chip-btn chat-sugg" data-q="${q}">${q}</button>`).join('');
    document.querySelectorAll('.chat-sugg').forEach(b => {
      b.addEventListener('click', () => {
        document.getElementById('chat-input').value = b.dataset.q;
        sendMessage();
      });
    });
  };
  renderSuggested();
  document.addEventListener('sido-focus-changed', renderSuggested);

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';

    const hist = document.getElementById('chat-history');
    hist.insertAdjacentHTML('beforeend', `<div class="chat-msg user">${escapeHtml(q)}</div>`);
    hist.insertAdjacentHTML('beforeend', `<div class="chat-msg ai loading" id="chat-loading"><span class="dot-ring"></span> 생각 중...</div>`);
    hist.scrollTop = hist.scrollHeight;

    try {
      const reply = await askAI(q, getFocusSido());
      document.getElementById('chat-loading').remove();
      hist.insertAdjacentHTML('beforeend', `<div class="chat-msg ai">${renderMarkdown(reply)}</div>`);
      hist.scrollTop = hist.scrollHeight;
    } catch (e) {
      document.getElementById('chat-loading')?.remove();
      let msg;
      if (e.message === 'NO_KEY') msg = '키가 설정되지 않았습니다. 우상단 ⚙ 클릭 → Gemini 키 입력.';
      else if (e.message === 'QUOTA') msg = '⚠️ 이 키의 무료 할당량(분당/일일 한도)에 도달했습니다. 잠시 후 다시 시도하거나, AI Studio에서 새 키를 발급하세요.';
      else if (e.message === 'BAD_KEY') msg = '키가 유효하지 않습니다. ⚙에서 다시 확인하세요. (Gemini API 키는 AIza... 로 시작)';
      else msg = `에러: ${escapeHtml(e.message)}`;
      hist.insertAdjacentHTML('beforeend', `<div class="chat-msg ai error">${msg}</div>`);
      hist.scrollTop = hist.scrollHeight;
    }
  }

  document.getElementById('chat-send').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
function renderMarkdown(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
