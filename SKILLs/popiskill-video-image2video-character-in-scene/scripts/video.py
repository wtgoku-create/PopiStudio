#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch video generation stage for character-in-scene workflow."""

import argparse
import json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import (
    BASE_OUTPUT_DIR,
    concat_clips,
    ensure_auth_ready,
    format_video_results,
    generate_video_preview_html,
    normalize_scene_ids,
    open_preview_html,
    process_scene_video,
    upload_confirmed_image_get_media_url,
)


def prepare_confirmed_images(img_results: list[dict], output_dir: Path) -> list[dict]:
    updated_results = []
    for item in img_results:
        current = dict(item)
        if current.get("status") != "SUCCESS":
            updated_results.append(current)
            continue
        img_path = current.get("img_path")
        if not img_path:
            raise RuntimeError(f"场景 [{current.get('scene_id', 0):02d}] 缺少本地确认图片路径，无法继续视频阶段。")
        image_file = Path(img_path)
        if not image_file.exists():
            raise RuntimeError(f"场景 [{current.get('scene_id', 0):02d}] 的确认图片不存在: {image_file}")
        print(f"  上传已确认图片为公网 media URL [{current.get('scene_id', 0):02d}]: {image_file}")
        upload_result = upload_confirmed_image_get_media_url(image_file)
        current.update(upload_result)
        updated_results.append(current)
    (output_dir / "img_results.json").write_text(
        json.dumps(updated_results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return updated_results


def main():
    parser = argparse.ArgumentParser(description="角色场景融合转视频: 视频阶段")
    parser.add_argument("--run-id", required=True, help="与图片阶段一致的运行 ID")
    parser.add_argument("--scenes", required=True, help="场景 ID，例如 1,4,7")
    parser.add_argument("--action", default="", help="统一视频动作描述")
    parser.add_argument("--workers", "-w", type=int, default=3, help="并发数")
    parser.add_argument("--concat", action="store_true", help="兼容参数；当前默认在全部成功后自动拼接")
    parser.add_argument("--aspect-ratio", default="16:9", help="视频比例")
    parser.add_argument("--duration", default="3", help="视频时长，默认 3 秒；用户指定时覆盖默认值")
    args = parser.parse_args()

    output_dir = BASE_OUTPUT_DIR / args.run_id
    clips_dir = output_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    print("预检查: 正在验证 PopiArt 鉴权状态")
    ensure_auth_ready()
    print("预检查通过: PopiArt 鉴权有效")

    img_results_path = output_dir / "img_results.json"
    if not img_results_path.exists():
        raise SystemExit(f"找不到图片阶段结果: {img_results_path}")

    selected_ids = normalize_scene_ids(args.scenes)
    all_img_results = json.loads(img_results_path.read_text(encoding="utf-8-sig"))
    print("[Step 2] 上传已确认图片并构建公网 media URL")
    all_img_results = prepare_confirmed_images(all_img_results, output_dir)
    img_results = [item for item in all_img_results if item.get("scene_id") in selected_ids]

    print(f"[Step 3] 整批视频生成开始 ({len(img_results)} 个场景，并发 {args.workers})")
    print("本阶段只展示为一个视频步骤；只有当全部片段任务都结束后，才统一进入最终拼接与 HTML 预览，包括成功结果和按既定重试规则结束后的失败结果。")

    video_results = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                process_scene_video,
                item,
                clips_dir,
                args.action,
                "",
                args.aspect_ratio,
                args.duration,
            ): item.get("scene_id")
            for item in img_results
        }
        for future in as_completed(futures):
            result = future.result()
            video_results.append(result)
            marker = "成功" if result.get("status") == "SUCCESS" else "失败"
            print(f"  视频结果 [{result.get('scene_id', 0):02d}]: {marker}")
    video_results.sort(key=lambda item: item.get("scene_id", 0))
    (output_dir / "video_results.json").write_text(json.dumps(video_results, ensure_ascii=False, indent=2), encoding="utf-8")

    final_video = ""
    successful_clips = [Path(item["clip_path"]) for item in video_results if item.get("status") == "SUCCESS" and item.get("clip_path")]
    if successful_clips and len(successful_clips) == len(selected_ids):
        print("[Step 4] 最终拼接开始")
        final_path = output_dir / f"final_video_{len(successful_clips)}scenes.mp4"
        concat_clips(successful_clips, final_path)
        final_video = str(final_path)
        print(f"最终拼接完成: {final_video}")
    else:
        print("[Step 4] 跳过最终拼接，因为并非所有选中场景都成功生成视频。")

    html_path = generate_video_preview_html(video_results, output_dir, final_video, args.aspect_ratio)
    open_preview_html(Path(html_path))
    print(format_video_results(video_results, args.run_id, final_video))
    print(f"视频预览 HTML: {Path(html_path).resolve()}")
    print("请在浏览器查看已自动弹出的 HTML 预览，并回到对话框继续交互。")
    print("请在对话框回复：确认 / 重新生成 1,4")


if __name__ == "__main__":
    main()
