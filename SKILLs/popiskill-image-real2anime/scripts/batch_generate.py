#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量图像生成脚本（runtime 优先）
用法:
  py batch_generate.py --image-path PATH --prompts "prompt1###prompt2###prompt3" [选项]

说明:
  多个 prompt 用 ### 分隔。
  默认先上传一次参考图，再并发调用 `popiart run popiskill-image-img2img-basic-v1`。
  最多并发 4 个任务，一次提交、一次等待、一次返回所有结果。
"""

import argparse
import io
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))
from _common_new import (
    POPI_OPENAPI_URL,
    pull_artifact_to_generation,
    run_runtime_img2img,
    run_cli_img2img,
    save_cli_image_result,
    ts,
    upload_image_artifact,
)

MAX_WORKERS = 4


def generate_one(prompt: str, image_path: str, style_name: str, aspect_ratio: str, size: str, index: int):
    """使用 CLI image img2img 生成单张图片"""
    try:
        result = run_cli_img2img(image_path, prompt, aspect_ratio=aspect_ratio, size=size)
        path = save_cli_image_result(result, __file__, prefix=f"style_{index}")
        # 尝试获取 artifact_id
        data = result.get("data", result)
        artifact_ids = data.get("artifact_ids", [])
        artifact_id = artifact_ids[0] if artifact_ids else None
        return {"style": style_name, "artifact_id": artifact_id, "path": path}
    except SystemExit as exc:
        return {"style": style_name, "error": f"CLI 退出: {exc}"}
    except Exception as exc:
        return {"style": style_name, "error": str(exc)}


def main():
    parser = argparse.ArgumentParser(description="批量图像生成（runtime 优先，并发）")
    parser.add_argument("--image-path", required=True, help="本地图片路径（所有风格共用）")
    parser.add_argument("--prompts", required=True, help="多个 prompt 用 ### 分隔")
    parser.add_argument("--style-names", default="", help="多个风格名称用 ### 分隔，与 prompts 一一对应（默认自动编号）")
    parser.add_argument("--size", default="2K", help="图片尺寸（默认 2K）")
    parser.add_argument("--aspect-ratio", default="16:9", help="宽高比（默认 16:9）")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS, help=f"并发数（默认 {MAX_WORKERS}，最大 {MAX_WORKERS}）")
    args = parser.parse_args()

    prompts_raw = [p.strip() for p in args.prompts.split("###") if p.strip()]
    total = len(prompts_raw)
    if total == 0:
        print("错误：--prompts 不能为空", file=sys.stderr)
        sys.exit(1)

    if args.style_names.strip():
        style_names = [s.strip() for s in args.style_names.split("###") if s.strip()]
        if len(style_names) != total:
            print(f"错误：--style-names 数量（{len(style_names)}）与 --prompts 数量（{total}）不一致", file=sys.stderr)
            sys.exit(1)
    else:
        style_names = [f"风格{i + 1}" for i in range(total)]

    workers = min(args.workers, MAX_WORKERS, total)

    print(f"⏰ {ts()}  POPI_OPENAPI_URL={POPI_OPENAPI_URL}")
    print(f"图片: {args.image_path}")
    print(f"正在生成 {total} 种风格的图片（并发数: {workers}）...\n")

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                generate_one,
                prompt,
                args.image_path,  # 直接传本地文件路径，CLI 会自动上传
                style_names[idx],
                args.aspect_ratio,
                args.size,
                idx + 1,
            ): idx
            for idx, prompt in enumerate(prompts_raw)
        }
        results_by_index = {}
        for future in as_completed(futures):
            idx = futures[future]
            results_by_index[idx] = future.result()

    sorted_results = [results_by_index[i] for i in range(total)]
    successes = [r for r in sorted_results if "path" in r]
    failures = [r for r in sorted_results if "error" in r]

    print(f"\n{'=' * 50}")
    print(f"生成完成：{len(successes)} 成功，{len(failures)} 失败")
    print(json.dumps(sorted_results, ensure_ascii=False, indent=2))
    print(f"{'=' * 50}  {ts()}")

    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
