#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

"""
图像生成 skill 脚本
用法:
  python3 generate_image.py <model> --prompt TEXT [选项]

模型:
  seedream       SeeDream 文生图（OpenAI Images API）
  nano-pro       nano-banana-pro 文生图 / 图生图（Gemini 原生 API）
  nano-2         nano-banana-2 文生图 / 图生图（Gemini 原生 API）
  sora           Sora Image 文生图 / 图生图（Chat Completions API）
  不传则默认 seedream

图生图触发条件:
  nano-pro/nano-2 传 --image-path（本地图片路径）
  sora            传 --image-list（一张或多张在线图片 URL）

必填参数:
  --prompt TEXT          图像生成提示词

可选参数:
  --image-path PATH ...  本地图片路径列表（nano-pro / nano-2 图生图，支持多张）
  --image-list URL ...   原图 URL 列表（sora 图生图，支持多张）
  --n N                  生成数量，>=1，>1 时循环调用（sora，默认 1）
  --size SIZE            图片尺寸，如 2K / 4K （默认 2K）
  --quality Q            图片质量，standard/hd（seedream，默认 hd）
  --ratio W:H            图片比例，如 2:3（sora 文生图，默认 2:3）
  --aspect-ratio W:H     宽高比，如 16:9（nano，默认 16:9）

示例:
  python3 generate_image.py seedream --prompt "一只猫"  ✅ 完成
  python3 generate_image.py seedream --prompt "一只猫" --n 2    ✅ 完成（n未生效，只返回一张图）
  python3 generate_image.py nano-pro --prompt "一只猫"  ✅ 完成
  python3 generate_image.py nano-pro --prompt "改成油画风格" --image-path ./cat.jpg ✅ 完成
  python3 generate_image.py nano-pro --prompt "融合两张图" --image-path ./a.jpg ./b.jpg ✅ 完成
  python3 generate_image.py nano-2 --prompt "一只猫" --aspect-ratio 1:1 ✅ 完成
  python3 generate_image.py nano-2 --prompt "改成油画风格" --image-path ./cat.jpg   ✅ 完成
  python3 generate_image.py nano-2 --prompt "融合两张图" --image-path ./cat.jpg ./dog.jpg   ✅ 完成
  python3 generate_image.py sora --prompt "一只柴犬"    ✅ 完成
  python3 generate_image.py sora --prompt "一只柴犬" --n 2  ✅ 完成
  python3 generate_image.py sora --prompt "把毛色改成彩虹色" --image-list https://example.com/dog.jpg    ✅ 完成
  python3 generate_image.py sora --prompt "融合两张图" --image-list https://a.com/1.jpg https://b.com/2.jpg ✅ 完成
"""

import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _common_new import post_json, save_base64_image, extract_image_urls, ts, POPI_OPENAPI_URL, API_KEY

DEFAULT_MODEL = "seedream"


# ---------- seedream ----------

def gen_seedream_text(prompt: str, size: str = "2K", quality: str = "hd", n: int = 1):
    print(f"模型: seedream 4.5  模式: 文生图  尺寸: {size}  质量: {quality}  数量: {n}")
    result = post_json("/v1/images/generations", {
        "model": "seedream-4-5-251128",
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": n,
        "response_format": "url",
    }, timeout=120)
    if "data" in result:
        for item in result["data"]:
            if "url" in item:
                print(f"🔗 {item['url']}")
                return item['url']
    print(f"❌ {result}")
    return False



# ---------- gemini ----------

def gen_gemini_text(prompt: str, model_name: str, aspect_ratio: str = "16:9", size: str = "2K"):
    print(f"模型: {model_name}  模式: 文生图  宽高比: {aspect_ratio}  尺寸: {size}")
    result = post_json(f"/v1beta/models/{model_name}:generateContent", {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": size},
        },
    }, timeout=300)
    if "candidates" in result:
        try:
            b64 = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            path = save_base64_image(b64, prefix="gemini")
            print(f"🖼️  已保存: {path}")
            # return True
            return path
        except (KeyError, IndexError) as e:
            print(f"❌ 解析响应失败: {e}")
    print(f"❌ {result}")
    return False


