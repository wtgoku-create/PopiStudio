#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Image-only workflow for placing a 2D anime character into 3D-world scenes."""

import argparse
import json
import os
import random
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
DEFAULT_CHAR_NAME = "Alice"
DEFAULT_CHAR_URL = "https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg"
RECHARGE_URL = "https://skillhub.popi.art"
PRIMARY_MODEL_MAX_ATTEMPTS = 2
FALLBACK_MODEL_MAX_ATTEMPTS = 2
POLL_INTERVAL_SECONDS = 10
IMAGE_POLL_TIMEOUT_SECONDS = 120
SERVICE_PROVIDER_ISSUE_HINT = (
    "Primary model failed twice and fallback model failed twice. This now looks like a provider-side issue."
)

SCENE_SUMMARY_MAP = {
    1: {"label": "Living Room", "summary": "A cozy living room with soft daylight."},
    2: {"label": "Bedroom", "summary": "A calm bedroom for waking-up or resting scenes."},
    3: {"label": "Kitchen", "summary": "A bright kitchen for cooking or meal-prep scenes."},
    4: {"label": "City Park", "summary": "An urban park for walking and outdoor shots."},
    5: {"label": "Community Street", "summary": "A neighborhood street for daily lifestyle scenes."},
    6: {"label": "Shopping Mall", "summary": "A shopping mall interior for browsing and shopping scenes."},
    7: {"label": "Cafe", "summary": "A cozy cafe for relaxed stay-and-chat moments."},
    8: {"label": "Supermarket", "summary": "A supermarket for practical shopping scenes."},
    9: {"label": "Office", "summary": "A modern office for work-focused scenes."},
    10: {"label": "Library", "summary": "A quiet library for reading and study scenes."},
    11: {"label": "Subway Car", "summary": "A subway car for commute-style scenes."},
    12: {"label": "Car Interior", "summary": "A car interior for on-the-road scenes."},
    13: {"label": "Hospital Waiting Room", "summary": "A hospital waiting area for seated waiting scenes."},
    14: {"label": "Gym", "summary": "A gym for fitness-related scenes."},
    15: {"label": "Barbershop", "summary": "A barbershop for grooming-style scenes."},
}


def format_user_error(message: str) -> str:
    if "InsufficientBalance" in message or "balance" in message.lower():
        return f"{message}\nBalance is insufficient. Recharge at {RECHARGE_URL} and try again."
    return message


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
        raise RuntimeError(format_user_error(stderr or stdout or "Command failed"))
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"raw": stdout, "stderr": stderr, "returncode": completed.returncode}


def ensure_auth_ready():
    whoami = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "auth", "whoami"], check=False)
    if not whoami.get("ok"):
        error = whoami.get("error", {})
        message = error.get("message") or whoami.get("stderr") or whoami.get("raw") or "Auth check failed."
        raise RuntimeError(
            format_user_error(
                "PopiArt auth check failed. Run `popiart auth login --key <product-key>` in this terminal first.\n"
                f"Original error: {message}"
            )
        )

    budget = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "budget", "status"], check=False)
    if budget.get("ok") is False:
        error = budget.get("error", {})
        message = error.get("message") or budget.get("stderr") or budget.get("raw") or "Budget status check failed."
        raise RuntimeError(
            format_user_error(
                "PopiArt balance check failed. Make sure the current key can query budget and has usable balance.\n"
                f"Original error: {message}"
            )
        )

    data = budget.get("data", {}) if isinstance(budget, dict) else {}
    text = json.dumps(data, ensure_ascii=False).lower()
    if any(flag in text for flag in ["insufficient", "exhausted", "no balance", "\"remaining\": 0", "\"available\": 0"]):
        raise RuntimeError(f"PopiArt balance is insufficient. Recharge at {RECHARGE_URL} and try again.")


def load_scenes() -> list[dict]:
    with open(CONFIG_DIR / "scenes.json", "r", encoding="utf-8-sig") as fh:
        return json.load(fh)["scenes"]


def scene_map() -> dict[int, dict]:
    return {scene["id"]: scene for scene in load_scenes()}


