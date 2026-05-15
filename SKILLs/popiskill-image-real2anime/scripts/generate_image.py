#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import io
import argparse
import base64
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

"""
图像生成 skill。

默认优先级：
1. 有单张 `--image-path` 时，优先走 PopiArt runtime skill：
   `popiart artifacts upload` + `popiart run popiskill-image-img2img-basic-v1`
2. 只有在多参考图、纯文生图、或需要保留旧直连行为时，才回退到脚本内直连网关路径。
"""

sys.path.insert(0, os.path.dirname(__file__))
from _common_new import (
    POPI_OPENAPI_URL,
    extract_image_urls,
    post_json,
    pull_artifact_to_generation,
    run_runtime_img2img,
    run_cli_generate,
    run_cli_img2img,
    save_base64_image,
    save_cli_image_result,
    ts,
    upload_image_artifact,
)

DEFAULT_MODEL = "seedream"


def gen_seedream_text(prompt: str, size: str = "2K", quality: str = "hd", n: int = 1):
    print(f"模型: seedream-4-5-251128  模式: 文生图  尺寸: {size}  质量: {quality}  数量: {n}")
    result = post_json(
        "/v1/images/generations",
        {
            "model": "seedream-4-5-251128",
            "prompt": prompt,
            "size": size,
            "quality": quality,
            "n": n,
            "response_format": "url",
        },
        timeout=120,
    )
    if "data" in result:
        for item in result["data"]:
            if "url" in item:
                print(f"🔗 {item['url']}")
                return item["url"]
    print(f"❌ {result}")
    return False


def gen_gemini_text(prompt: str, model_name: str, aspect_ratio: str = "16:9", size: str = "2K"):
    print(f"模型: {model_name}  模式: 文生图  宽高比: {aspect_ratio}  尺寸: {size}")
    result = post_json(
        f"/v1beta/models/{model_name}:generateContent",
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": size},
            },
        },
        timeout=300,
    )
    if "candidates" in result:
        try:
            b64 = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            path = save_base64_image(b64, prefix="gemini")
            print(f"🖼️  已保存: {path}")
            return path
        except (KeyError, IndexError) as exc:
            print(f"❌ 解析响应失败: {exc}")
    print(f"❌ {result}")
    return False


def gen_gemini_image_legacy(image_paths: list[str], prompt: str, model_name: str, aspect_ratio: str = "16:9", size: str = "2K"):
    print(f"模型: {model_name}  模式: 图生图(旧直连回退)  图片: {image_paths}")
    parts = [{"text": prompt}]
    for image_path in image_paths:
        try:
            with open(image_path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
        except FileNotFoundError:
            print(f"❌ 文件不存在: {image_path}")
            return False
        mime = "image/jpeg" if image_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        parts.append({"inlineData": {"mimeType": mime, "data": img_b64}})
    result = post_json(
        f"/v1beta/models/{model_name}:generateContent",
        {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": size},
            },
        },
        timeout=300,
    )
    if "candidates" in result:
        try:
            b64 = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            path = save_base64_image(b64, prefix="gemini_edited")
            print(f"🖼️  已保存: {path}")
            return path
        except (KeyError, IndexError) as exc:
            print(f"❌ 解析响应失败: {exc}")
    print(f"❌ {result}")
    return False


def gen_cli_generate(prompt: str, aspect_ratio: str = "16:9", size: str = "2K", style: str = "", prefix: str = "cli"):
    """使用 popiart image generate CLI 命令文生图"""
    print("模型: popiart image generate  模式: 文生图(CLI)")
    result = run_cli_generate(prompt, aspect_ratio=aspect_ratio, size=size, style=style)
    path = save_cli_image_result(result, __file__, prefix=prefix)
    print(f"🖼️  已保存: {path}")
    return path


def gen_cli_img2img(image_path: str, prompt: str, aspect_ratio: str = "16:9", size: str = "2K", style: str = "", prefix: str = "cli"):
    """使用 popiart image img2img CLI 命令生成图片（直接传本地文件路径）"""
    print("模型: popiart image img2img  模式: 图生图(CLI)")
    result = run_cli_img2img(image_path, prompt, aspect_ratio=aspect_ratio, size=size, style=style)
    path = save_cli_image_result(result, __file__, prefix=prefix)
    print(f"🖼️  已保存: {path}")
    return path


def gen_runtime_img2img(image_path: str, prompt: str, aspect_ratio: str = "16:9", size: str = "2K", prefix: str = "runtime"):
    """兼容旧接口：使用 artifact_id 方式"""
    print("模型: popiskill-image-img2img-basic-v1  模式: 图生图(runtime 优先)")
    source_artifact_id = upload_image_artifact(image_path)
    print(f"已上传参考图 artifact_id: {source_artifact_id}")
    result = run_runtime_img2img(source_artifact_id, prompt, aspect_ratio=aspect_ratio, size=size)
    data = result.get("data", result)
    artifact_ids = data.get("artifact_ids", [])
    if not artifact_ids:
        print(f"❌ runtime skill 未返回 artifact_ids: {result}")
        return False
    path = pull_artifact_to_generation(artifact_ids[0], __file__, prefix=prefix)
    print(f"🖼️  已保存: {path}")
    return path


