# 학교가 사라지는 속도 — 폐교 인터랙티브 아틀라스

1976년 이후 전국 1,346개 폐교를 시도·연도·교원 임용 축으로 풀어낸 정적 웹사이트.

## 실행 방법

빌드 단계가 없습니다. CDN으로 라이브러리 로드.

**방법 1 — 즉시 실행**

`index.html`을 더블클릭하거나 브라우저에서 직접 열면 됩니다.
일부 브라우저는 `fetch()` 로컬 차단 정책 때문에 차트가 안 뜰 수 있어요. 그 경우 방법 2.

**방법 2 — 로컬 서버 (권장)**

```bash
cd school_closure_site
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 데이터 재생성

1. `.env.example`을 `.env`로 복사하고 본인 KOSIS API 키 입력 (발급: https://kosis.kr/openapi)
2. 빌드 실행:

```bash
cd school_closure_site
python scripts/fetch_kosis.py       # KOSIS raw 응답 받기 (키 필요)
python scripts/build_site_data.py   # raw + 폐교 CSV → JSON
```

`.env`는 `.gitignore`로 절대 커밋되지 않습니다. 사이트 런타임은 사전 빌드된 JSON만 사용하므로 **배포된 사이트에는 키가 노출되지 않습니다**.

생성물:
- `assets/data/closure.json` — 시도×연도 폐교 패널 (17×49)
- `assets/data/teacher.json` — 시도×연도 교원수·신규임용 (현재 합성 placeholder)
- `assets/data/summary.json` — 홈 KPI
- `assets/data/geo.json` — 시도 행정구역 GeoJSON

## 페이지

| 경로 | 내용 |
|---|---|
| `index.html` | 한반도 인터랙티브 지도 · 슬라이더 · 시도 순위 |
| `pages/timeline.html` | 전국·시도별 시계열 + 다중 선택 비교 |
| `pages/compare.html` | 폐교 vs 교원 임용 듀얼축 · 산점도 · 비율 차트 |
| `pages/forecast.html` | TensorFlow.js 다항회귀 · 시나리오 슬라이더 |
| `pages/3d.html` | deck.gl 3D 컬럼 시각화 |
| `pages/about.html` | 자료 출처 · 기술 스택 · 한계 |

## 기술 스택

- 빌드: Python 3.13 + pandas → 정적 JSON
- 프론트: Vanilla HTML/CSS/JS (빌드 없음)
- 지도: Leaflet 1.9, deck.gl 9.0
- 차트: Plotly.js 2.35
- ML: TensorFlow.js 4.20 (브라우저 학습)
- 폰트: Pretendard

## 출처

| 자료 | 운영기관 | 기준일 | 공공데이터포털 ID |
|---|---|---|---|
| 학교알리미 폐교정보 | 한국교육학술정보원 | 2025-09-30 | 15154585 |
| 초·중등학교 학교정보 | 한국교육학술정보원 | 2024-12-10 | 15123572 |
| 시도 행정구역 경계 | 통계청 SGIS | 2013 | — |
| 교원 통계 (예정) | KOSIS Open API | 진행 중 | — |

## 한계

- 인구 데이터는 KOSIS DT_1B040A3 실데이터 (2016–2025).
- 교원수/신규임용은 KESS 공개치 base + 추세 모형으로 만든 추정치 (실데이터 아님 — UI에 ESTIMATE 뱃지로 표기).
- 예측 모델은 단순 다항회귀 + 가정 신뢰밴드. 정책 시나리오 탐색용.
- 학교명 매칭률 14.8%로 학교 메타와의 결합은 추가 보강 필요.

## 배포

GitHub Pages 배포 가이드는 [DEPLOY.md](DEPLOY.md) 참조.
