# 배포 가이드 — GitHub Pages

## 0. 보안 점검 (배포 전 필수)

- [ ] `.env`는 절대 커밋하지 않는다 (`.gitignore`로 제외됨)
- [ ] `git ls-files | grep .env` → 빈 결과여야 함
- [ ] 파이썬 스크립트 안에 `KOSIS_API_KEY=` 같은 하드코딩 없음 확인:
  ```bash
  grep -r "KOSIS_API_KEY=" --include="*.py"  # .env.example 제외하면 0건이어야 함
  ```
- [ ] 만약 과거에 키를 한 번이라도 커밋했다면 **반드시 키를 재발급** 받을 것
  (git history에 남아 영구히 검색 가능. `git filter-repo` 로 지워도 GitHub 캐시 + 포크는 회수 못 함)

## 1. 첫 푸시

```bash
cd school_closure_site
git init
git add .
git status         # .env가 목록에 없는지 다시 확인!
git commit -m "initial: 폐교 인터랙티브 아틀라스"
git branch -M main
git remote add origin https://github.com/USER/REPO.git
git push -u origin main
```

## 2. GitHub Pages 활성화

1. GitHub 레포 → **Settings** → 좌측 **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main`, Folder: `/ (root)`
4. **Save**
5. 1~2분 뒤 `https://USER.github.io/REPO/` 에서 접근 가능

## 3. 사이트 작동 원리 (왜 키가 필요 없는가)

- 빌드 시 (로컬): `scripts/build_site_data.py` 가 KOSIS API + 폐교 CSV → `assets/data/*.json`
- 런타임 (브라우저): 정적 JSON만 `fetch()` 로 읽음 — API 호출 없음
- 결과: **배포된 사이트는 KOSIS 키를 노출하지 않음**. 키는 빌드 머신(로컬)에만 존재.

## 4. 데이터 갱신 워크플로

KOSIS 또는 폐교 데이터가 갱신되면:

```bash
# 로컬에서
cd school_closure_site
python scripts/fetch_kosis.py       # 새 raw 데이터
python scripts/build_site_data.py   # JSON 재생성
git add assets/data/*.json
git commit -m "data: 시도별 인구·폐교 갱신 YYYY-MM-DD"
git push
```

푸시하면 Pages가 자동 재배포 (1~2분).

## 5. 도메인 연결 (선택)

커스텀 도메인을 쓰고 싶다면 Pages 설정 → Custom domain 에 입력하고
DNS에 CNAME 레코드 추가 (`USER.github.io` → 본인 도메인).

## 6. 키 재발급이 필요할 때

만약 `.env`를 실수로 커밋했거나 키가 노출됐다 싶으면:

1. KOSIS 마이페이지 → 인증키 → 삭제 후 재신청
2. 로컬 `.env`의 KOSIS_API_KEY 값을 새 키로 교체
3. (선택) git history에서 흔적 제거:
   ```bash
   pip install git-filter-repo
   git filter-repo --path .env --invert-paths
   git push origin --force --all
   ```
   단, **이미 키는 봇이 봤을 수 있으므로 키 교체가 우선**.

## 7. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| Pages가 404 | Source 미설정 | Settings → Pages 다시 확인 |
| 차트 안 뜸 (로컬) | `file://` fetch 차단 | `python -m http.server 8000` 으로 띄우기 |
| 차트 안 뜸 (배포) | JSON 경로 깨짐 | 브라우저 DevTools Network 탭에서 404 확인. `assets/data/*.json` 가 푸시됐는지 확인 |
| 한반도 지도 안 뜸 | Leaflet CDN 차단 | 인터넷 연결 또는 CSP 정책 확인 |
| `_env.py` import 에러 | 작업 디렉터리 차이 | `cd school_closure_site` 후 실행 |
