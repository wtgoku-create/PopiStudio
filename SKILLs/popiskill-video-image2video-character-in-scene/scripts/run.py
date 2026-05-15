#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Character-in-scene local batch workflow."""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SKILL_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = SKILL_DIR / "config"
BASE_OUTPUT_DIR = Path.cwd() / "generation"

POPI_ENDPOINT = "https://server.popi.art/v1"
IMG2IMG_MODEL_PRIMARY = "gemini-3-pro-image-preview"
IMG2IMG_MODEL_FALLBACK = "gemini-3.1-flash-image-preview"
VIDEO_MODEL_PRIMARY = "viduq3-turbo"
VIDEO_MODEL_FALLBACK = "viduq2-pro-fast"
DEFAULT_CHAR_NAME = "爱丽丝 / Alice"
DEFAULT_CHAR_URL = "https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg"
RECHARGE_URL = "https://skillhub.popi.art"
PRIMARY_MODEL_MAX_ATTEMPTS = 2
FALLBACK_MODEL_MAX_ATTEMPTS = 2
POLL_INTERVAL_SECONDS = 10
IMAGE_POLL_TIMEOUT_SECONDS = 120
VIDEO_POLL_TIMEOUT_SECONDS = 300
SERVICE_PROVIDER_ISSUE_HINT = "主选模型 2 次失败且备选模型 2 次失败，当前更像是服务商侧问题，请稍后重试或联系服务商。"

SCENE_SUMMARY_MAP = {
    1: {"zh": "温暖自然光的客厅，适合放松日常感。", "en": "A cozy living room with soft daylight."},
    2: {"zh": "安静卧室，适合晨起或休息感画面。", "en": "A calm bedroom for waking-up or resting scenes."},
    3: {"zh": "明亮厨房，适合做饭或备餐片段。", "en": "A bright kitchen for cooking or meal-prep scenes."},
    4: {"zh": "城市公园步道，适合散步和外出镜头。", "en": "An urban park for walking and outdoor shots."},
    5: {"zh": "居民街道，适合生活化街拍。", "en": "A neighborhood street for daily lifestyle footage."},
    6: {"zh": "购物中心内部，适合逛街内容。", "en": "A shopping mall interior for browsing and shopping clips."},
    7: {"zh": "舒适咖啡馆，适合坐下休息或聊天感。", "en": "A cozy cafe for relaxed stay-and-chat moments."},
    8: {"zh": "超市场景，适合买东西的生活化镜头。", "en": "A supermarket for practical shopping footage."},
    9: {"zh": "现代办公室，适合工作或职业感场景。", "en": "A modern office for work-focused scenes."},
    10: {"zh": "安静图书馆，适合阅读和学习感。", "en": "A quiet library for reading and study scenes."},
    11: {"zh": "地铁车厢，适合通勤感画面。", "en": "A subway car for commute-style clips."},
    12: {"zh": "车内视角，适合路上随拍内容。", "en": "A car interior for on-the-road footage."},
    13: {"zh": "医院候诊区，适合等待情境。", "en": "A hospital waiting area for seated waiting scenes."},
    14: {"zh": "健身房空间，适合运动主题。", "en": "A gym for fitness-related scenes."},
    15: {"zh": "理发店环境，适合造型或整理镜头。", "en": "A barbershop for grooming-style scenes."},
}


def format_user_error(message: str) -> str:
    if "InsufficientBalance" in message or "余额不足" in message:
        return f"{message}\n余额不足，请前往 {RECHARGE_URL} 充值后再继续。"
    return message


def ensure_auth_ready():
    result = run_cmd([
        "popiart", "--endpoint", POPI_ENDPOINT,
        "auth", "whoami"
    ], check=False)
    if not result.get("ok"):
        error = result.get("error", {})
        message = error.get("message") or result.get("stderr") or result.get("raw") or "未通过 PopiArt 鉴权检查。"
        raise RuntimeError(
            format_user_error(
                "PopiArt 鉴权检查失败，请先确认当前终端已完成 `popiart auth login --key <product-key>`，"
                "然后重新运行。\n"
                f"原始错误: {message}"
            )
        )


def load_scenes() -> list:
    with open(CONFIG_DIR / "scenes.json", "r", encoding="utf-8-sig") as fh:
        return json.load(fh)["scenes"]


def scene_map() -> dict:
    return {scene["id"]: scene for scene in load_scenes()}


