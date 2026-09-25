#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
import subprocess
import sys
from pathlib import Path
from urllib import request

API_URL = "https://api.upstage.ai/v1/document-digitization"


def get_api_key() -> str:
    key = os.environ.get("UPSTAGE_API_KEY", "").strip()
    if key:
        return key

    cache_path = Path.home() / ".cache" / "upstage_api_key"
    if cache_path.exists():
        key = cache_path.read_text(encoding="utf-8").strip()
        if key:
            return key

    try:
        out = subprocess.run(
            ["zsh", "-lc", "source ~/.zshrc >/dev/null 2>&1; printenv UPSTAGE_API_KEY"],
            check=True,
            capture_output=True,
            text=True,
        )
        key = out.stdout.strip()
        if key:
            return key
    except Exception:
        pass
    raise RuntimeError("UPSTAGE_API_KEY not found in env, ~/.cache/upstage_api_key, or ~/.zshrc")


def main():
    ap = argparse.ArgumentParser(description="Run Upstage OCR on a local file")
    ap.add_argument("file")
    ap.add_argument("--model", default="ocr")
    ap.add_argument("--text-only", action="store_true")
    args = ap.parse_args()

    file_path = Path(args.file).expanduser().resolve()
    if not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")

    api_key = get_api_key()

    boundary = "----OpenClawUpstageOCRBoundary"
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    file_bytes = file_path.read_bytes()

    body = b"".join([
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="model"\r\n\r\n',
        args.model.encode("utf-8"),
        b"\r\n",
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="document"; filename="{file_path.name}"\r\n'.encode("utf-8"),
        f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])

    req = request.Request(
        API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    with request.urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if args.text_only:
        print(payload.get("text", ""))
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
