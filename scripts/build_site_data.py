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


def build_housing():
    """한국부동산원 유형별 매매가격지수 (종합) → 시도별 연도별 지수 (실데이터, KOSIS 408/DT_30404_B012).

    지수 기준 2026.1=100. 시도별 집값 추세(상승/하락) 비교용.
    """
    key = _get_key_optional()
    if not key:
        print("housing.json 건너뜀 (KOSIS 키 없음)")
        return
    import urllib.parse

    q = {
        "method": "getList", "apiKey": key, "format": "json", "jsonVD": "Y",
        "orgId": "408", "tblId": "DT_30404_B012",
        "itmId": "ALL", "objL1": "00", "objL2": "ALL",  # 00=종합
        "prdSe": "M", "newEstPrdCnt": "120",  # 최근 120개월
    }
    url = "https://kosis.kr/openapi/Param/statisticsParameterData.do?" + urllib.parse.urlencode(q)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        rows = json.loads(urllib.request.urlopen(req, timeout=40).read().decode("utf-8"))
    except Exception as e:
        print(f"housing fetch 실패: {e}")
        return
    if not isinstance(rows, list):
        print(f"housing 응답 이상: {rows}")
        return

    # 시도만 추출, 월별 → 연도별(연말값=12월, 없으면 최신월)
    sido_set = set(ALL_SIDO)
    by_sido_month = {}  # sido -> {YYYYMM: val}
    for r in rows:
        nm = (r.get("C2_NM") or "").strip()
        if nm not in sido_set:
            continue
        prd = r.get("PRD_DE", "")
        try:
            v = float(r.get("DT", ""))
        except ValueError:
            continue
        by_sido_month.setdefault(nm, {})[prd] = v

    # 연도별 12월 값 (없으면 그 해 마지막 월)
    years = sorted({int(p[:4]) for d in by_sido_month.values() for p in d})
    index_year = {}
    for s in ALL_SIDO:
        months = by_sido_month.get(s, {})
        row = []
        for y in years:
            ym_list = sorted([p for p in months if p.startswith(str(y))])
            row.append(round(months[ym_list[-1]], 1) if ym_list else None)
        index_year[s] = row

    # 변화율: 최근값 vs 1년전 / 전체기간
    change_1y, change_full = {}, {}
    for s in ALL_SIDO:
        row = [v for v in index_year[s] if v is not None]
        if len(row) >= 2:
            change_full[s] = round(((row[-1] - row[0]) / row[0]) * 100, 2)
            if len(row) >= 2:
                change_1y[s] = round(((row[-1] - row[-2]) / row[-2]) * 100, 2)
        else:
            change_full[s] = change_1y[s] = None

    out = {
        "years": years, "sido": ALL_SIDO,
        "index": index_year,
        "change_1y": change_1y,
        "change_full": change_full,
        "meta": {
            "source": "KOSIS 한국부동산원 유형별 매매가격지수(종합) DT_30404_B012",
            "table_id": "408/DT_30404_B012",
            "base": rows[0].get("UNIT_NM", "") if rows else "",
            "via": "KOSIS Open API",
            "real": True,
            "note": "지수 기준은 특정 시점=100. 절대 가격(원)이 아니라 상대적 추세 비교용.",
        },
    }
    (OUT / "housing.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"housing.json: 17 sido × {len(years)} years (REAL KOSIS 부동산원 지수)")


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
            "listings": {"real": True, "source": "시도교육청 폐교재산 현황"},
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
    build_housing()
    build_summary()
    print(f"\nOUT: {OUT}")