def format_scene_catalog_summary(max_items: int | None = None) -> list[str]:
    scenes = load_scenes()
    if max_items is not None:
        scenes = scenes[:max_items]
    lines = ["可选场景 / Available Scenes:"]
    for scene in scenes:
        summary = SCENE_SUMMARY_MAP.get(scene["id"], {"zh": "", "en": ""})
        lines.append(f"[{scene['id']:02d}] {scene['name']} / {scene.get('name_en', scene['name'])}")
        lines.append(f"  简述 / Summary: {summary['zh']} / {summary['en']}")
        lines.append(f"  默认动作 / Default Action: {scene.get('default_action', '')}")
    lines.append(f"默认角色 / Default Character: {DEFAULT_CHAR_NAME}")
    lines.append(f"角色预览 / Character Preview: {DEFAULT_CHAR_URL}")
    lines.append("推荐组合 / Suggested Scene Sets:")
    lines.append("Vlog日常: 1,3,4,6（客厅、厨房、公园、商场）")
    lines.append("工作日记: 9,7,11（办公室、咖啡馆、地铁）")
    lines.append("生活记录: 2,4,7,10（卧室、公园、咖啡馆、图书馆）")
    lines.append("你可以直接回复场景 ID，例如 1,4,7")
    lines.append("也可以回复“查看全部场景”再次展示场景表")
    lines.append("也可以回复“新增场景：<描述>”来提出新的自定义场景")
    return lines


def normalize_scene_ids(raw_scenes: str) -> list[int]:
    normalized = raw_scenes.replace("，", ",").replace(" ", ",")
    tokens = [token.strip() for token in normalized.split(",") if token.strip()]
    if not tokens:
        raise ValueError("未提供有效的场景 ID。")
    valid_ids = {scene["id"] for scene in load_scenes()}
    scene_ids = []
    for token in tokens:
        try:
            scene_id = int(token)
        except ValueError as exc:
            raise ValueError(f"场景 ID 无效: {token}") from exc
        if scene_id not in valid_ids:
            raise ValueError(f"场景 ID 不存在: [{scene_id:02d}]。请按展示的序号选择。")
        scene_ids.append(scene_id)
    return scene_ids


def parse_scene_character_prompts(raw_value: str) -> dict[int, str]:
    if not raw_value:
        return {}
    text = raw_value.strip()
    possible_path = Path(text)
    if possible_path.exists() and possible_path.is_file():
        text = possible_path.read_text(encoding="utf-8")
    data = json.loads(text)
    result = {}
    for key, value in data.items():
        result[int(key)] = str(value).strip()
    return result


def run_cmd(cmd: list[str], cwd: Path | None = None, check: bool = True):
    env = os.environ.copy()
    if sys.platform == "win32":
        ps_parts = ["'" + str(part).replace("'", "''") + "'" for part in cmd]
        command = "& " + " ".join(ps_parts)
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            cwd=str(cwd) if cwd else None,
            shell=False,
            env=env,
        )
    else:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            cwd=str(cwd) if cwd else None,
            shell=False,
            env=env,
        )
    stdout = completed.stdout.decode("utf-8", errors="replace")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    if completed.returncode != 0 and check:
        raise RuntimeError(format_user_error(stderr or stdout or "命令执行失败"))
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"raw": stdout, "stderr": stderr, "returncode": completed.returncode}


def build_provider_issue_error(stage_label: str, last_error: str = "") -> str:
    message = f"{stage_label}。{SERVICE_PROVIDER_ISSUE_HINT}"
    if last_error:
        message += f"\n最后错误: {last_error}"
    return format_user_error(message)


def open_preview_html(html_path: Path):
    resolved = html_path.resolve()
    try:
        if sys.platform == "win32":
            os.startfile(str(resolved))
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(resolved)])
        else:
            subprocess.Popen(["xdg-open", str(resolved)])
        print(f"已自动打开 HTML 预览: {resolved}")
    except Exception as exc:
        print(f"HTML 预览已生成，但自动打开失败: {resolved}")
        print(f"自动打开失败原因: {exc}")


def poll_task_status(job_id: str, timeout: int, interval: int = POLL_INTERVAL_SECONDS) -> dict:
    max_polls = max(1, timeout // interval)
    for poll_index in range(1, max_polls + 1):
        result = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "jobs", "get", job_id], check=False)
        data = result.get("data", {})
        status = str(data.get("status", "unknown")).lower()
        if status == "done":
            artifact_ids = data.get("artifact_ids") or []
            return {"status": "done", "artifact_id": artifact_ids[0] if artifact_ids else None}
        if status in {"failed", "cancelled", "canceled"}:
            return {"status": status, "error": data.get("message") or data.get("error") or "任务失败"}
        if poll_index < max_polls:
            print(f"    轮询进度 {poll_index}/{max_polls}: job {job_id} 仍在处理中")
            time.sleep(interval)
    return {"status": "timeout", "error": f"任务轮询超时: {job_id}"}


def get_public_url(artifact_id: str) -> str:
    for _ in range(45):
        result = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "artifacts", "get", artifact_id], check=False)
        data = result.get("data", result)
        url = data.get("url")
        if url:
            if "/v1/media/" in url and not url.startswith("http"):
                return f"https://server.popi.art{url[url.index('/v1/media/'):] }"
            return url
        time.sleep(2)
    raise RuntimeError(f"无法获取 artifact 公网地址: {artifact_id}")