def format_scene_catalog_summary(max_items: int | None = None) -> list[str]:
    scenes = load_scenes()
    if max_items is not None:
        scenes = scenes[:max_items]
    lines = ["Available Scenes:"]
    for scene in scenes:
        summary = SCENE_SUMMARY_MAP.get(scene["id"], {"summary": ""})
        label = scene.get("name_en", scene["name"])
        lines.append(f"[{scene['id']:02d}] {scene['name']} / {label}")
        lines.append(f"  Summary: {summary['summary']}")
        lines.append(f"  Default Action: {scene.get('default_action', '')}")
    lines.append(f"Default Character: {DEFAULT_CHAR_NAME}")
    lines.append(f"Character Preview: {DEFAULT_CHAR_URL}")
    lines.append("Suggested Scene Sets:")
    lines.append("Daily vlog: 1,3,4,6")
    lines.append("Work diary: 9,7,11")
    lines.append("Life record: 2,4,7,10")
    lines.append("You can reply directly with scene IDs such as 1,4,7")
    lines.append("You can also reply with 'show all scenes'")
    lines.append("You can also reply with 'new scene: <description>'")
    return lines


def normalize_scene_ids(raw_scenes: str) -> list[int]:
    normalized = raw_scenes.replace("，", ",").replace(" ", ",")
    tokens = [token.strip() for token in normalized.split(",") if token.strip()]
    if not tokens:
        raise ValueError("No valid scene IDs were provided.")
    valid_ids = {scene["id"] for scene in load_scenes()}
    scene_ids = []
    for token in tokens:
        try:
            scene_id = int(token)
        except ValueError as exc:
            raise ValueError(f"Invalid scene ID: {token}") from exc
        if scene_id not in valid_ids:
            raise ValueError(f"Scene ID does not exist: [{scene_id:02d}]")
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
    return {int(key): str(value).strip() for key, value in data.items()}


def build_provider_issue_error(stage_label: str, last_error: str = "") -> str:
    message = f"{stage_label}. {SERVICE_PROVIDER_ISSUE_HINT}"
    if last_error:
        message += f"\nLast error: {last_error}"
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
        print(f"Opened HTML preview automatically: {resolved}")
    except Exception as exc:
        print(f"HTML preview was generated but auto-open failed: {resolved}")
        print(f"Auto-open failure reason: {exc}")


def poll_task_status(job_id: str, timeout: int = IMAGE_POLL_TIMEOUT_SECONDS, interval: int = POLL_INTERVAL_SECONDS) -> dict:
    max_polls = max(1, timeout // interval)
    for poll_index in range(1, max_polls + 1):
        result = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "jobs", "get", job_id], check=False)
        data = result.get("data", {})
        status = str(data.get("status", "unknown")).lower()
        if status == "done":
            artifact_ids = data.get("artifact_ids") or []
            return {"status": "done", "artifact_id": artifact_ids[0] if artifact_ids else None}
        if status in {"failed", "cancelled", "canceled"}:
            error = data.get("message") or data.get("error") or "Task failed"
            return {"status": status, "error": error}
        if poll_index < max_polls:
            print(f"    Poll {poll_index}/{max_polls}: job {job_id} is still running")
            time.sleep(interval)
    return {"status": "timeout", "error": f"Task polling timed out: {job_id}"}


def get_public_url(artifact_id: str) -> str:
    for _ in range(45):
        result = run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "artifacts", "get", artifact_id], check=False)
        data = result.get("data", result)
        url = data.get("url")
        if url:
            if "/v1/media/" in url and not url.startswith("http"):
                return f"https://server.popi.art{url[url.index('/v1/media/'):]}"
            return url
        time.sleep(2)
    raise RuntimeError(f"Could not fetch public artifact URL: {artifact_id}")


def resolve_character_image_url(raw_input: str) -> str:
    raw = raw_input.strip()
    if raw.startswith(("https://", "http://")):
        return raw
    local_path = Path(raw).expanduser().resolve()
    if not local_path.exists():
        raise FileNotFoundError(f"Character image does not exist: {local_path}")
    print(f"  Uploading character image: {local_path}")
    result = run_cmd(
        [
            "popiart",
            "--endpoint",
            POPI_ENDPOINT,
            "artifacts",
            "upload",
            str(local_path),
            "--role",
            "source",
            "--visibility",
            "public",
        ]
    )
    artifact_id = result.get("data", {}).get("artifact_id")
    if not artifact_id:
        raise RuntimeError(f"Character image upload failed: {result}")
    return get_public_url(artifact_id)


