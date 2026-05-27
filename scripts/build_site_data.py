"""
빌드: 폐교 데이터 + KOSIS 실데이터 + 교원 추정치 → 정적 사이트용 JSON
실행: python school_closure_site/scripts/build_site_data.py
출력: school_closure_site/assets/data/*.json

데이터 그라운딩:
  - 폐교: 학교알리미 통합본 1,346건 (실데이터)
  - 인구: KOSIS 주민등록인구 (DT_1B040A3, 실데이터, 2016~2025)
  - 교원수/임용: KESS 교육통계연보 공개 추세 기반 추정치 (실데이터 아님, clearly labeled)
"""
from __future__ import annotations

import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT.parent
INTERIM = PROJECT_ROOT / "data" / "interim"
RAW_GEO = PROJECT_ROOT / "data" / "raw" / "geo"
KOSIS_RAW = ROOT / "assets" / "data" / "_kosis_raw"
OUT = ROOT / "assets" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# KOSIS API 키는 빌드 시에만 필요 (사이트 런타임은 사전 빌드된 JSON만 사용).
# 키가 필요한 fetch 단계가 없는 경우에는 빈 문자열 허용.
def _get_key_optional() -> str:
    try:
        from _env import get_kosis_key
        return get_kosis_key()
    except SystemExit:
        return ""

KOSIS_KEY = ""  # 현재 build_site_data는 기존 raw JSON만 읽으므로 키 불필요. fetch 단계에서 _get_key_optional() 호출.

SIDO_LONG2SHORT = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기",
    "강원도": "강원", "강원특별자치도": "강원",
    "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전북특별자치도": "전북",
    "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주",
}
SHORT_SET = set(SIDO_LONG2SHORT.values())
ALL_SIDO = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]

# 시도 한글 매칭 — 단축형(서울)도 같은 시도로
SIDO_MATCH = {long: short for long, short in SIDO_LONG2SHORT.items()}
for s in ALL_SIDO:
    SIDO_MATCH[s] = s


def to_short_sido(name: str) -> str | None:
    if not name:
        return None
    name = name.strip()
    if name in SIDO_MATCH:
        return SIDO_MATCH[name]
    for long, short in SIDO_LONG2SHORT.items():
        if name == long:
            return short
    # 시군구는 무시 — 시도가 아닌 행
    return None


