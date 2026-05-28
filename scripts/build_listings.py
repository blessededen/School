"""
시도교육청 폐교재산 CSV 22개 → 통합 매물 listings.json

각 파일 스키마가 제각각이라 별칭(alias) 기반 컬럼 매핑 + 파일명 기반 시도 추론.
실데이터만 사용. 추정·합성 없음. 결측은 결측으로 둠.

실행: python school_closure_site/scripts/build_listings.py
출력: school_closure_site/assets/data/listings.json
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT.parent
RAW = PROJECT_ROOT / "data" / "raw" / "closure"
OUT = ROOT / "assets" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# 통합본·마스터·텍스트형은 별도 취급/제외
EXCLUDE = {
    "15154585",  # 학교알리미 통합본 (면적·활용현황 없음 = 매물 정보 아님)
}
CHUNGNAM_TEXT = "15151779"  # 충남 텍스트형 (특수 처리)

SIDO_SHORT = {
    "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천",
    "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종",
    "경기": "경기", "강원": "강원", "충청북도": "충북", "충북": "충북",
    "충청남도": "충남", "충남": "충남", "전라북도": "전북", "전북": "전북",
    "전라남도": "전남", "전남": "전남", "경상북도": "경북", "경북": "경북",
    "경상남도": "경남", "경남": "경남", "제주": "제주",
}

# 파일명 → 시도 추론 키워드 (우선순위 순)
FILENAME_SIDO = [
    ("경상북도", "경북"), ("대구광역시", "대구"), ("대구", "대구"),
    ("전북특별자치도", "전북"), ("전라북도", "전북"),
    ("서울특별시", "서울"), ("강원특별자치도", "강원"), ("강원도", "강원"),
    ("인천광역시", "인천"), ("충청남도", "충남"), ("제주특별자치도", "제주"),
    ("경상남도", "경남"), ("전라남도", "전남"), ("충청북도", "충북"),
    ("부산", "부산"), ("광주", "광주"), ("대전", "대전"), ("울산", "울산"), ("세종", "세종"),
]

# 지원청명 → 시군구 추론 (경북 등 시군구 컬럼 없는 파일용)
GU_FROM_FILE = [
    ("영양교육", "영양군"), ("울진교육", "울진군"), ("성주교육", "성주군"),
    ("군위교육", "군위군"), ("봉화교육", "봉화군"), ("청도교육", "청도군"),
    ("구미교육", "구미시"), ("문경교육", "문경시"), ("영주교육", "영주시"),
    ("예천교육", "예천군"), ("청송교육", "청송군"), ("경주교육", "경주시"),
    ("상주교육", "상주시"), ("칠곡교육", "칠곡군"), ("포항교육", "포항시"),
    ("의성교육", "의성군"),
]

# 통합 필드 → 후보 컬럼명 (부분일치, 우선순위 순). 위가 더 구체적.
FIELD_ALIASES = {
    "school_name": ["폐교명(문서이관기관)", "폐지학교명", "폐교명", "학교명", "구분(폐교명)"],
    "closure_year": ["폐교연도", "폐교년도", "폐교년월일", "폐교일자"],
    "sido_col": ["시도명", "시·도", "시도"],
    "sigungu_col": ["시군구명", "지역명", "시군구"],
    "school_level": ["학교급구분명", "학교급명", "급별", "학교급"],
    "usage_status": ["활용현황구분명", "활용현황(구분)", "활용현황", "활용 구분", "활용구분",
                      "관리현황", "활용여부", "활용계획", "이용현황", "향후계획", "폐교상태", "활용"],
    "usage_detail": ["활용현황(세부내역)", "활용_사용 현황", "세부내역", "활용용도",
                      "대부활용 세부내역", "대부용도", "매각용도", "용도"],
    "land_area": ["토지대부면적", "토지면적", "토지 면적", "부지면적", "교지면적", "대지", "대 지", "토지"],
    "building_area": ["건물대부면적", "건물연면적", "건물 연면적", "건축연면적", "건물면적", "건축면적"],
    "road_address": ["소재지도로명주소"],
    "jibun_address": ["소재지지번주소", "소재지", "주소"],
    "contact": ["담당자 전화번호", "전화번호", "담당자 부서명"],
    "sale_price": ["매각금액"],
    "rent_price": ["연간대부료", "대부료"],
}


def detect_encoding(path: Path):
    for enc in ["utf-8-sig", "cp949", "euc-kr", "utf-8"]:
        try:
            with open(path, encoding=enc, newline="") as h:
                h.read()
            return enc
        except UnicodeDecodeError:
            continue
    return "cp949"


def read_rows(path: Path):
    """인코딩 자동감지 + 최후수단 errors=replace. xlsx(확장자만 csv)도 처리."""
    # 일부 공공데이터는 확장자만 .csv고 실제론 xlsx(ZIP) — 시그니처로 판별
    head = path.read_bytes()[:4]
    if head[:2] == b"PK":
        return read_xlsx(path), "xlsx"
    enc = detect_encoding(path)
    try:
        with open(path, encoding=enc, newline="") as h:
            return list(csv.DictReader(h)), enc
    except UnicodeDecodeError:
        with open(path, encoding=enc, errors="replace", newline="") as h:
            return list(csv.DictReader(h)), enc


def read_xlsx(path: Path):
    """xlsx → DictReader 호환 list[dict]."""
    import io
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    out = []
    for r in rows[1:]:
        d = {header[i]: ("" if v is None else str(v)) for i, v in enumerate(r) if i < len(header)}
        out.append(d)
    return out


def file_id(path: Path) -> str:
    m = re.match(r"(\d+)_", path.name)
    return m.group(1) if m else ""


def infer_sido(path: Path, row: dict, colmap: dict) -> str | None:
    # 1) 시도 컬럼
    if colmap.get("sido_col"):
        v = (row.get(colmap["sido_col"]) or "").strip()
        for k, short in SIDO_SHORT.items():
            if k in v:
                return short
    # 2) 파일명
    name = path.name
    for kw, short in FILENAME_SIDO:
        if kw in name:
            return short
    return None


def infer_sigungu(path: Path, row: dict, colmap: dict) -> str | None:
    if colmap.get("sigungu_col"):
        v = (row.get(colmap["sigungu_col"]) or "").strip()
        if v:
            return v
    for kw, gu in GU_FROM_FILE:
        if kw in path.name:
            return gu
    return None


def map_columns(header: list[str]) -> dict:
    """헤더에서 통합필드 → 실제컬럼명 매핑. 한 컬럼이 두 필드에 안 쓰이게."""
    colmap = {}
    claimed = set()
    for field, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            for col in header:
                cn = col.strip()
                if cn in claimed:
                    continue
                if cn == alias or alias in cn:
                    colmap[field] = col
                    claimed.add(col)
                    break
            if field in colmap:
                break
    return colmap


def parse_year(v: str) -> int | None:
    if not v:
        return None
    m = re.search(r"(19|20)\d{2}", str(v))
    return int(m.group(0)) if m else None


def parse_area(v: str) -> float | None:
    if not v:
        return None
    s = re.sub(r"[^\d.]", "", str(v).replace(",", ""))
    if not s or s == ".":
        return None
    try:
        f = float(s)
        return round(f, 1) if f > 0 else None
    except ValueError:
        return None


def parse_price_kwon(v: str) -> int | None:
    """천원 단위 표기 → 원 단위. 상식 범위(10만원~1000억) 밖이면 None (셀 병합 오류 차단)."""
    if not v:
        return None
    s = re.sub(r"[^\d]", "", str(v))
    if not s:
        return None
    won = int(s) * 1000  # 원자료가 천원 단위
    if won < 100_000 or won > 100_000_000_000:  # 10만원 미만 / 1000억 초과 → 오류로 간주
        return None
    return won


def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s not in ("-", "—", "없음", "해당없음") else None


def process_standard(path: Path, records: list):
    fid = file_id(path)
    rows, enc = read_rows(path)
    if not rows:
        return 0
    colmap = map_columns(list(rows[0].keys()))
    n = 0
    for row in rows:
        name = clean(row.get(colmap.get("school_name", ""), ""))
        if not name:
            continue
        sido = infer_sido(path, row, colmap)
        rec = {
            "school_name": name,
            "sido": sido,
            "sigungu": infer_sigungu(path, row, colmap),
            "closure_year": parse_year(row.get(colmap.get("closure_year", ""), "")),
            "school_level": clean(row.get(colmap.get("school_level", ""), "")),
            "usage_status": clean(row.get(colmap.get("usage_status", ""), "")),
            "usage_detail": clean(row.get(colmap.get("usage_detail", ""), "")),
            "land_area": parse_area(row.get(colmap.get("land_area", ""), "")),
            "building_area": parse_area(row.get(colmap.get("building_area", ""), "")),
            "road_address": clean(row.get(colmap.get("road_address", ""), "")),
            "jibun_address": clean(row.get(colmap.get("jibun_address", ""), "")),
            "contact": clean(row.get(colmap.get("contact", ""), "")),
            "sale_price_kwon": parse_price_kwon(row.get(colmap.get("sale_price", ""), "")),
            "rent_price_kwon": parse_price_kwon(row.get(colmap.get("rent_price", ""), "")),
            "source_id": fid,
        }
        records.append(rec)
        n += 1
    return n


def process_chungnam(path: Path, records: list):
    """충남 텍스트형: 구분/학교명/관리부서/정보1/정보2/등록일."""
    rows, enc = read_rows(path)
    n = 0
    for row in rows:
        name = clean(row.get("학교명"))
        if not name:
            continue
        detail_parts = [clean(row.get("정보1")), clean(row.get("정보2"))]
        detail = " / ".join([p for p in detail_parts if p]) or None
        rec = {
            "school_name": name,
            "sido": "충남",
            "sigungu": None,
            "closure_year": None,
            "school_level": None,
            "usage_status": clean(row.get("구분")),
            "usage_detail": detail,
            "land_area": None, "building_area": None,
            "road_address": None, "jibun_address": None,
            "contact": clean(row.get("관리부서")),
            "sale_price_kwon": None, "rent_price_kwon": None,
            "source_id": CHUNGNAM_TEXT,
        }
        records.append(rec)
        n += 1
    return n


def merge_records(records: list) -> list:
    """(시도, 학교명) 기준 병합. 더 많은 필드가 채워진 쪽 우선 + 가격정보 합침."""
    def key(r):
        nm = re.sub(r"\s+", "", r["school_name"] or "")
        nm = re.sub(r"(분교장|분교|초등학교|국민학교|중학교|고등학교)$", "", nm)
        return (r["sido"], nm)

    def filled(r):
        return sum(1 for v in r.values() if v not in (None, ""))

    merged = {}
    for r in records:
        k = key(r)
        if k not in merged:
            merged[k] = dict(r)
        else:
            base = merged[k]
            # 더 채워진 레코드를 베이스로
            if filled(r) > filled(base):
                base, r = dict(r), base
                merged[k] = base
            # 빈 필드 채우기 + 가격 보존
            for f, v in r.items():
                if base.get(f) in (None, "") and v not in (None, ""):
                    base[f] = v
    return list(merged.values())


def main():
    records = []
    counts = {}
    for path in sorted(RAW.glob("*.csv")):
        fid = file_id(path)
        if fid in EXCLUDE:
            continue
        try:
            if fid == CHUNGNAM_TEXT:
                c = process_chungnam(path, records)
            else:
                c = process_standard(path, records)
            counts[path.name[:40]] = c
        except Exception as e:
            print(f"[skip] {path.name}: {e}")

    print(f"원시 레코드: {len(records)}건")
    merged = merge_records(records)
    print(f"병합 후: {len(merged)}건")

    # 통계
    by_sido = {}
    by_status = {}
    n_area = n_addr = n_price = 0
    for r in merged:
        by_sido[r["sido"]] = by_sido.get(r["sido"], 0) + 1
        st = r["usage_status"] or "미상"
        by_status[st] = by_status.get(st, 0) + 1
        if r["land_area"] or r["building_area"]:
            n_area += 1
        if r["road_address"] or r["jibun_address"]:
            n_addr += 1
        if r["sale_price_kwon"] or r["rent_price_kwon"]:
            n_price += 1

    out = {
        "records": merged,
        "meta": {
            "total": len(merged),
            "source": "17개 시도교육청 폐교재산 현황 (공공데이터포털)",
            "real": True,
            "fields_filled": {
                "면적": n_area, "주소": n_addr, "가격(매각/대부)": n_price,
            },
            "by_sido": dict(sorted(by_sido.items(), key=lambda kv: -kv[1])),
        },
    }
    (OUT / "listings.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"\nlistings.json: {len(merged)}건")
    print(f"  면적 有 {n_area} · 주소 有 {n_addr} · 가격 有 {n_price}")
    print(f"  시도별: {out['meta']['by_sido']}")


if __name__ == "__main__":
    main()
