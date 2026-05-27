"""환경변수 로더 — .env 파일 또는 OS 환경변수에서 KOSIS_API_KEY 읽기."""
import os
import sys
from pathlib import Path


def _load_dotenv():
    """.env 파일이 있으면 환경변수로 주입. python-dotenv 의존성 없이 최소 구현."""
    root = Path(__file__).resolve().parent.parent
    env_path = root / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def get_kosis_key() -> str:
    _load_dotenv()
    key = os.environ.get("KOSIS_API_KEY", "").strip()
    if not key:
        print(
            "ERROR: KOSIS_API_KEY 환경변수가 설정되지 않았습니다.\n"
            "  1) school_closure_site/.env 파일에 KOSIS_API_KEY=... 한 줄 추가\n"
            "  2) 또는 셸에서: set KOSIS_API_KEY=... (Windows) / export KOSIS_API_KEY=... (Mac/Linux)\n"
            "  3) 키 발급: https://kosis.kr/openapi → 마이페이지 → 인증키 신청",
            file=sys.stderr,
        )
        sys.exit(1)
    return key