def resolve_character_image_url(raw_input: str) -> str:
    raw = raw_input.strip()
    if raw.startswith(("https://", "http://")):
        return raw
    local_path = Path(raw).expanduser().resolve()
    if not local_path.exists():
        raise FileNotFoundError(f"角色图片不存在: {local_path}")
    print(f"  上传角色图片: {local_path}")
    result = run_cmd([
        "popiart", "--endpoint", POPI_ENDPOINT,
        "artifacts", "upload", str(local_path), "--role", "source", "--visibility", "public"
    ])
    artifact_id = result.get("data", {}).get("artifact_id")
    if not artifact_id:
        raise RuntimeError(f"角色图片上传失败: {result}")
    return get_public_url(artifact_id)

def upload_image_get_url(image_path: Path) -> str:
    result = run_cmd([
        "popiart", "--endpoint", POPI_ENDPOINT,
        "artifacts", "upload", str(image_path), "--visibility", "public"
    ])
    artifact_id = result.get("data", {}).get("artifact_id")
    if not artifact_id:
        raise RuntimeError(f"图片上传失败: {result}")
    return get_public_url(artifact_id)


def upload_confirmed_image_get_media_url(image_path: Path) -> dict:
    result = run_cmd([
        "popiart", "--endpoint", POPI_ENDPOINT,
        "media", "upload", str(image_path), "--visibility", "public"
    ])
    data = result.get("data", result)
    media_id = data.get("media_id") or data.get("id")
    if not media_id:
        raise RuntimeError(f"确认图片上传失败: {result}")
    return {
        "confirmed_media_id": str(media_id),
        "confirmed_media_url": f"https://server.popi.art/v1/media/{media_id}/content",
    }


def build_img2img_prompt(scene: dict, action: str = "", character_prompt: str = "", outfit_prompt: str = "") -> str:
    action_desc = action or scene.get("default_action", "standing naturally")
    has_outfit_override = bool(character_prompt or outfit_prompt)
    prompt_parts = [
        "Use the reference character image as the identity anchor.",
        "Keep the face, hairstyle, body shape, proportions, and core identity consistent with the reference image.",
        "Do not change the character identity.",
        "Keep the character as a 2D anime-style character in the final result.",
        "Do not turn the character into a realistic human or a fully 3D-rendered character.",
        f"Scene: {scene['prompt']}",
        "Place the 2D character naturally into a 3D environment with clear depth, perspective, and spatial realism.",
        f"Action: {action_desc}",
    ]
    if character_prompt:
        prompt_parts.append(f"Shared outfit and styling note: {character_prompt}")
    if outfit_prompt:
        prompt_parts.append(f"Scene-specific outfit and accessory note: {outfit_prompt}")
    if has_outfit_override:
        prompt_parts.append(
            "For any appearance details not explicitly described in the outfit notes, keep them consistent with the reference image, especially the 2D anime art style."
        )
    prompt_parts.extend([
        "Keep the character clearly 2D with clean anime lineart and/or cel-shading.",
        "Do not convert the character into a realistic or fully 3D-rendered figure.",
        "Integrate the character naturally into a 3D scene with matching lighting, perspective, and spatial depth.",
        "Environment should appear realistic or cinematic, with natural lighting, clear depth, and clean composition.",
        "High detail, visually cohesive.",
    ])
    return " ".join(prompt_parts)


def build_video_prompt(scene_action: str = "") -> str:
    motion = scene_action or "slight breathing, subtle body sway, gentle camera motion"
    return (
        "Keep the character appearance, outfit, and environment stable with the input image. "
        "No face drift, no extra limbs, no distortion. "
        f"Motion: {motion}. Cinematic, natural, smooth movement."
    )


def run_img2img(image_url: str, prompt: str, aspect_ratio: str = "16:9") -> tuple[str, str]:
    last_error = ""
    attempts = [
        (IMG2IMG_MODEL_PRIMARY, PRIMARY_MODEL_MAX_ATTEMPTS, "主选模型"),
        (IMG2IMG_MODEL_FALLBACK, FALLBACK_MODEL_MAX_ATTEMPTS, "备选模型"),
    ]
    for model, max_attempts, label in attempts:
        for attempt in range(1, max_attempts + 1):
            print(f"  图生图尝试: {label} {model} ({attempt}/{max_attempts})")
            try:
                result = run_cmd([
                    "popiart", "--endpoint", POPI_ENDPOINT,
                    "image", "img2img",
                    "--image", image_url,
                    "--prompt", prompt,
                    "--model", model,
                    "--aspect-ratio", aspect_ratio,
                ])
                job_id = result.get("data", {}).get("job_id")
                if not job_id:
                    raise RuntimeError(f"图生图未返回 job_id: {result}")
                poll_result = poll_task_status(job_id, timeout=IMAGE_POLL_TIMEOUT_SECONDS)
                if poll_result.get("status") == "done" and poll_result.get("artifact_id"):
                    return job_id, poll_result["artifact_id"]
                last_error = poll_result.get("error", f"图生图状态异常: {poll_result}")
            except Exception as exc:
                last_error = str(exc)
            print(f"  图生图失败: {last_error}")
    raise RuntimeError(build_provider_issue_error("图生图多次尝试仍失败", last_error))