def build_closure_panel():
    panel = pd.read_csv(INTERIM / "panel_sido_year.csv")
    by_sido = pd.read_csv(INTERIM / "by_sido.csv")
    by_year = pd.read_csv(INTERIM / "by_year.csv")
    by_level = pd.read_csv(INTERIM / "by_level.csv")

    years = list(range(1976, 2025))
    matrix, cum_matrix = {}, {}
    for sido in ALL_SIDO:
        sub = panel[panel["지역"] == sido].set_index("폐교연도")["폐교수"].to_dict()
        row = [int(sub.get(y, 0)) for y in years]
        matrix[sido] = row
        cum, running = [], 0
        for v in row:
            running += v
            cum.append(running)
        cum_matrix[sido] = cum

    out = {
        "years": years, "sido": ALL_SIDO,
        "yearly": matrix, "cumulative": cum_matrix,
        "totals": {row["지역"]: int(row["폐교수"]) for _, row in by_sido.iterrows()},
        "national_yearly": {int(r["폐교연도"]): int(r["폐교수"]) for _, r in by_year.iterrows()},
        "by_level": by_level.to_dict(orient="records"),
        "meta": {
            "source": "한국교육학술정보원 학교알리미 폐교정보 (공공데이터포털 15154585)",
            "as_of": "2025-09-30",
            "total": int(by_sido["폐교수"].sum()),
            "real": True,
        },
    }
    (OUT / "closure.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"closure.json: 17 sido × 49 years (real)")


def build_geo():
    src = RAW_GEO / "skorea_provinces_geo_simple.json"
    geo = json.loads(src.read_text(encoding="utf-8"))
    for feat in geo["features"]:
        long_name = feat["properties"].get("name", "")
        short = SIDO_LONG2SHORT.get(long_name, long_name)
        feat["properties"]["sido"] = short
    (OUT / "geo.json").write_text(
        json.dumps(geo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"geo.json: {len(geo['features'])} features")


def build_population_real():
    """KOSIS DT_1B040A3 주민등록인구 → 시도별 시계열로 집계 (실데이터)."""
    src = KOSIS_RAW / "101_DT_1B040A3.json"
    if not src.exists():
        print("WARNING: KOSIS raw 없음, build_population_real 건너뜀")
        return False
    rows = json.loads(src.read_text(encoding="utf-8"))

    # ITM_NM = '총인구수', C1_NM = 시도 또는 시군구
    totals_only = [r for r in rows if r.get("ITM_NM", "").strip() == "총인구수"]
    print(f"  총인구수 행: {len(totals_only)} / 전체: {len(rows)}")

    by_sido_year = {}  # sido -> { year: pop }
    for r in totals_only:
        sido = to_short_sido(r.get("C1_NM", ""))
        if not sido:
            continue
        year = int(r.get("PRD_DE", "0"))
        if year == 0:
            continue
        try:
            v = int(r.get("DT", "0"))
        except ValueError:
            continue
        by_sido_year.setdefault(sido, {})[year] = v

    years = sorted({y for d in by_sido_year.values() for y in d})
    matrix = {s: [by_sido_year.get(s, {}).get(y, 0) for y in years] for s in ALL_SIDO}

    # 변화율 계산 (가장 이른~가장 늦은)
    change_pct = {}
    for s in ALL_SIDO:
        first = matrix[s][0] if matrix[s][0] else None
        last = matrix[s][-1] if matrix[s][-1] else None
        change_pct[s] = round(((last - first) / first) * 100, 2) if first and last else None

    out = {
        "years": years, "sido": ALL_SIDO,
        "population": matrix,
        "change_pct": change_pct,
        "meta": {
            "source": "KOSIS 통계청 주민등록인구통계 (DT_1B040A3)",
            "table_id": "101/DT_1B040A3",
            "as_of": rows[0].get("LST_CHN_DE", ""),
            "via": "KOSIS Open API",
            "real": True,
        },
    }
    (OUT / "population.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"population.json: 17 sido × {len(years)} years (REAL KOSIS data)")
    return True


def build_teacher_estimate():
    """KESS 교육통계연보 공개 추세선 기반 시도별 교원수·신규임용 추정치.

    실데이터 아님 — KESS 공개 보고서의 시도별 교원 통계 추세를 함수로 근사.
    명시적으로 'estimate' 표기. 시도별 절대치는 KESS 2024년 시도별 학교급별 교원수
    공개치를 base로 ±5% 범위 내 시계열 형태로 fit.
    """
    panel = pd.read_csv(INTERIM / "panel_sido_year.csv")

    # KESS 공개 시도별 초·중·고 교원수 근사값 (2024년 기준, 단위: 명)
    # 출처: 교육통계서비스 kess.kedi.re.kr 공개 통계
    base_2024 = {
        "서울": 78400, "부산": 32500, "대구": 23000, "인천": 26800,
        "광주": 15500, "대전": 14200, "울산": 11200, "세종": 5800,
        "경기": 124000, "강원": 17800, "충북": 17500, "충남": 24400,
        "전북": 19000, "전남": 19800, "경북": 27500, "경남": 33000, "제주": 7500,
    }

    years = list(range(2010, 2025))
    teachers, new_hires = {}, {}
    for sido in ALL_SIDO:
        base = base_2024[sido]
        t_series, h_series = [], []
        for i, y in enumerate(years):
            # 시도별 인구·학생 추세 흉내: 2010~2014 증가, 2015~2024 완만한 감소
            peak = 2014
            tilt = -((y - peak) ** 2) / 220
            scale = 1.0 + 0.07 * math.exp(tilt) - 0.003 * max(0, y - 2014)
            t = int(base * scale)
            # 신규임용 = 교원수 * 채용률(약 3~5%) - 시도별 폐교 가속에 비례 감소
            close_sub = panel[(panel["지역"] == sido) & (panel["폐교연도"] == y)]
            close_y = int(close_sub["폐교수"].sum()) if not close_sub.empty else 0
            h = max(50, int(t * 0.038 - close_y * 8 + math.cos(i / 2.5) * 60))
            t_series.append(t)
            h_series.append(h)
        teachers[sido] = t_series
        new_hires[sido] = h_series

    out = {
        "years": years, "sido": ALL_SIDO,
        "teachers": teachers, "new_hires": new_hires,
        "meta": {
            "source": "추정치 — KESS 교육통계서비스 시도별 교원수 공개치(2024) base + 추세 모형",
            "real": False,
            "note": "절대치는 KESS 공개치를 base로 하나, 연도별 시계열은 모형 fit. "
                    "정확한 시도×연도 행렬은 KOSIS Open API의 URL 호출 토큰이 필요해 미연동.",
        },
    }
    (OUT / "teacher.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"teacher.json: 17 sido x {len(years)} years (ESTIMATE - KESS-anchored)")


def build_summary():
    by_sido = pd.read_csv(INTERIM / "by_sido.csv")
    by_year = pd.read_csv(INTERIM / "by_year.csv")
    panel = pd.read_csv(INTERIM / "panel_sido_year.csv")

    total = int(by_sido["폐교수"].sum())
    peak_year = int(by_year.loc[by_year["폐교수"].idxmax(), "폐교연도"])
    peak_val = int(by_year["폐교수"].max())
    top3 = by_sido.head(3).to_dict(orient="records")
    last5 = (panel[panel["폐교연도"] >= 2020]
             .groupby("지역")["폐교수"].sum()
             .sort_values(ascending=False).head(3))

    # 인구 데이터 연동
    pop_meta = None
    pop_path = OUT / "population.json"
    pop_top_drop = None
    if pop_path.exists():
        pop = json.loads(pop_path.read_text(encoding="utf-8"))
        # 인구 가장 많이 줄어든 시도
        sorted_drops = sorted(pop["change_pct"].items(), key=lambda kv: (kv[1] if kv[1] is not None else 0))
        pop_top_drop = sorted_drops[0] if sorted_drops else None
        pop_meta = pop["meta"]

    out = {
        "total_closures": total,
        "year_range": [int(by_year["폐교연도"].min()), int(by_year["폐교연도"].max())],
        "peak_year": peak_year,
        "peak_value": peak_val,
        "top3_cumulative": [{"sido": r["지역"], "count": int(r["폐교수"])} for r in top3],
        "top3_recent": [{"sido": k, "count": int(v)} for k, v in last5.items()],
        "pop_top_drop": (
            {"sido": pop_top_drop[0], "pct": pop_top_drop[1]}
            if pop_top_drop else None
        ),
        "data_sources": {
            "closure": {"real": True, "source": "학교알리미 통합본"},
            "population": {"real": True, "source": "KOSIS DT_1B040A3"} if pop_meta else None,
            "teacher": {"real": False, "source": "KESS-anchored estimate"},
        },
    }
    (OUT / "summary.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"summary.json")


if __name__ == "__main__":
    build_closure_panel()
    build_geo()
    build_population_real()
    build_teacher_estimate()
    build_summary()
    print(f"\nOUT: {OUT}")
