// BYOK 실시간 LLM 채팅 — OpenAI · Anthropic · Google 지원
// 키는 브라우저 localStorage에만 저장. 서버 없음. 직접 API 호출.

const AI_KEY_STORE = 'school_atlas_ai_keys';
const AI_PROVIDER_STORE = 'school_atlas_ai_provider';

const PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
    keyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    name: 'Google Gemini',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
};

function getKeys() {
  try { return JSON.parse(localStorage.getItem(AI_KEY_STORE) || '{}'); }
  catch { return {}; }
}
function saveKey(provider, key) {
  const keys = getKeys();
  keys[provider] = key;
  localStorage.setItem(AI_KEY_STORE, JSON.stringify(keys));
}
function getProvider() {
  return localStorage.getItem(AI_PROVIDER_STORE) || 'anthropic';
}
function setProvider(p) {
  localStorage.setItem(AI_PROVIDER_STORE, p);
}

/* ── 시스템 프롬프트 빌더 ─────────────────────────────── */
function buildSystemPrompt(focusSido) {
  if (!window.DATA?.closure) return 'You are a data analyst.';

  const c = DATA.closure;
  const p = DATA.population || {};
  const t = DATA.teacher || {};

  let context = `당신은 한국 학교 폐교 데이터 전문 분석가입니다. 사용자가 한국어로 묻습니다.
간결하고 구체적으로 답하세요. 수치 인용 시 출처를 명시. 모르면 모른다고 답하세요.

[데이터셋 요약]
- 전체 폐교: ${c.meta.total}교 (1976–2024, 학교알리미 통합본 실데이터)
- 학교급: 초등 ${c.by_level.filter(r => r['학교급'] === '초').reduce((a,b)=>a+b['폐교수'],0)}교, 중 ${c.by_level.filter(r => r['학교급'] === '중').reduce((a,b)=>a+b['폐교수'],0)}교, 고 ${c.by_level.filter(r => r['학교급'] === '고').reduce((a,b)=>a+b['폐교수'],0)}교
- 시도별 누적 (상위 5): ${[...c.sido].sort((a,b)=>c.totals[b]-c.totals[a]).slice(0,5).map(s=>`${s} ${c.totals[s]}교`).join(', ')}
- 인구 데이터: KOSIS DT_1B040A3 주민등록인구 2016–2025 (실데이터)
- 교원 데이터: KESS 추정치 (실데이터 아님 — 추세 모형 기반)`;

  if (focusSido && c.sido.includes(focusSido)) {
    const yearly = c.yearly[focusSido];
    const peakIdx = yearly.indexOf(Math.max(...yearly));
    const recent5 = yearly.slice(-5).reduce((a,b)=>a+b,0);
    const popChange = p.change_pct?.[focusSido];

    context += `

[현재 사용자가 보고 있는 시도: ${focusSido}]
- 누적 폐교: ${c.totals[focusSido]}교 (전국 ${c.sido.indexOf(focusSido)+1}위)
- 단년 최대: ${c.years[peakIdx]}년 ${yearly[peakIdx]}교
- 최근 5년(2020-2024) 폐교: ${recent5}교
- 인구 변화율 (2016→2025): ${popChange !== undefined ? popChange.toFixed(2) + '%' : 'N/A'}`;
  }

  context += `

답변은 3-5문장 내로 짧게. 마크다운 강조(**) 적극 활용. 데이터에 없는 추측은 금지.`;

  return context;
}

/* ── API 호출 어댑터 ──────────────────────────────────── */
async function callAnthropic(messages, key) {
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: sys,
      messages: userMessages,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j.content?.[0]?.text || '(응답 없음)';
}

async function callOpenAI(messages, key) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 600,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '(응답 없음)';
}

async function callGoogle(messages, key) {
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system');
  const contents = userMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { maxOutputTokens: 600 },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text || '(응답 없음)';
}

async function askAI(userPrompt, focusSido) {
  const provider = getProvider();
  const keys = getKeys();
  const key = keys[provider];
  if (!key) throw new Error('NO_KEY');

  const messages = [
    { role: 'system', content: buildSystemPrompt(focusSido) },
    { role: 'user', content: userPrompt },
  ];

  if (provider === 'anthropic') return callAnthropic(messages, key);
  if (provider === 'openai') return callOpenAI(messages, key);
  if (provider === 'google') return callGoogle(messages, key);
  throw new Error(`unknown provider: ${provider}`);
}