def submit_video_job(
    image_url: str,
    prompt: str,
    model: str,
    aspect_ratio: str = "16:9",
    duration: str = "3",
) -> dict:
    try:
        result = run_cmd([
            "popiart", "--endpoint", POPI_ENDPOINT,
            "video", "img2video",
            "--image", image_url,
            "--prompt", prompt,
            "--model", model,
            "--duration", duration,
            "--aspect-ratio", aspect_ratio,
        ])
        job_id = result.get("data", {}).get("job_id")
        if not job_id:
            raise RuntimeError(f"图生视频未返回 job_id: {result}")
        return {"job_id": job_id, "model": model}
    except Exception as exc:
        return {"error": str(exc), "model": model}


def download_artifact(artifact_id: str, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_cmd([
        "popiart", "--endpoint", POPI_ENDPOINT,
        "artifacts", "pull", artifact_id, "-o", str(output_path)
    ])


def process_scene_img2img(scene_id: int, char_image_url: str, aspect_ratio: str,
                           action: str = "", character_prompt: str = "",
                           outfit_prompt: str = "", output_dir: Path | None = None) -> dict:
    try:
        scene = scene_map()[scene_id]
        prompt = build_img2img_prompt(scene, action, character_prompt, outfit_prompt)
        print(f"  场景 [{scene_id:02d}] 开始图生图")
        job_id, artifact_id = run_img2img(char_image_url, prompt, aspect_ratio)
        img_url = get_public_url(artifact_id)
        img_path = output_dir / f"img_scene{scene_id:02d}.jpg" if output_dir else None
        if img_path:
            download_artifact(artifact_id, img_path)
        return {
            "scene_id": scene_id,
            "status": "SUCCESS",
            "scene": scene,
            "prompt": prompt,
            "action": action or scene.get("default_action", ""),
            "outfit_prompt": outfit_prompt,
            "job_id": job_id,
            "img_artifact": artifact_id,
            "img_url": img_url,
            "img_path": str(img_path) if img_path else "",
        }
    except Exception as exc:
        return {
            "scene_id": scene_id,
            "status": "ERROR",
            "error": format_user_error(str(exc)),
        }


def process_scene_video(scene_result: dict, clips_dir: Path,
                        scene_action: str = "", custom_prompt: str = "",
                        video_aspect_ratio: str = "16:9",
                        duration: str = "3") -> dict:
    if scene_result.get("status") != "SUCCESS":
        return {
            "scene_id": scene_result.get("scene_id"),
            "status": "ERROR",
            "error": scene_result.get("error", "图片阶段失败，无法继续生成视频"),
        }
    scene_id = scene_result["scene_id"]
    img_url = (
        scene_result.get("confirmed_media_url")
        or scene_result.get("img_url")
        or get_public_url(scene_result["img_artifact"])
    )
    video_prompt = custom_prompt or scene_result.get("video_prompt") or build_video_prompt(scene_action)
    last_error = ""
    attempts = [
        (VIDEO_MODEL_PRIMARY, PRIMARY_MODEL_MAX_ATTEMPTS, "主选模型"),
        (VIDEO_MODEL_FALLBACK, FALLBACK_MODEL_MAX_ATTEMPTS, "备选模型"),
    ]
    for model, max_attempts, label in attempts:
        for attempt in range(1, max_attempts + 1):
            print(f"  图生视频尝试: [{scene_id:02d}] {label} {model} ({attempt}/{max_attempts})")
            job = submit_video_job(
                img_url,
                video_prompt,
                model=model,
                aspect_ratio=video_aspect_ratio,
                duration=duration,
            )
            if job.get("error"):
                last_error = job["error"]
                print(f"  图生视频提交失败: {last_error}")
                continue
            poll_result = poll_task_status(job["job_id"], timeout=VIDEO_POLL_TIMEOUT_SECONDS)
            if poll_result.get("status") == "done" and poll_result.get("artifact_id"):
                clip_path = clips_dir / f"scene{scene_id:02d}.mp4"
                download_artifact(poll_result["artifact_id"], clip_path)
                return {
                    "scene_id": scene_id,
                    "status": "SUCCESS",
                    "job_id": job["job_id"],
                    "artifact_id": poll_result["artifact_id"],
                    "clip_path": str(clip_path),
                    "clip_size": clip_path.stat().st_size / 1024 / 1024 if clip_path.exists() else 0,
                    "video_prompt": video_prompt,
                    "duration": duration,
                }
            last_error = poll_result.get("error", f"图生视频状态异常: {poll_result}")
            print(f"  图生视频失败: {last_error}")
    return {
        "scene_id": scene_id,
        "status": "ERROR",
        "error": build_provider_issue_error("图生视频多次尝试仍失败", last_error),
        "duration": duration,
    }


def concat_clips(clip_paths: list[Path], output_path: Path):
    if not clip_paths:
        raise RuntimeError("没有可拼接的视频片段")
    if len(clip_paths) == 1:
        shutil.copy2(clip_paths[0], output_path)
        return
    list_file = output_path.parent / "concat.txt"
    with open(list_file, "w", encoding="utf-8") as fh:
        for clip in clip_paths:
            fh.write(f"file '{clip.as_posix()}'\n")
    completed = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(output_path)],
        capture_output=True,
        shell=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.decode("utf-8", errors="replace") or "FFmpeg 拼接失败")

