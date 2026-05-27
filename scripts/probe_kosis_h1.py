"""H1=교육 카테고리 트리 탐색."""
import json, urllib.parse, urllib.request, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import get_kosis_key

KEY = get_kosis_key()
OUT = Path(__file__).resolve().parent.parent / "assets" / "data" / "_kosis_raw"
OUT.mkdir(parents=True, exist_ok=True)


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8")


def explore(list_id: str, depth: int = 0, max_depth: int = 4):
    if depth > max_depth:
        return []
    url = (f"https://kosis.kr/openapi/statisticsList.do?method=getList"
           f"&apiKey={KEY}&vwCd=MT_ZTITLE&parentListId={list_id}&format=json&jsonVD=Y")
    try:
        body = get(url)
        j = json.loads(body)
    except Exception as e:
        return []
    if not isinstance(j, list):
        return []

    tables = []
    pad = "  " * depth
    for r in j:
        lid = r.get("LIST_ID")
        tid = r.get("TBL_ID")
        nm = r.get("LIST_NM") or r.get("TBL_NM") or "?"
        org = r.get("ORG_ID")
        if tid:
            # 통계표
            tables.append({"list_id": list_id, "tbl_id": tid, "org_id": org, "name": nm})
            print(f"{pad}TBL {org}/{tid}: {nm}")
        elif lid:
            print(f"{pad}DIR {lid}: {nm}")
            tables.extend(explore(lid, depth + 1, max_depth))
    return tables


print("=== H1 (교육·훈련) 카테고리 트리 ===")
all_tables = explore("H1")
print(f"\n총 {len(all_tables)}개 통계표 발견")

# 키워드 필터: 교원 / 임용 / 시도
hits = [t for t in all_tables if any(k in t["name"] for k in ["교원", "임용", "교사"])]
print(f"\n=== 교원/임용/교사 키워드 매칭: {len(hits)}개 ===")
for t in hits[:30]:
    print(f"  {t['org_id']}/{t['tbl_id']}: {t['name']}")

(OUT / "h1_tree.json").write_text(
    json.dumps(all_tables, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"\n저장: {OUT/'h1_tree.json'}")