def gen_gemini_image(image_paths: list, prompt: str, model_name: str,
                     aspect_ratio: str = "16:9", size: str = "2K"):
    print(f"模型: {model_name}  模式: 图生图  图片: {image_paths}")
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
    result = post_json(f"/v1beta/models/{model_name}:generateContent", {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": size},
        },
    }, timeout=300)
    if "candidates" in result:
        try:
            b64 = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            path = save_base64_image(b64, prefix="gemini_edited")
            print(f"🖼️  已保存: {path}")
            return {"path": path}
        except (KeyError, IndexError) as e:
            print(f"❌ 解析响应失败: {e}")
    print(f"❌ {result}")
    return False


# ---------- sora ----------

def gen_sora(prompt: str, ratio: str = "2:3", image_list: list = None, n: int = 1):
    """
    sora_image 文生图 / 图生图统一入口。
    - image_list 为空 → 文生图，prompt 末尾附加比例标记
    - image_list 非空 → 图生图，每张图作为 image_url 传入
    - n >= 1，大于 1 时循环调用接口生成对应数量图片
    """
    if n < 1:
        print("❌ n 必须大于等于 1")
        return False

    image_list = image_list or []
    mode = "图生图" if image_list else "文生图"
    print(f"模型: sora_image  模式: {mode}  比例: {ratio}  数量: {n}")
    if image_list:
        print(f"原图: {image_list}")

    def _build_messages():
        if image_list:
            content = [{"type": "text", "text": prompt}]
            for url in image_list:
                content.append({"type": "image_url", "image_url": {"url": url}})
            return [{"role": "user", "content": content}]
        else:
            p = f"{prompt}【{ratio}】" if ratio in ("2:3", "3:2", "1:1") else prompt
            return [{"role": "user", "content": p}]

    success = 0
    for i in range(n):
        if n > 1:
            print(f"\n[{i+1}/{n}]")
        result = post_json("/v1/chat/completions", {
            "model": "sora_image",
            "messages": _build_messages(),
        }, timeout=120)
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


# ---------- 主入口 ----------

def main():
    parser = argparse.ArgumentParser(
        description="图像生成 skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("model", nargs="?", default=DEFAULT_MODEL,
                        choices=["seedream", "nano-pro", "nano-2", "sora"],
                        help=f"模型别名，默认 {DEFAULT_MODEL}")
    parser.add_argument("--prompt", required=True, help="图像生成提示词（必填）")
    parser.add_argument("--image-path", nargs="+", default=[], metavar="PATH",
                        help="本地图片路径列表（nano-pro / nano-2 图生图，支持多张）")
    parser.add_argument("--image-list", nargs="+", default=[], metavar="URL",
                        help="原图 URL 列表（sora 图生图，支持多张）")
    parser.add_argument("--n", type=int, default=1, help="生成数量，>=1（sora，默认 1）")
    parser.add_argument("--size", default="2K", help="图片尺寸，如 2K / 4K / 1024x1024（默认 2K）")
    parser.add_argument("--quality", default="hd", help="图片质量 standard/hd（seedream，默认 hd）")
    parser.add_argument("--ratio", default="2:3", help="图片比例（sora 文生图，默认 2:3）")
    parser.add_argument("--aspect-ratio", default="16:9", help="宽高比（gemini，默认 16:9）")
    args = parser.parse_args()

    model = args.model.lower()
    prompt = args.prompt

    print(f"⏰ {ts()}  POPI_OPENAPI_URL={POPI_OPENAPI_URL}")
    print(f"提示词: {prompt}\n")

    ok = False
    if model == "seedream":
        ok = gen_seedream_text(prompt, size=args.size, quality=args.quality, n=args.n)
    elif model == "nano-pro":
        if args.image_path:
            ok = gen_gemini_image(args.image_path, prompt, "gemini-3-pro-image-preview",
                                  aspect_ratio=args.aspect_ratio, size=args.size)
        else:
            ok = gen_gemini_text(prompt, "gemini-3-pro-image-preview",
                                 aspect_ratio=args.aspect_ratio, size=args.size)
    elif model == "nano-2":
        if args.image_path:
            ok = gen_gemini_image(args.image_path, prompt, "gemini-3.1-flash-image-preview",
                                  aspect_ratio=args.aspect_ratio, size=args.size)
        else:
            ok = gen_gemini_text(prompt, "gemini-3.1-flash-image-preview",
                                 aspect_ratio=args.aspect_ratio, size=args.size)
    elif model == "sora":
        ok = gen_sora(prompt, ratio=args.ratio, image_list=args.image_list, n=args.n)

    print(f"\n{'✅ 完成' if ok else '❌ 失败'}  {ts()}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
