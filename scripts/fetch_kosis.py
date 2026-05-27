"""
KOSIS Open API로 시도별 교원수·신규임용 후보 통계표 탐색·수집.

전략:
  1. KOSIS Open API 통계표 검색으로 후보 ID 수집 (statisticsList.do)
  2. 후보 표에 대해 시도별 교원수 데이터 호출 시도
  3. 성공 응답 모두 raw로 저장 → 분석 후 가장 적합한 표 선택

KOSIS API 기본 형태:
  https://kosis.kr/openapi/Param/statisticsParameterData.do?
    method=getList&apiKey=KEY&itmId=...&objL1=...&format=json&jsonVD=Y
    &prdSe=Y&newEstPrdCnt=20&orgId=ORG&tblId=TABLE
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import get_kosis_key

KEY = get_kosis_key()
OUT = Path(__file__).resolve().parent.parent / "assets" / "data" / "_kosis_raw"
OUT.mkdir(parents=True, exist_ok=True)


def http_get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def search_tables(keyword: str, vw_cd: str = "MT_ZTITLE", limit: int = 30):
    """KOSIS 통계표 키워드 검색.
    vw_cd: MT_ZTITLE(국내), MT_OTITLE(국제) 등.
    """
    qs = urllib.parse.urlencode({
        "method": "getList",
        "apiKey": KEY,
        "vwCd": vw_cd,
        "parentListId": "",
        "format": "json",
        "jsonVD": "Y",
        "searchNm": keyword,
    })
    url = f"https://kosis.kr/openapi/statisticsList.do?{qs}"
    try:
        raw = http_get(url)
        data = json.loads(raw.decode("utf-8"))
        if isinstance(data, list):
            return data[:limit]
        return [data]
    except Exception as e:
        print(f"[search err] {keyword}: {e}")
        return []


def fetch_table(org_id: str, tbl_id: str, prd_se: str = "Y", n: int = 20,
                obj_l1: str = "ALL", item: str = "ALL") -> dict | list | None:
    qs = urllib.parse.urlencode({
        "method": "getList",
        "apiKey": KEY,
        "itmId": item,
        "objL1": obj_l1,
        "objL2": "", "objL3": "", "objL4": "", "objL5": "",
        "format": "json",
        "jsonVD": "Y",
        "prdSe": prd_se,
        "newEstPrdCnt": str(n),
        "orgId": org_id,
        "tblId": tbl_id,
    })
    url = f"https://kosis.kr/openapi/Param/statisticsParameterData.do?{qs}"
    try:
        raw = http_get(url, timeout=30)
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        return {"err": "http", "msg": str(e)}


def main():
    keywords = [
        "시도별 교원",
        "학교급별 교원",
        "교원수",
        "신규 임용",
        "임용시험",
        "학교 교원",
    ]
    catalog = {}
    for kw in keywords:
        print(f"\n[검색] {kw}")
        results = search_tables(kw)
        for r in results[:20]:
            tid = r.get("TBL_ID") or r.get("tblId")
            oid = r.get("ORG_ID") or r.get("orgId")
            nm = r.get("TBL_NM") or r.get("tblNm") or r.get("TBL_NM_ENG")
            if tid and tid not in catalog:
                catalog[tid] = {"org": oid, "name": nm, "kw": kw}
                print(f"  - {tid} ({oid}) {nm}")
    (OUT / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n저장: {len(catalog)}개 후보 → {OUT/'catalog.json'}")

    print("\n[수집 시도] 상위 후보 fetch")
    hits = 0
    for tid, meta in list(catalog.items())[:30]:
        oid = meta["org"]
        if not oid:
            continue
        data = fetch_table(oid, tid)
        ok = isinstance(data, list) and data and isinstance(data[0], dict) and "DT" in data[0]
        marker = "OK" if ok else "skip"
        print(f"  [{marker}] {oid}/{tid}  {meta['name']}")
        if ok:
            hits += 1
            safe = f"{oid}_{tid}".replace("/", "_")
            (OUT / f"{safe}.json").write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )
    print(f"\n실데이터 받은 표: {hits}개")


if __name__ == "__main__":
    main()
