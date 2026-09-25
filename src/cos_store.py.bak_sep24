"""COS 对象存储封装（可选启用）。

默认关闭：除非 .env 里设置了 USE_COS_STORAGE=true，否则本模块不生效，
后端仍旧读写本地磁盘，完全不影响现有功能。

启用后：
- COS 对象 key = 相对 output/ 的路径（正斜杠分隔），例如
  "cloudsleepgarden/synthesized/gen_x.png"、"cats/cat.png"。
- 提供 put / get_bytes / exists / delete / list_keys / list_meta / download 等能力，供 app.py 调用。
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

_PREVIOUSLY_LOADED = False


def load_env() -> None:
    global _PREVIOUSLY_LOADED
    if _PREVIOUSLY_LOADED:
        return
    try:
        from dotenv import load_dotenv
        root = Path(__file__).resolve().parent.parent
        load_dotenv(root / ".env")
    except Exception:
        pass
    _PREVIOUSLY_LOADED = True


def enabled() -> bool:
    return os.environ.get("USE_COS_STORAGE", "").strip().lower() == "true"


@lru_cache(maxsize=1)
def _client():
    load_env()
    from qcloud_cos import CosConfig, CosS3Client
    cfg = CosConfig(
        Region=os.environ.get("COS_REGION", "ap-hongkong"),
        SecretId=os.environ.get("COS_SECRET_ID", ""),
        SecretKey=os.environ.get("COS_SECRET_KEY", ""),
        Scheme="https",
    )
    return CosS3Client(cfg)


def bucket() -> str:
    load_env()
    return os.environ.get("COS_BUCKET", "")


def exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=bucket(), Key=key)
        return True
    except Exception:
        return False


def get_bytes(key: str) -> bytes:
    resp = _client().get_object(Bucket=bucket(), Key=key)
    return resp["Body"].get_raw_stream().read()


def put(key: str, data: bytes) -> None:
    _client().put_object(Bucket=bucket(), Key=key, Body=data)


def delete(key: str) -> None:
    _client().delete_object(Bucket=bucket(), Key=key)


def list_keys(prefix: str = "") -> list[str]:
    return [k["Key"] for k in list_meta(prefix)]


def list_meta(prefix: str = "") -> list[dict]:
    """返回 [{Key, Size(int), LastModified(datetime or None)}] 列表。"""
    items: list[dict] = []
    marker = ""
    while True:
        params = dict(Bucket=bucket(), MaxKeys=1000, Prefix=prefix)
        if marker:
            params["Marker"] = marker
        r = _client().list_objects(**params)
        for c in r.get("Contents") or []:
            items.append({
                "Key": c["Key"],
                "Size": int(c.get("Size", 0) or 0),
                "LastModified": c.get("LastModified"),
            })
        if str(r.get("IsTruncated")).lower() != "true":
            break
        marker = r.get("NextMarker")
        if not marker:
            break
    return items


def size(key: str) -> int:
    try:
        head = _client().head_object(Bucket=bucket(), Key=key)
        return int(head.get("Content-Length", 0))
    except Exception:
        return 0


def head(key: str) -> dict:
    return _client().head_object(Bucket=bucket(), Key=key)


def download_to(key: str, local_path: Path) -> Path:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(get_bytes(key))
    return local_path


def upload_file(key: str, local_path: Path) -> None:
    size_local = local_path.stat().st_size
    if size_local >= 5 * 1024 * 1024:
        _client().upload_file(Bucket=bucket(), Key=key, LocalFilePath=str(local_path), PartSize=5, MAXThread=5)
    else:
        _client().put_object(Bucket=bucket(), Key=key, Body=local_path.read_bytes())
