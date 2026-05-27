"""
KOSIS API 키 진단 + 알려진 교육 통계표 직접 시도.
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import get_kosis_key

KEY = get_kosis_key()
OUT = Path(__file__).resolve().parent.parent / "assets" / "data" / "_kosis_raw"
OUT.mkdir(parents=True, exist_ok=True)


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def try_param(org: str, tbl: str, **extra):
    base = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
    q = {
        "method": "getList",
        "apiKey": KEY,
        "format": "json",
        "jsonVD": "Y",
        "prdSe": "Y",
        "newEstPrdCnt": "10",
        "orgId": org,
        "tblId": tbl,
        "itmId": "ALL",
        "objL1": "ALL",
        "objL2": "", "objL3": "", "objL4": "", "objL5": "",
    }
    q.update(extra)
    url = f"{base}?{urllib.parse.urlencode(q)}"
    try:
        raw = get(url)
        return raw.decode("utf-8")
    except Exception as e:
        return f"ERR:{e}"


# 다양한 알려진 후보
candidates = [
    # 교육기본통계 (한국교육개발원, KEDI)
    ("334", "DT_1963003_007"),
    ("334", "DT_1963003_001"),
    ("334", "DT_1963003_002"),
    ("334", "DT_1963003_S0035"),
    ("1963003", "DT_1963003_007"),
    ("1963003", "DT_1YL15011E"),
    ("1963003", "DT_1YL15001E"),
    # 학교급별 시도별 교원
    ("334", "DT_1YL12701"),
    ("334", "DT_1YL12001"),
    ("334", "DT_1YL12101"),
    # 임용
    ("334", "DT_1YL15011E"),
    ("334", "DT_1YL21071E"),
    # KOSIS 인기
    ("101", "DT_1IN1502"),  # 인구
    ("101", "DT_1B040A3"),  # 추계인구
    # 시군구 교원
    ("334", "DT_1YL16001"),
    ("334", "DT_1YL17001"),
    ("334", "DT_1YL15001E"),
]

print(f"KOSIS API key: {KEY[:20]}...")
print(f"\n=== {len(candidates)} 후보 시도 ===\n")
for org, tbl in candidates:
    body = try_param(org, tbl)
    head = body[:200].replace("\n", " ")
    if '"err"' in body:
        # 에러 메시지 표시
        try:
            j = json.loads(body)
            err = j.get("err"); msg = j.get("errMsg")
            print(f"  [{org:>8} / {tbl:<22}] err={err} msg={msg}")
        except Exception:
            print(f"  [{org:>8} / {tbl:<22}] raw={head}")
    elif body.startswith("[") or body.startswith("{"):
        try:
            j = json.loads(body)
            if isinstance(j, list) and j and isinstance(j[0], dict):
                print(f"  [{org:>8} / {tbl:<22}] OK rows={len(j)} sample_keys={list(j[0].keys())[:5]}")
                (OUT / f"{org}_{tbl}.json").write_text(body, encoding="utf-8")
            else:
                print(f"  [{org:>8} / {tbl:<22}] strange json: {head}")
        except Exception as e:
            print(f"  [{org:>8} / {tbl:<22}] parse err: {e}")
    else:
        print(f"  [{org:>8} / {tbl:<22}] non-json: {head}")
