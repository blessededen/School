# 학교가 사라지는 속도 — 폐교 인터랙티브 아틀라스

1976년 이후 전국 1,346개 폐교를 시도·연도로 분석하고, 시도교육청 폐교재산 840건을
검색 가능한 매물로 가공한 정적 웹사이트. 인구·집값 실데이터와 결합.

## 실행 방법

빌드 단계가 없습니다. CDN으로 라이브러리 로드.

**방법 1 — 즉시 실행**

`index.html`을 더블클릭. 단, 일부 브라우저는 `fetch()` 로컬 차단으로 데이터가 안 뜰 수 있어 방법 2 권장.

**방법 2 — 로컬 서버 (권장)**

```bash
cd school_closure_site
python -m http.server 8000
# http://localhost:8000
```

## 데이터 재생성

1. `.env.example`을 `.env`로 복사하고 본인 KOSIS API 키 입력 (발급: https://kosis.kr/openapi)
2. 빌드 실행:

```bash
cd school_closure_site
python scripts/build_site_data.py   # 폐교+인구(KOSIS)+집값(KOSIS) → JSON
python scripts/build_listings.py    # 시도교육청 폐교재산 22개 CSV → 매물 JSON
```

`.env`는 `.gitignore`로 절대 커밋되지 않습니다. 사이트 런타임은 사전 빌드된 JSON만 사용하므로 **배포된 사이트에는 키가 노출되지 않습니다**.

생성물 (`assets/data/`):
- `closure.json` — 시도×연도 폐교 패널 (17×49) · 실데이터
- `population.json` — 시도×연도 주민등록인구 (KOSIS) · 실데이터
- `housing.json` — 시도×연도 주택매매가격지수 (한국부동산원/KOSIS) · 실데이터
- `listings.json` — 폐교재산 매물 840건 (17개 시도교육청) · 실데이터
- `summary.json` — 홈 KPI
- `geo.json` — 시도 행정구역 GeoJSON

## 페이지

| 경로 | 내용 |
|---|---|
| `index.html` | 한반도 인터랙티브 지도 · 슬라이더 · 시도 순위 · AI 챗 |
| `pages/timeline.html` | 전국·시도별 시계열 + 다중 선택 비교 |
| `pages/compare.html` | 폐교 vs 인구 듀얼축 · 인구절벽 산점도 · 폐교밀도 vs 집값 |
| `pages/listings.html` | **폐교 매물 검색** — 시도·활용현황·면적 필터 + 지도 + 관심매물 + 집값 추세 |
| `pages/forecast.html` | TensorFlow.js 다항회귀 · 시나리오 프리셋 |
| `pages/3d.html` | deck.gl 3D 컬럼 시각화 |
| `pages/about.html` | 자료 출처 · 기술 스택 · 한계 |

## 폐교 매물 검색 (핵심 실용 기능)

전국 17개 시도교육청이 흩어 공개한 폐교재산을 한곳에 통합.

- 시도·활용현황(매각/대부/자체활용/미활용)·최소면적·키워드 필터
- 시도 클릭 = 지역 필터 (choropleth 지도)
- 카드 클릭 = 상세(주소·면적·연락처·일부 매각/대부가) + 네이버 지도 바로가기
- 관심 매물 ♡ (localStorage 저장)
- 선택 시도의 집값 추세(한국부동산원 지수) 자동 표시
- 결과 CSV 다운로드

## AI 채팅 (실시간 LLM, BYOK)

홈·인구 페이지 하단 챗 패널 우상단 ⚙ → 본인 API 키 입력 (OpenAI · Anthropic Claude · Google Gemini).

- 키는 본인 브라우저 **localStorage에만** 저장. 서버 안 거치고 직접 호출
- 시도 선택 시 그 시도 데이터가 시스템 프롬프트에 자동 첨부
- 키 없이도 룰베이스 자동 요약은 동작

## 기술 스택

- 빌드: Python 3.13 + pandas + openpyxl → 정적 JSON
- 프론트: Vanilla HTML/CSS/JS (빌드 없음)
- 지도: Leaflet 1.9, deck.gl 9.0
- 차트: Plotly.js 2.35
- ML: TensorFlow.js 4.20 (브라우저 학습)
- 폰트: Pretendard

## 출처 (전부 실데이터)

| 자료 | 운영기관 | 기준일 | ID |
|---|---|---|---|
| 학교알리미 폐교정보 | 한국교육학술정보원 | 2025-09-30 | 15154585 |
| 시도교육청 폐교재산 현황 | 17개 시도교육청 | 2022–2026 | 다수 |
| 주민등록인구 (시도) | 통계청 (KOSIS) | 2016–2025 | 101/DT_1B040A3 |
| 주택 매매가격지수 (종합) | 한국부동산원 (KOSIS) | 2021–2026 | 408/DT_30404_B012 |
| 시도 행정구역 경계 | 통계청 SGIS | 2013 | — |

## 한계

- 폐교 매물: 시도교육청별 공시 양식·기준일이 달라 일부 필드(면적·주소·가격)는 결측. 가격은 31건만 공개.
- 집값: 절대 가격(원)이 아니라 매매가격지수(추세). 기준 시점=100.
- 매물 좌표는 미수집(주소만) — 지도 핀 대신 시도 choropleth + 네이버 지도 링크로 대체.
- 예측 모델은 단순 다항회귀 + 가정 신뢰밴드. 시나리오 탐색용.

## 배포

GitHub Pages 배포 가이드는 [DEPLOY.md](DEPLOY.md) 참조.
