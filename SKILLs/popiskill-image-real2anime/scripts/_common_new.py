"""Popiart AI OpenAPI 公共模块：HTTP 请求、鉴权、图片保存等工具函数"""

import base64
import datetime
import json
import os
import re
import struct
import sys
import time
from typing import Optional, Tuple
import urllib.request
import urllib.error

# ========== 配置 ==========
POPI_OPENAPI_URL = os.environ.get("POPI_OPENAPI_URL", "https://llmapitest.popi.art")
API_KEY = os.environ.get("POPI_OPENAPI_KEY", "")

if not API_KEY:
    print("错误：请设置 POPI_OPENAPI_KEY 环境变量", file=sys.stderr)
    print("  export POPI_OPENAPI_KEY=sk-xxxx", file=sys.stderr)
    sys.exit(1)

# 轮询配置
POLL_INTERVAL = 30   # 秒
MAX_WAIT_TIME = 600  # 秒
# ==========================


def headers(content_type="application/json"):
    h = {"Authorization": f"Bearer {API_KEY}"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def post_json(path: str, body: dict, timeout: int = 120) -> dict:
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8") if e.fp else ""
        print(f"❌ HTTP {e.code}: {body_text}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ 网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)


def get_json(path: str, timeout: int = 30) -> dict:
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    req = urllib.request.Request(url, method="GET", headers=headers(content_type=None))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8") if e.fp else ""
        print(f"❌ HTTP {e.code}: {body_text}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ 网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)


def post_multipart(path: str, fields: dict, file_fields: list = None, timeout: int = 30) -> dict:
    """
    multipart/form-data POST。
    fields: {name: value}
    file_fields: [(field_name, filename, bytes, mime_type), ...] 或 None，支持多个同名字段
    """
    import requests as _requests
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    # requests 支持 list of tuples 以传递同名多字段
    files = [(k, (None, v)) for k, v in fields.items()]
    for fname, filename, data, mime in (file_fields or []):
        files.append((fname, (filename, data, mime)))
    resp = _requests.post(url, headers={"Authorization": f"Bearer {API_KEY}"}, files=files, timeout=timeout)
    if resp.status_code != 200:
        print(f"❌ HTTP {resp.status_code}: {resp.text}", file=sys.stderr)
        sys.exit(1)
    return resp.json()


def download_stream(path: str, output_path: str, timeout: int = 120) -> bool:
    """流式下载文件到 output_path，返回是否成功"""
    import requests as _requests
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    resp = _requests.get(url, headers={"Authorization": f"Bearer {API_KEY}"}, stream=True, timeout=timeout)
    if resp.status_code != 200:
        print(f"❌ 下载失败 HTTP {resp.status_code}: {resp.text}", file=sys.stderr)
        return False
    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    print(f"\r   {downloaded/total*100:.1f}%  ({downloaded}/{total} bytes)", end="")
    print()
    return True


def save_base64_image(b64_data: str, prefix: str = "image") -> str:
    """将 base64 图片数据保存为 PNG 文件，返回文件路径"""
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{ts}.png"
    script_dir = os.path.dirname(os.path.abspath(__file__))
    generation_dir = os.path.dirname(script_dir)
    filepath = os.path.join(generation_dir,"generation", filename)
    with open(filepath, "wb") as f:
        f.write(base64.b64decode(b64_data))
    # 输出超链接格式（使用 file:// 协议）
    print(f"\n🔗 点击查看图片: file://{filepath}")
    return filepath



def extract_image_urls(markdown_text: str) -> list:
    """从 markdown 文本中提取图片 URL"""
    return re.findall(r'!\[.*?\]\((https?://[^)]+)\)', markdown_text)


def poll_video(video_id: str) -> Optional[str]:
    """
    轮询视频生成状态，返回最终 task_id（用于下载），失败返回 None。
    网关返回结构：{ code, data: { status, progress, result_url, ... } }
    """
    url = f"/v1/video/generations/{video_id}"
    start = time.time()
    while True:
        elapsed = int(time.time() - start)
        if elapsed > MAX_WAIT_TIME:
            print(f"⏱️  超时：已等待 {MAX_WAIT_TIME}s")
            return None
        result = get_json(url)
        data = result.get("data") or result
        status = data.get("status", "")
        progress = data.get("progress", 0)
        print(f"  [{elapsed:>4}s] status={status}  progress={progress}%")
        if status == "SUCCESS":
            url_result = data.get("result_url", "")
            if url_result:
                print(f"  result_url: {url_result}")
            return data.get("task_id") or video_id
        elif status == "FAILURE":
            print(f"❌ 生成失败: {data.get('fail_reason', '')}")
            return None
        print(f"  等待 {POLL_INTERVAL}s...")
        time.sleep(POLL_INTERVAL)


def ts() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