def generate_img_preview_html(img_results: list, output_dir: Path, char_url: str, aspect_ratio: str = "16:9") -> str:
    success = [item for item in img_results if item.get("status") == "SUCCESS"]
    failed = [item for item in img_results if item.get("status") != "SUCCESS"]
    cards = []
    for item in success:
        scene = item.get("scene", {})
        scene_name = f"[{item['scene_id']:02d}] {scene.get('name', '')} / {scene.get('name_en', '')}"
        outfit = item.get("outfit_prompt", "")
        outfit_html = f"<div class='meta'>装扮 / Outfit: {outfit}</div>" if outfit else ""
        cards.append(
            f"<article class='card'><div class='media-shell'><button class='zoom-trigger' type='button' data-kind='image' data-src='img_scene{item['scene_id']:02d}.jpg' data-title='{scene_name}'><img src='img_scene{item['scene_id']:02d}.jpg' alt='{scene_name}' /></button></div>"
            f"<h3>{scene_name}</h3><div class='meta'>{item.get('action', '')}</div>{outfit_html}</article>"
        )
    failed_html = ""
    if failed:
        items = "".join(f"<li>[{item['scene_id']:02d}] {item.get('error', '未知错误')}</li>" for item in failed)
        failed_html = f"<section class='failed'><h3>失败场景</h3><ul>{items}</ul></section>"
    html = f"""<!doctype html>
<html lang='zh-CN'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>图片预览</title>
<style>
body {{ font-family: 'Segoe UI', sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:24px; }}
h1,h2,h3,p {{ margin:0; }}
header,section {{ max-width:1280px; margin:0 auto 24px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:18px; }}
.card,.panel,.failed {{ background:#162032; border:1px solid #273449; border-radius:14px; padding:14px; }}
.media-shell {{
  width:100%;
  border-radius:10px;
  border:1px solid #334155;
  background:linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98));
  overflow:auto;
  padding:10px;
}}
.zoom-trigger {{
  display:block;
  width:100%;
  padding:0;
  border:0;
  background:transparent;
  cursor:zoom-in;
}}
.card img {{
  display:block;
  width:100%;
  height:auto;
  border-radius:8px;
  background:#020617;
}}
.lightbox {{
  position:fixed;
  inset:0;
  display:none;
  align-items:center;
  justify-content:center;
  padding:24px;
  background:rgba(2, 6, 23, 0.88);
  z-index:9999;
}}
.lightbox.open {{ display:flex; }}
.lightbox-dialog {{
  width:min(96vw, 1600px);
  max-height:96vh;
  background:#08111f;
  border:1px solid #334155;
  border-radius:16px;
  padding:18px;
}}
.lightbox-head {{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}}
.lightbox-title {{
  color:#e2e8f0;
  font-size:14px;
  line-height:1.4;
}}
.lightbox-close {{
  border:1px solid #475569;
  background:#162032;
  color:#e2e8f0;
  border-radius:10px;
  padding:8px 12px;
  cursor:pointer;
}}
.lightbox-media {{
  display:flex;
  align-items:center;
  justify-content:center;
  max-height:calc(96vh - 110px);
  overflow:auto;
}}
.lightbox-media img,
.lightbox-media video {{
  display:block;
  width:auto;
  max-width:100%;
  height:auto;
  max-height:calc(96vh - 130px);
  border-radius:10px;
  background:#020617;
}}
.card h3 {{ margin-top:10px; font-size:16px; }}
.meta {{ margin-top:6px; color:#94a3b8; font-size:13px; line-height:1.5; }}
ul {{ margin:10px 0 0 18px; }}
</style>
</head>
<body>
<header>
  <h1>图片阶段预览</h1>
  <p class='meta'>本轮为整批图片阶段。只有当全部图片任务都结束后才展示此页面，包括成功任务，以及失败任务在按既定重试规则执行后的最终结果。</p>
  <p class='meta'>图片按真实比例展示，不做固定横竖比裁切。请直接回到对话框继续交互。</p>
  <p class='meta'>角色 / Character: {char_url}</p>
</header>
<section class='panel'>
  <h2>交互说明</h2>
  <p class='meta'>此页面仅用于查看结果。可点击图片放大查看，但所有选择仍需回到对话框中回复。</p>
  <p class='meta'>请回到对话框回复：确认 / 重新生成 1,4 / 替换 7 / 查看全部场景 / 新增场景：描述</p>
</section>
<section class='grid'>
  {''.join(cards)}
</section>
{failed_html}
<div class='lightbox' id='lightbox'>
  <div class='lightbox-dialog'>
    <div class='lightbox-head'>
      <div class='lightbox-title' id='lightbox-title'></div>
      <button class='lightbox-close' id='lightbox-close' type='button'>关闭</button>
    </div>
    <div class='lightbox-media' id='lightbox-media'></div>
  </div>
</div>
<script>
(() => {{
  const lightbox = document.getElementById('lightbox');
  const media = document.getElementById('lightbox-media');
  const title = document.getElementById('lightbox-title');
  const closeBtn = document.getElementById('lightbox-close');
  const close = () => {{
    lightbox.classList.remove('open');
    media.innerHTML = '';
    title.textContent = '';
  }};
  document.querySelectorAll('.zoom-trigger').forEach((button) => {{
    button.addEventListener('click', () => {{
      const kind = button.dataset.kind || 'image';
      const src = button.dataset.src || '';
      const label = button.dataset.title || '';
      title.textContent = label;
      if (kind === 'video') {{
        media.innerHTML = `<video controls autoplay preload="metadata"><source src="${{src}}" type="video/mp4"></video>`;
      }} else {{
        media.innerHTML = `<img src="${{src}}" alt="${{label}}">`;
      }}
      lightbox.classList.add('open');
    }});
  }});
  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (event) => {{
    if (event.target === lightbox) close();
  }});
  document.addEventListener('keydown', (event) => {{
    if (event.key === 'Escape') close();
  }});
}})();
</script>
</body>
</html>"""
    html_path = output_dir / "preview.html"
    html_path.write_text(html, encoding="utf-8")
    return str(html_path)


