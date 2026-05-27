"""
존재하는 표(err=20)의 메타정보 가져와서 objL 구조 파악.
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


def get_meta(org: str, tbl: str, kind: str = "ITM"):
    """kind: ITM(항목), OBJ(분류항목), STAT_TBL_INFO(표 정보)"""
    base = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
    q = {
        "method": "getList",
        "apiKey": KEY,
        "format": "json",
        "jsonVD": "Y",
        "type": kind,
        "orgId": org,
        "tblId": tbl,
    }
    url = f"{base}?{urllib.parse.urlencode(q)}"
    try:
        raw = get(url)
        return raw.decode("utf-8")
    except Exception as e:
        return f"ERR:{e}"


candidates_real = [
    ("334", "DT_1963003_001"),
    ("334", "DT_1963003_002"),
    ("334", "DT_1963003_007"),
]

for org, tbl in candidates_real:
    print(f"\n=== {org}/{tbl} ===")
    for kind in ["STAT_TBL_INFO", "ITM", "OBJ"]:
        body = get_meta(org, tbl, kind)
        try:
            j = json.loads(body)
            if isinstance(j, dict) and j.get("err"):
                print(f"  [{kind}] err={j['err']} {j.get('errMsg','')}")
            elif isinstance(j, list):
                print(f"  [{kind}] rows={len(j)}")
                for r in j[:6]:
                    if isinstance(r, dict):
                        keys = [k for k in r.keys() if "NM" in k or "ID" in k][:6]
                        print(f"     {' | '.join([f'{k}={r.get(k)}' for k in keys])}")
            else:
                print(f"  [{kind}] {body[:200]}")
        except Exception as e:
            print(f"  [{kind}] parse err: {e}, body={body[:120]}")

    # raw 저장
    (OUT / f"meta_{tbl}.json").write_text(get_meta(org, tbl, "OBJ"), encoding="utf-8")
