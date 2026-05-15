"""Popiart AI OpenAPI 公共模块：HTTP 请求、鉴权、图片保存、以及 popiart runtime 辅助函数"""

import base64
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from typing import Optional
import urllib.error
import urllib.request

POPI_OPENAPI_URL = (
    os.environ.get("POPI_OPENAPI_URL")
    or os.environ.get("POPIART_ENDPOINT")
    or "https://llmapi.popi.art"
)

API_KEY = (
    os.environ.get("POPIART_KEY")
    or os.environ.get("POPIART_TOKEN")
    or os.environ.get("POPI_OPENAPI_KEY", "")
)

POLL_INTERVAL = 30
MAX_WAIT_TIME = 600
RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}
RETRY_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 3
RECHARGE_URL = "https://skillhub.popi.art/home"


def _is_valid_api_key(value: str) -> bool:
    return isinstance(value, str) and value.startswith(
        ("sk_", "sk-", "pk_", "pk-", "sess_", "sess-")
    )


def _print_login_guidance() -> None:
    print("错误：需要有效的 API Key，请先登录 popiart CLI。", file=sys.stderr)
    print("  推荐方式：popiart auth login --key <product-key>", file=sys.stderr)
    print(
        "  也可设置环境变量：POPIART_KEY=<product-key>（兼容别名：POPI_OPENAPI_KEY）",
        file=sys.stderr,
    )
    print(f"  Key 申请与充值地址：{RECHARGE_URL}", file=sys.stderr)


def _print_balance_guidance() -> None:
    print(f"余额不足，请前往 {RECHARGE_URL} 充值后再继续。", file=sys.stderr)