def generate_video_preview_html(video_results: list, output_dir: Path, final_video: str = "", aspect_ratio: str = "16:9") -> str:
    success = [item for item in video_results if item.get("status") == "SUCCESS"]
    failed = [item for item in video_results if item.get("status") != "SUCCESS"]
    cards = []
    for item in success:
        cards.append(
            f"<article class='card'><div class='media-shell'><button class='zoom-trigger' type='button' data-kind='video' data-src='clips/scene{item['scene_id']:02d}.mp4' data-title='片段 [{item['scene_id']:02d}]'><video controls preload='metadata'><source src='clips/scene{item['scene_id']:02d}.mp4' type='video/mp4'></video></button></div>"
            f"<h3>片段 [{item['scene_id']:02d}]</h3><div class='meta'>{item.get('clip_size', 0):.1f} MB</div></article>"
        )
    final_block = ""
    if final_video and Path(final_video).exists():
        final_name = Path(final_video).name
        final_block = (
            "<section class='panel'><h2>最终拼接视频</h2>"
            f"<div class='media-shell' style='max-width:744px;margin-top:12px;'><button class='zoom-trigger' type='button' data-kind='video' data-src='{final_name}' data-title='最终拼接视频'><video controls preload='metadata' style='max-width:720px;'><source src='{final_name}' type='video/mp4'></video></button></div>"
            f"<p class='meta'>{final_name}</p></section>"
        )
    failed_html = ""
    if failed:
        items = "".join(f"<li>[{item['scene_id']:02d}] {item.get('error', '未知错误')}</li>" for item in failed)
        failed_html = f"<section class='failed'><h3>失败片段</h3><ul>{items}</ul></section>"
    html = f"""<!doctype html>
<html lang='zh-CN'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>视频预览</title>
<style>
body {{ font-family:'Segoe UI',sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:24px; }}
header,section {{ max-width:1280px; margin:0 auto 24px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }}
.card,.panel,.failed {{ background:#162032; border:1px solid #273449; border-radius:14px; padding:14px; }}
.media-shell {{
  width:100%;
  border-radius:10px;
  border:1px solid #334155;
  background:linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98));
  overflow:auto;
  padding:10px;
}}
.zoom-trigger {{
  display:block;
  width:100%;
  padding:0;
  border:0;
  background:transparent;
  cursor:zoom-in;
}}
video {{ display:block; width:100%; height:auto; background:#020617; border-radius:8px; }}
.lightbox {{
  position:fixed;
  inset:0;
  display:none;
  align-items:center;
  justify-content:center;
  padding:24px;
  background:rgba(2, 6, 23, 0.88);
  z-index:9999;
}}
.lightbox.open {{ display:flex; }}
.lightbox-dialog {{
  width:min(96vw, 1600px);
  max-height:96vh;
  background:#08111f;
  border:1px solid #334155;
  border-radius:16px;
  padding:18px;
}}
.lightbox-head {{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}}
.lightbox-title {{
  color:#e2e8f0;
  font-size:14px;
  line-height:1.4;
}}
.lightbox-close {{
  border:1px solid #475569;
  background:#162032;
  color:#e2e8f0;
  border-radius:10px;
  padding:8px 12px;
  cursor:pointer;
}}
.lightbox-media {{
  display:flex;
  align-items:center;
  justify-content:center;
  max-height:calc(96vh - 110px);
  overflow:auto;
}}
.lightbox-media img,
.lightbox-media video {{
  display:block;
  width:auto;
  max-width:100%;
  height:auto;
  max-height:calc(96vh - 130px);
  border-radius:10px;
  background:#020617;
}}
.meta {{ margin-top:8px; color:#94a3b8; font-size:13px; line-height:1.5; }}
ul {{ margin:10px 0 0 18px; }}
</style>
</head>
<body>
<header>
  <h1>视频阶段预览</h1>
  <p class='meta'>本轮为整批视频阶段。只有当全部片段任务都结束后才展示此页面，包括成功片段，以及失败片段在按既定重试规则执行后的最终结果；若满足条件，还会在最终拼接结束后一起展示。</p>
  <p class='meta'>此页面仅用于查看结果，请回到对话框继续交互。</p>
</header>
{final_block}
<section class='panel'>
  <h2>交互说明</h2>
  <p class='meta'>此页面可点击视频放大查看，但所有选择仍需回到对话框中回复。</p>
  <p class='meta'>请回到对话框回复：确认 / 重新生成 1,4</p>
</section>
<section class='grid'>
  {''.join(cards)}
</section>
{failed_html}
<div class='lightbox' id='lightbox'>
  <div class='lightbox-dialog'>
    <div class='lightbox-head'>
      <div class='lightbox-title' id='lightbox-title'></div>
      <button class='lightbox-close' id='lightbox-close' type='button'>关闭</button>
    </div>
    <div class='lightbox-media' id='lightbox-media'></div>
  </div>
</div>
<script>
(() => {{
  const lightbox = document.getElementById('lightbox');
  const media = document.getElementById('lightbox-media');
  const title = document.getElementById('lightbox-title');
  const closeBtn = document.getElementById('lightbox-close');
  const close = () => {{
    lightbox.classList.remove('open');
    media.innerHTML = '';
    title.textContent = '';
  }};
  document.querySelectorAll('.zoom-trigger').forEach((button) => {{
    button.addEventListener('click', () => {{
      const kind = button.dataset.kind || 'video';
      const src = button.dataset.src || '';
      const label = button.dataset.title || '';
      title.textContent = label;
      if (kind === 'image') {{
        media.innerHTML = `<img src="${{src}}" alt="${{label}}">`;
      }} else {{
        media.innerHTML = `<video controls autoplay preload="metadata"><source src="${{src}}" type="video/mp4"></video>`;
      }}
      lightbox.classList.add('open');
    }});
  }});
  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (event) => {{
    if (event.target === lightbox) close();
  }});
  document.addEventListener('keydown', (event) => {{
    if (event.key === 'Escape') close();
  }});
}})();
</script>
</body>
</html>"""
    html_path = output_dir / "video_preview.html"
    html_path.write_text(html, encoding="utf-8")
    return str(html_path)