def download_artifact(artifact_id: str, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_cmd(["popiart", "--endpoint", POPI_ENDPOINT, "artifacts", "pull", artifact_id, "-o", str(output_path)])


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
    prompt_parts.extend(
        [
            "Keep the character clearly 2D with clean anime lineart and/or cel-shading.",
            "Do not convert the character into a realistic or fully 3D-rendered figure.",
            "Integrate the character naturally into a 3D scene with matching lighting, perspective, and spatial depth.",
            "Environment should appear realistic or cinematic, with natural lighting, clear depth, and clean composition.",
            "High detail, visually cohesive.",
        ]
    )
    return " ".join(prompt_parts)


def run_img2img(image_url: str, prompt: str, aspect_ratio: str = "16:9") -> tuple[str, str]:
    last_error = ""
    attempts = [
        (IMG2IMG_MODEL_PRIMARY, PRIMARY_MODEL_MAX_ATTEMPTS, "primary"),
        (IMG2IMG_MODEL_FALLBACK, FALLBACK_MODEL_MAX_ATTEMPTS, "fallback"),
    ]
    for model, max_attempts, label in attempts:
        for attempt in range(1, max_attempts + 1):
            print(f"  Img2img attempt: {label} model {model} ({attempt}/{max_attempts})")
            try:
                result = run_cmd(
                    [
                        "popiart",
                        "--endpoint",
                        POPI_ENDPOINT,
                        "image",
                        "img2img",
                        "--image",
                        image_url,
                        "--prompt",
                        prompt,
                        "--model",
                        model,
                        "--aspect-ratio",
                        aspect_ratio,
                    ]
                )
                job_id = result.get("data", {}).get("job_id")
                if not job_id:
                    raise RuntimeError(f"Img2img did not return job_id: {result}")
                poll_result = poll_task_status(job_id)
                if poll_result.get("status") == "done" and poll_result.get("artifact_id"):
                    return job_id, poll_result["artifact_id"]
                last_error = poll_result.get("error", f"Unexpected img2img status: {poll_result}")
            except Exception as exc:
                last_error = str(exc)
            print(f"  Img2img failed: {last_error}")
    raise RuntimeError(build_provider_issue_error("Img2img failed after all retries", last_error))


def process_scene_img2img(
    scene_id: int,
    char_image_url: str,
    aspect_ratio: str,
    action: str = "",
    character_prompt: str = "",
    outfit_prompt: str = "",
    output_dir: Path | None = None,
) -> dict:
    try:
        scene = scene_map()[scene_id]
        prompt = build_img2img_prompt(scene, action, character_prompt, outfit_prompt)
        print(f"  Scene [{scene_id:02d}] starting img2img")
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
        return {"scene_id": scene_id, "status": "ERROR", "error": format_user_error(str(exc))}


def generate_img_preview_html(img_results: list[dict], output_dir: Path, char_url: str) -> str:
    success = [item for item in img_results if item.get("status") == "SUCCESS"]
    failed = [item for item in img_results if item.get("status") != "SUCCESS"]
    cards = []
    for item in success:
        scene = item.get("scene", {})
        scene_name = f"[{item['scene_id']:02d}] {scene.get('name')} / {scene.get('name_en', scene.get('name', ''))}"
        outfit = item.get("outfit_prompt", "")
        outfit_html = f"<div class='meta'>Outfit: {outfit}</div>" if outfit else ""
        cards.append(
            f"<article class='card'><div class='media-shell'><button class='zoom-trigger' type='button' data-src='img_scene{item['scene_id']:02d}.jpg' data-title='{scene_name}'><img src='img_scene{item['scene_id']:02d}.jpg' alt='{scene_name}' /></button></div>"
            f"<h3>{scene_name}</h3><div class='meta'>{item.get('action', '')}</div>{outfit_html}</article>"
        )
    failed_html = ""
    if failed:
        items = "".join(f"<li>[{item['scene_id']:02d}] {item.get('error', 'Unknown error')}</li>" for item in failed)
        failed_html = f"<section class='failed'><h3>Failed Scenes</h3><ul>{items}</ul></section>"
    html = f"""<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Image Preview</title>
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
.lightbox-media img {{
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
  <h1>Image Batch Preview</h1>
  <p class='meta'>This page appears only after the full image round finishes, including retry outcomes.</p>
  <p class='meta'>Images keep their natural proportions. Click any image to enlarge it.</p>
  <p class='meta'>Character source: {char_url}</p>
</header>
<section class='panel'>
  <h2>Interaction Notes</h2>
  <p class='meta'>This page is for preview only. All confirmations and next steps still happen in chat.</p>
  <p class='meta'>This skill ends at the image stage.</p>
</section>
<section class='grid'>
  {''.join(cards)}
</section>
{failed_html}
<div class='lightbox' id='lightbox'>
  <div class='lightbox-dialog'>
    <div class='lightbox-head'>
      <div class='lightbox-title' id='lightbox-title'></div>
      <button class='lightbox-close' id='lightbox-close' type='button'>Close</button>
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
      const src = button.dataset.src || '';
      const label = button.dataset.title || '';
      title.textContent = label;
      media.innerHTML = `<img src="${{src}}" alt="${{label}}">`;
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


def format_img_results(img_results: list[dict], run_id: str) -> str:
    success = [item for item in img_results if item.get("status") == "SUCCESS"]
    failed = [item for item in img_results if item.get("status") != "SUCCESS"]
    lines = [
        "=" * 60,
        "Image stage completed",
        f"Run ID: {run_id}",
        f"Success: {len(success)} | Failed: {len(failed)}",
        "This run is one image batch. It does not split into per-image top-level steps.",
        "-" * 60,
    ]
    for item in success:
        scene = item.get("scene", {})
        outfit = item.get("outfit_prompt", "")
        extra = f" | Outfit: {outfit}" if outfit else ""
        lines.append(f"[{item['scene_id']:02d}] {scene.get('name', '')} / {scene.get('name_en', '')}{extra}")
    if failed:
        lines.append("Failed scenes:")
        for item in failed:
            lines.append(f"[{item['scene_id']:02d}] {item.get('error', 'Unknown error')}")
    lines.append("-" * 60)
    lines.extend(format_scene_catalog_summary())
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Local image workflow for placing a 2D character into 3D scenes")
    parser.add_argument("--character", "-c", help="Character image URL or local path. Uses default Alice if omitted.")
    parser.add_argument("--scene", "-s", type=int, help="Single scene ID")
    parser.add_argument("--scenes", type=str, help="Multiple scene IDs, for example 1,4,7")
    parser.add_argument("--action", "-a", default="", help="Shared action text")
    parser.add_argument("--character-prompt", default="", help="Shared styling or prop note without changing character identity")
    parser.add_argument(
        "--scene-character-prompts",
        default="",
        help="Per-scene outfit prompts as a JSON string or JSON file path",
    )
    parser.add_argument("--aspect-ratio", default="16:9", help="Image aspect ratio")
    parser.add_argument("--workers", "-w", type=int, default=3, help="Parallel worker count")
    parser.add_argument("--run-id", type=str, help="Run ID")
    args = parser.parse_args()

    run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = BASE_OUTPUT_DIR / run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Precheck: verifying PopiArt auth and balance")
    ensure_auth_ready()
    print("Precheck passed: auth and balance look usable")

    if args.character:
        char_url = resolve_character_image_url(args.character)
        print("Character input mode: user provided")
        print(f"Character image: {args.character}")
    else:
        char_url = DEFAULT_CHAR_URL
        print("Character input mode: default")
        print(f"Default character: {DEFAULT_CHAR_NAME}")
        print(f"Character preview: {DEFAULT_CHAR_URL}")
        print("You may also provide a local image path or a public URL.")

    if args.scenes:
        selected_ids = normalize_scene_ids(args.scenes)
    elif args.scene:
        selected_ids = [args.scene]
    else:
        print("No scene IDs were provided. Showing the scene catalog, then selecting two sample scenes.")
        for line in format_scene_catalog_summary():
            print(line)
        selected_ids = [scene["id"] for scene in random.sample(load_scenes(), 2)]

    selected_ids = list(dict.fromkeys(selected_ids))
    per_scene_prompts = parse_scene_character_prompts(args.scene_character_prompts)

    print("=" * 60)
    print("Scene Selection")
    for scene_id in selected_ids:
        scene = scene_map()[scene_id]
        extra = per_scene_prompts.get(scene_id, "")
        if extra:
            print(f"[{scene_id:02d}] {scene['name']} / {scene.get('name_en', scene['name'])} | Outfit: {extra}")
        else:
            print(f"[{scene_id:02d}] {scene['name']} / {scene.get('name_en', scene['name'])}")
    print("Per-scene outfit differences stay inside one shared image batch.")
    print("=" * 60)

    print(f"\n[Step 1] Starting image batch ({len(selected_ids)} scenes, workers={args.workers})")
    print("The HTML preview appears only after all image tasks finish, including retry outcomes.")
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
            marker = "SUCCESS" if result.get("status") == "SUCCESS" else "FAILED"
            print(f"  Image result [{result.get('scene_id', 0):02d}]: {marker}")

    img_results.sort(key=lambda item: item.get("scene_id", 0))
    (output_dir / "img_results.json").write_text(json.dumps(img_results, ensure_ascii=False, indent=2), encoding="utf-8")
    html_path = generate_img_preview_html(img_results, output_dir, char_url)
    open_preview_html(Path(html_path))
    print(format_img_results(img_results, run_id))
    print(f"Image preview HTML: {Path(html_path).resolve()}")
    print("Review the HTML preview in your browser and continue in chat.")
    print("The skill stops at the image stage.")


if __name__ == "__main__":
    main()