if not API_KEY:
    config_path = os.path.expanduser("~/.popiart/config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            key = cfg.get("token", "") or cfg.get("key", "") or cfg.get("api_key", "")
            if _is_valid_api_key(key):
                API_KEY = key
    except Exception:
        pass

if not _is_valid_api_key(API_KEY):
    _print_login_guidance()
    sys.exit(1)


def headers(content_type: str = "application/json") -> dict:
    result = {"Authorization": f"Bearer {API_KEY}"}
    if content_type:
        result["Content-Type"] = content_type
    return result


def _should_retry_http(code: int, body_text: str) -> bool:
    return code in RETRYABLE_HTTP_CODES or "upstream_error" in body_text.lower()


def post_json(path: str, body: dict, timeout: int = 120) -> dict:
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        req = urllib.request.Request(url, data=data, method="POST", headers=headers())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8") if exc.fp else ""
            if "InsufficientBalance" in body_text or "余额不足" in body_text:
                _print_balance_guidance()
                print(f"❌ HTTP {exc.code}: {body_text}", file=sys.stderr)
                sys.exit(1)
            if attempt < RETRY_ATTEMPTS and _should_retry_http(exc.code, body_text):
                print(
                    f"Retrying after HTTP {exc.code} in {RETRY_DELAY_SECONDS}s ({attempt}/{RETRY_ATTEMPTS})",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            print(f"❌ HTTP {exc.code}: {body_text}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            if attempt < RETRY_ATTEMPTS:
                print(
                    f"Retrying after network error in {RETRY_DELAY_SECONDS}s ({attempt}/{RETRY_ATTEMPTS}): {exc.reason}",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            print(f"❌ 网络错误: {exc.reason}", file=sys.stderr)
            sys.exit(1)


def get_json(path: str, timeout: int = 30) -> dict:
    url = f"{POPI_OPENAPI_URL.rstrip('/')}{path}"
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        req = urllib.request.Request(url, method="GET", headers=headers(content_type=None))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8") if exc.fp else ""
            if "InsufficientBalance" in body_text or "余额不足" in body_text:
                _print_balance_guidance()
                print(f"❌ HTTP {exc.code}: {body_text}", file=sys.stderr)
                sys.exit(1)
            if attempt < RETRY_ATTEMPTS and _should_retry_http(exc.code, body_text):
                print(
                    f"Retrying after HTTP {exc.code} in {RETRY_DELAY_SECONDS}s ({attempt}/{RETRY_ATTEMPTS})",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            print(f"❌ HTTP {exc.code}: {body_text}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            if attempt < RETRY_ATTEMPTS:
                print(
                    f"Retrying after network error in {RETRY_DELAY_SECONDS}s ({attempt}/{RETRY_ATTEMPTS}): {exc.reason}",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            print(f"❌ 网络错误: {exc.reason}", file=sys.stderr)
            sys.exit(1)


def save_base64_image(b64_data: str, prefix: str = "image") -> str:
    ts_value = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{ts_value}.png"
    script_dir = os.path.dirname(os.path.abspath(__file__))
    generation_dir = os.path.join(os.path.dirname(script_dir), "generation")
    os.makedirs(generation_dir, exist_ok=True)
    filepath = os.path.join(generation_dir, filename)
    with open(filepath, "wb") as f:
        f.write(base64.b64decode(b64_data))
    print(f"\n🔗 点击查看图片: file://{filepath}")
    return filepath


def extract_image_urls(markdown_text: str) -> list[str]:
    return re.findall(r"!\[.*?\]\((https?://[^)]+)\)", markdown_text)


def _decode_subprocess_output(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gbk", errors="replace")


def run_popiart_json(args: list[str], timeout: int = 300) -> dict:
    cmd = ["popiart", *args]
    if sys.platform == "win32":
        ps_parts = ["'" + str(part).replace("'", "''") + "'" for part in cmd]
        command = "& " + " ".join(ps_parts)
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            timeout=timeout,
            shell=False,
        )
    else:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, shell=False)

    stdout = _decode_subprocess_output(result.stdout)
    stderr = _decode_subprocess_output(result.stderr)
    combined = (stdout + "\n" + stderr).strip()

    if "InsufficientBalance" in combined or "余额不足" in combined:
        _print_balance_guidance()

    if result.returncode != 0:
        print(f"❌ popiart 命令失败: {' '.join(cmd)}", file=sys.stderr)
        if combined:
            print(combined, file=sys.stderr)
        sys.exit(1)

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        print(f"❌ popiart 输出不是合法 JSON: {stdout}", file=sys.stderr)
        sys.exit(1)


def upload_image_artifact(image_path: str) -> str:
    resp = run_popiart_json(["artifacts", "upload", image_path, "--role", "source"])
    data = resp.get("data", resp)
    artifact_id = data.get("artifact_id") or data.get("id")
    if not artifact_id:
        print(f"❌ artifacts upload 未返回 artifact_id: {json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)
    return artifact_id


def run_cli_generate(
    prompt: str,
    aspect_ratio: str = "16:9",
    size: str = "2K",
    style: str = "",
    negative_prompt: str = "",
    timeout: int = 600,
) -> dict:
    """使用 popiart image generate CLI 命令文生图"""
    cmd = [
        "image", "generate",
        "--prompt", prompt,
        "--aspect-ratio", aspect_ratio,
        "--wait",
        "--output", "json",
    ]
    if size:
        cmd.extend(["--size", size])
    if style:
        cmd.extend(["--style", style])
    if negative_prompt:
        cmd.extend(["--negative-prompt", negative_prompt])
    return run_popiart_json(cmd, timeout=timeout)


def run_cli_img2img(
    image_path: str,
    prompt: str,
    aspect_ratio: str = "16:9",
    size: str = "2K",
    style: str = "",
    timeout: int = 600,
) -> dict:
    """使用 popiart image img2img CLI 命令生成图片"""
    cmd = [
        "image", "img2img",
        "--image", image_path,
        "--prompt", prompt,
        "--aspect-ratio", aspect_ratio,
        "--wait",
        "--output", "json",
    ]
    if size:
        cmd.extend(["--size", size])
    if style:
        cmd.extend(["--style", style])
    return run_popiart_json(cmd, timeout=timeout)


def run_runtime_img2img(
    source_artifact_id: str,
    prompt: str,
    aspect_ratio: str = "16:9",
    size: str = "2K",
    timeout: int = 600,
) -> dict:
    """兼容旧接口：使用 artifact_id 方式（通过 CLI 的 --source-artifact-id）"""
    cmd = [
        "image", "img2img",
        "--source-artifact-id", source_artifact_id,
        "--prompt", prompt,
        "--aspect-ratio", aspect_ratio,
        "--wait",
        "--output", "json",
    ]
    if size:
        cmd.extend(["--size", size])
    return run_popiart_json(cmd, timeout=timeout)


def _guess_artifact_extension(artifact_id: str) -> str:
    resp = run_popiart_json(["artifacts", "get", artifact_id])
    data = resp.get("data", resp)
    filename = str(data.get("filename") or "")
    _, ext = os.path.splitext(filename)
    return ext or ".png"


def pull_artifact_to_generation(artifact_id: str, script_file: str, prefix: str = "runtime") -> str:
    """从 artifact 拉取图片到 generation 目录"""
    script_dir = os.path.dirname(os.path.abspath(script_file))
    generation_dir = os.path.join(os.path.dirname(script_dir), "generation")
    os.makedirs(generation_dir, exist_ok=True)
    ts_value = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = _guess_artifact_extension(artifact_id)
    out_path = os.path.join(generation_dir, f"{prefix}_{ts_value}{ext}")
    run_popiart_json(["artifacts", "pull", artifact_id, "--out", out_path], timeout=300)
    return out_path


def save_cli_image_result(result: dict, script_file: str, prefix: str = "cli") -> str:
    """从 CLI 返回结果中提取图片并保存到 generation 目录
    
    CLI 返回格式示例：
    {
      "data": {
        "artifact_ids": ["art_xxx"],
        "outputs": [{"artifact_id": "art_xxx", "url": "..."}]
      }
    }
    """
    data = result.get("data", result)
    
    # 尝试获取 artifact_id
    artifact_ids = data.get("artifact_ids", [])
    if not artifact_ids and "outputs" in data:
        # 从 outputs 中提取
        for output in data["outputs"]:
            if "artifact_id" in output:
                artifact_ids.append(output["artifact_id"])
    
    if artifact_ids:
        # 使用 artifacts pull 下载
        return pull_artifact_to_generation(artifact_ids[0], script_file, prefix)
    
    # 如果没有 artifact_id，尝试从 URL 下载
    if "outputs" in data:
        for output in data["outputs"]:
            url = output.get("url") or output.get("image_url")
            if url:
                return download_image_to_generation(url, script_file, prefix)
    
    raise ValueError(f"无法从结果中提取图片: {json.dumps(result, ensure_ascii=False)[:200]}")


def download_image_to_generation(url: str, script_file: str, prefix: str = "cli") -> str:
    """从 URL 下载图片保存到 generation 目录"""
    script_dir = os.path.dirname(os.path.abspath(script_file))
    generation_dir = os.path.join(os.path.dirname(script_dir), "generation")
    os.makedirs(generation_dir, exist_ok=True)
    ts_value = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = ".png" if ".png" in url.lower() else ".jpg"
    out_path = os.path.join(generation_dir, f"{prefix}_{ts_value}{ext}")
    
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        with open(out_path, "wb") as f:
            f.write(resp.read())
    return out_path


def ts() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