/* ── 키 설정 모달 ────────────────────────────────────── */
function openKeyModal() {
  const provider = getProvider();
  const cur = getKeys()[provider] || '';
  const meta = PROVIDERS[provider];

  let modal = document.getElementById('ai-key-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'ai-key-modal';
  modal.innerHTML = `
    <div class="ai-modal-backdrop"></div>
    <div class="ai-modal">
      <h3>AI 챗 키 설정</h3>
      <p class="ai-modal-warn">
        ⚠️ 키는 <strong>이 브라우저의 localStorage에만</strong> 저장됩니다.
        서버로 보내지 않고, 다른 사람에게 노출되지 않습니다.
        하지만 키 사용 비용은 본인 부담이므로 신뢰하는 환경에서만 사용하세요.
      </p>
      <label class="ai-field">
        <span>제공자</span>
        <select id="ai-provider-sel">
          ${Object.entries(PROVIDERS).map(([k, v]) =>
            `<option value="${k}" ${k === provider ? 'selected' : ''}>${v.name}</option>`).join('')}
        </select>
      </label>
      <label class="ai-field">
        <span>API 키 <a href="${meta.docsUrl}" target="_blank" rel="noopener" style="font-size:11px;">(발급)</a></span>
        <input type="password" id="ai-key-input" placeholder="${meta.keyHint}" value="${cur}" autocomplete="off" />
      </label>
      <div class="ai-modal-actions">
        <button class="btn" id="ai-key-clear">키 삭제</button>
        <button class="btn primary" id="ai-key-save">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('ai-provider-sel').addEventListener('change', e => {
    setProvider(e.target.value);
    openKeyModal();
  });
  document.getElementById('ai-key-save').addEventListener('click', () => {
    const k = document.getElementById('ai-key-input').value.trim();
    if (k) saveKey(getProvider(), k);
    modal.remove();
    toast('AI 키 저장됨 · 이제 질문해 보세요');
    document.dispatchEvent(new Event('ai-key-changed'));
  });
  document.getElementById('ai-key-clear').addEventListener('click', () => {
    const keys = getKeys();
    delete keys[getProvider()];
    localStorage.setItem(AI_KEY_STORE, JSON.stringify(keys));
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
      <span class="chat-provider" id="chat-provider-label">${PROVIDERS[getProvider()].name}</span>
      <button class="icon-btn chat-settings" id="chat-settings-btn" title="AI 키 설정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
    <div class="chat-history" id="chat-history">
      <div class="chat-msg ai">데이터에 대해 자유롭게 질문하세요. 시도를 선택하면 그 시도 컨텍스트가 자동 첨부됩니다.</div>
    </div>
    <div class="chat-suggested" id="chat-suggested"></div>
    <div class="chat-input-row">
      <input type="text" id="chat-input" placeholder="예: 경북이 왜 1위가 됐어?" />
      <button class="btn primary" id="chat-send">전송</button>
    </div>
    <div class="chat-foot">
      키 미설정 시 우상단 ⚙ 클릭. 모델: <span id="chat-model"></span> · 응답은 실시간 API 호출
    </div>
  `;

  const updateProviderLabel = () => {
    document.getElementById('chat-provider-label').textContent = PROVIDERS[getProvider()].name;
    document.getElementById('chat-model').textContent = PROVIDERS[getProvider()].models[0];
  };
  updateProviderLabel();
  document.addEventListener('ai-key-changed', updateProviderLabel);

  document.getElementById('chat-settings-btn').addEventListener('click', openKeyModal);

  // 제안 질문
  const renderSuggested = () => {
    const focus = getFocusSido();
    const suggested = focus ? [
      `${focus}이 폐교 1위가 된 이유는?`,
      `${focus}의 인구·폐교 관계 분석`,
      `${focus} 2030년 전망 시나리오`,
    ] : [
      '1999년 폐교 정점이 왜 생겼어?',
      '최근 5년 가장 급격한 시도는?',
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
      if (e.message === 'NO_KEY') {
        hist.insertAdjacentHTML('beforeend', `<div class="chat-msg ai error">키가 설정되지 않았습니다. 우상단 ⚙ 클릭 → 키 입력.</div>`);
      } else {
        hist.insertAdjacentHTML('beforeend', `<div class="chat-msg ai error">에러: ${escapeHtml(e.message)}</div>`);
      }
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
  // 매우 가벼운 **bold** 만 처리
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
