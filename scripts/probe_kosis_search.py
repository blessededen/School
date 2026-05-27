"""
KOSIS 통계표 검색 — statisticsList.do의 정상 호출 형태로 다시 시도.
공식 문서: 조회구분(vwCd)별로 parentListId 트리를 따라 내려가야 함.
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import get_kosis_key

KEY = get_kosis_key()
OUT = Path(__file__).resolve().parent.parent / "assets" / "data" / "_kosis_raw"


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8")


# 1) 주제별 조회구분의 최상위
print("=== vwCd=MT_ZTITLE 최상위 ===")
url = f"https://kosis.kr/openapi/statisticsList.do?method=getList&apiKey={KEY}&vwCd=MT_ZTITLE&parentListId=&format=json&jsonVD=Y"
body = get(url)
try:
    j = json.loads(body)
    if isinstance(j, list):
        for r in j[:40]:
            print(f"  {r.get('LIST_ID')}: {r.get('LIST_NM')}")
    else:
        print(body[:400])
except Exception:
    print(body[:400])

# 2) 교육 카테고리 추정 (검색)
print("\n=== 교육 카테고리 트리 — searchNm 사용 ===")
url = f"https://kosis.kr/openapi/statisticsList.do?method=getList&apiKey={KEY}&vwCd=MT_ZTITLE&searchNm={urllib.parse.quote('교육')}&format=json&jsonVD=Y"
body = get(url)
try:
    j = json.loads(body)
    print(f"  rows: {len(j) if isinstance(j, list) else 'N/A'}")
    if isinstance(j, list):
        for r in j[:30]:
            tid = r.get("TBL_ID") or r.get("LIST_ID")
            nm = r.get("TBL_NM") or r.get("LIST_NM")
            org = r.get("ORG_ID") or "?"
            print(f"  {org}/{tid}: {nm}")
except Exception:
    print(body[:400])