def format_img_results(img_results: list, run_id: str) -> str:
    success = [item for item in img_results if item.get("status") == "SUCCESS"]
    failed = [item for item in img_results if item.get("status") != "SUCCESS"]
    lines = ["=" * 60, "图片阶段完成", f"运行 ID: {run_id}", f"成功: {len(success)} | 失败: {len(failed)}", "本轮说明：全部图片属于同一批并发阶段，不按单张拆分步骤。", "-" * 60]
    for item in success:
        scene = item.get("scene", {})
        outfit = item.get("outfit_prompt", "")
        extra = f" | 装扮: {outfit}" if outfit else ""
        lines.append(f"[{item['scene_id']:02d}] {scene.get('name', '')} / {scene.get('name_en', '')}{extra}")
    if failed:
        lines.append("失败场景:")
        for item in failed:
            lines.append(f"[{item['scene_id']:02d}] {item.get('error', '未知错误')}")
    lines.append("-" * 60)
    lines.extend(format_scene_catalog_summary())
    return "\n".join(lines)


def format_video_results(video_results: list, run_id: str, final_video: str = "") -> str:
    success = [item for item in video_results if item.get("status") == "SUCCESS"]
    failed = [item for item in video_results if item.get("status") != "SUCCESS"]
    lines = ["=" * 60, "视频阶段完成", f"运行 ID: {run_id}", f"成功: {len(success)} | 失败: {len(failed)}", "本轮说明：全部视频属于同一批并发阶段，全部成功后再进入最终拼接。", "-" * 60]
    for item in success:
        lines.append(f"[{item['scene_id']:02d}] {item.get('clip_path', '')}")
    if failed:
        lines.append("失败片段:")
        for item in failed:
            lines.append(f"[{item['scene_id']:02d}] {item.get('error', '未知错误')}")
    if final_video:
        lines.append(f"最终视频: {final_video}")
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="角色场景融合转视频本地流程")
    parser.add_argument("--character", "-c", help="角色图片 URL 或本地路径；为空时使用默认 Alice")
    parser.add_argument("--scene", "-s", type=int, help="单个场景 ID")
    parser.add_argument("--scenes", type=str, help="多个场景 ID，例如 1,4,7")
    parser.add_argument("--action", "-a", default="", help="统一动作描述")
    parser.add_argument("--character-prompt", default="", help="统一装扮或道具补充，不改变角色身份")
    parser.add_argument("--scene-character-prompts", default="", help="每个场景的装扮 prompt，支持 JSON 字符串或 JSON 文件路径")
    parser.add_argument("--aspect-ratio", default="16:9", help="图片和视频比例")
    parser.add_argument("--workers", "-w", type=int, default=3, help="并发数")
    parser.add_argument("--concat", action="store_true", help="保留兼容参数，视频阶段自动拼接")
    parser.add_argument("--run-id", type=str, help="运行 ID")
    args = parser.parse_args()

    run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = BASE_OUTPUT_DIR / run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    print("预检查: 正在验证 PopiArt 鉴权状态")
    ensure_auth_ready()
    print("预检查通过: PopiArt 鉴权有效")

    if args.character:
        char_url = resolve_character_image_url(args.character)
        print("角色输入方式: 用户提供")
        print(f"角色图片 / Character Image: {args.character}")
    else:
        char_url = DEFAULT_CHAR_URL
        print("角色输入方式: 默认角色")
        print(f"默认角色 / Default Character: {DEFAULT_CHAR_NAME}")
        print(f"角色预览 / Character Preview: {DEFAULT_CHAR_URL}")
        print("角色输入说明: 也可以上传本地图片路径，或直接提交公网 URL。")

    if args.scenes:
        selected_ids = normalize_scene_ids(args.scenes)
    elif args.scene:
        selected_ids = [args.scene]
    else:
        print("未传入场景 ID，先展示可选场景，再随机抽取 2 个场景作为默认示例。")
        for line in format_scene_catalog_summary():
            print(line)
        selected_ids = [scene["id"] for scene in random.sample(load_scenes(), 2)]

    selected_ids = list(dict.fromkeys(selected_ids))
    per_scene_prompts = parse_scene_character_prompts(args.scene_character_prompts)

    print("=" * 60)
    print("场景确认 / Scene Selection")
    for scene_id in selected_ids:
        scene = scene_map()[scene_id]
        extra = per_scene_prompts.get(scene_id, "")
        if extra:
            print(f"[{scene_id:02d}] {scene['name']} / {scene.get('name_en', scene['name'])} | 装扮 / Outfit: {extra}")
        else:
            print(f"[{scene_id:02d}] {scene['name']} / {scene.get('name_en', scene['name'])}")
    print("说明: 即使每个场景装扮不同，也会作为同一批图片一起并发生成，只是在 prompt 中追加每个场景自己的装扮描述。")
    print("=" * 60)

    print(f"\n[Step 1] 整批图片生成开始 ({len(selected_ids)} 个场景，并发 {args.workers})")
    print("本阶段只展示为一个图片步骤；只有当全部图片任务都结束后，才统一输出 HTML 预览，包括成功结果和按既定重试规则结束后的失败结果。")
    img_results = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                process_scene_img2img,
                scene_id,
                char_url,
                args.aspect_ratio,
                args.action,
                args.character_prompt,
                per_scene_prompts.get(scene_id, ""),
                output_dir,
            ): scene_id
            for scene_id in selected_ids
        }
        for future in as_completed(futures):
            result = future.result()
            img_results.append(result)
            marker = "成功" if result.get("status") == "SUCCESS" else "失败"
            print(f"  图片结果 [{result.get('scene_id', 0):02d}]: {marker}")
    img_results.sort(key=lambda item: item.get("scene_id", 0))
    (output_dir / "img_results.json").write_text(json.dumps(img_results, ensure_ascii=False, indent=2), encoding="utf-8")
    html_path = generate_img_preview_html(img_results, output_dir, char_url, args.aspect_ratio)
    open_preview_html(Path(html_path))
    print(format_img_results(img_results, run_id))
    print(f"图片预览 HTML: {Path(html_path).resolve()}")
    print("请在浏览器查看已自动弹出的 HTML 预览，并回到对话框继续交互。")
    print("请在对话框回复：确认 / 重新生成 1,4 / 替换 7 / 查看全部场景 / 新增场景：描述")


if __name__ == "__main__":
    main()