def gen_sora(prompt: str, ratio: str = "2:3", image_list: list[str] | None = None, n: int = 1):
    if n < 1:
        print("❌ n 必须大于等于 1")
        return False

    image_list = image_list or []
    mode = "图生图" if image_list else "文生图"
    print(f"模型: sora_image  模式: {mode}  比例: {ratio}  数量: {n}")
    if image_list:
        print(f"原图: {image_list}")

    def build_messages():
        if image_list:
            content = [{"type": "text", "text": prompt}]
            for url in image_list:
                content.append({"type": "image_url", "image_url": {"url": url}})
            return [{"role": "user", "content": content}]
        normalized_prompt = f"{prompt}【{ratio}】" if ratio in ("2:3", "3:2", "1:1") else prompt
        return [{"role": "user", "content": normalized_prompt}]

    success = 0
    for i in range(n):
        if n > 1:
            print(f"\n[{i + 1}/{n}]")
        result = post_json(
            "/v1/chat/completions",
            {"model": "sora_image", "messages": build_messages()},
            timeout=120,
        )
        if "choices" in result:
            content = result["choices"][0]["message"]["content"]
            urls = extract_image_urls(content)
            if urls:
                print(f"🔗 {urls[0]}")
            else:
                print(f"内容: {content[:200]}")
            success += 1
        else:
            print(f"❌ {result}")

    return success == n


def main():
    parser = argparse.ArgumentParser(description="图像生成 skill")
    parser.add_argument("model", nargs="?", default=DEFAULT_MODEL, choices=["seedream", "nano-pro", "nano-2", "sora", "cli-generate"], help=f"模型别名，默认 {DEFAULT_MODEL}。使用 cli-generate 走纯文生图")
    parser.add_argument("--prompt", required=True, help="图像生成提示词（必填）")
    parser.add_argument("--image-path", nargs="+", default=[], metavar="PATH", help="本地图片路径列表。单张时优先走 popiart runtime skill；多张时回退到旧直连路径")
    parser.add_argument("--image-list", nargs="+", default=[], metavar="URL", help="原图 URL 列表（sora 图生图，支持多张）")
    parser.add_argument("--n", type=int, default=1, help="生成数量，>=1（sora，默认 1）")
    parser.add_argument("--size", default="2K", help="图片尺寸，如 2K / 4K / 1024x1024（默认 2K）")
    parser.add_argument("--quality", default="hd", help="图片质量 standard/hd（seedream，默认 hd）")
    parser.add_argument("--ratio", default="2:3", help="图片比例（sora 文生图，默认 2:3）")
    parser.add_argument("--aspect-ratio", default="16:9", help="宽高比（默认 16:9）")
    parser.add_argument("--style", default="", help="视觉风格提示，如 anime、cinematic realism（CLI 文生图/图生图可用）")
    args = parser.parse_args()

    model = args.model.lower()
    prompt = args.prompt

    print(f"⏰ {ts()}  POPI_OPENAPI_URL={POPI_OPENAPI_URL}")
    print(f"提示词: {prompt}\n")

    ok = False
    if model == "cli-generate":
        # 纯文生图模式，使用 popiart image generate
        ok = gen_cli_generate(prompt, aspect_ratio=args.aspect_ratio, size=args.size, style=args.style)
    elif model == "seedream":
        ok = gen_seedream_text(prompt, size=args.size, quality=args.quality, n=args.n)
    elif model == "nano-pro":
        if args.image_path:
            if len(args.image_path) == 1:
                # 使用 CLI image img2img 方式
                ok = gen_cli_img2img(args.image_path[0], prompt, aspect_ratio=args.aspect_ratio, size=args.size, style=args.style, prefix="nano_pro")
            else:
                print("⚠️ 多参考图当前仍回退到旧直连 Gemini 路径")
                ok = gen_gemini_image_legacy(args.image_path, prompt, "gemini-3-pro-image-preview", aspect_ratio=args.aspect_ratio, size=args.size)
        else:
            # 没有图片时走文生图
            ok = gen_cli_generate(prompt, aspect_ratio=args.aspect_ratio, size=args.size, style=args.style, prefix="nano_pro")
    elif model == "nano-2":
        if args.image_path:
            if len(args.image_path) == 1:
                # 使用 CLI image img2img 方式
                ok = gen_cli_img2img(args.image_path[0], prompt, aspect_ratio=args.aspect_ratio, size=args.size, style=args.style, prefix="nano_2")
            else:
                print("⚠️ 多参考图当前仍回退到旧直连 Gemini 路径")
                ok = gen_gemini_image_legacy(args.image_path, prompt, "gemini-3.1-flash-image-preview", aspect_ratio=args.aspect_ratio, size=args.size)
        else:
            # 没有图片时走文生图
            ok = gen_cli_generate(prompt, aspect_ratio=args.aspect_ratio, size=args.size, style=args.style, prefix="nano_2")
    elif model == "sora":
        ok = gen_sora(prompt, ratio=args.ratio, image_list=args.image_list, n=args.n)

    print(f"\n{'✅ 完成' if ok else '❌ 失败'}  {ts()}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
