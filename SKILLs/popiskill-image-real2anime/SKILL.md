---
name: popiskill-image-real2anime
version: 1.0.0
description: >
  真人照片转动漫风格，支持多种动漫风格转换
homepage: https://llmapitest.popi.art
user-invocable: true
official: true
category: "漫剧制作"
metadata:
  {
    "openclaw":
      {
        "emoji": "🎭",
        "requires": { "bins": ["python3"], "env": ["POPI_OPENAPI_KEY"] },
        "primaryEnv": "POPI_OPENAPI_KEY",
      },
  }
---
# 真人照片转动漫风格

将真人照片转换为多种动漫/艺术风格，支持16种风格选择。

## 环境配置指引

### 密钥配置

本 Skill 需要 Popi API 密钥才能正常工作。

#### 方式一：环境变量

**Linux / macOS：**

```bash
export POPI_OPENAPI_KEY="your-api-key-here"
```

如需持久化：

```bash
echo 'export POPI_OPENAPI_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

**Windows (PowerShell)：**

```powershell
$env:POPI_OPENAPI_KEY = "your-api-key-here"
```

#### 方式二：openclaw.json 配置（推荐）

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "skills": {
    "entries": {
      "popiskill-image-real2anime": {
        "enabled": true,
        "env": {
          "POPI_OPENAPI_KEY": "your-api-key-here"
        }
      }
    }
  }
}
```

## 支持的风格

风格配置存储在 skill 目录下的 `style.json` 文件中。

| 风格名称 | 说明 |
|----------|------|
| JOJO漫画风格 | 《JOJO的奇妙冒险》漫画风格 |
| 水彩风格 | 吉卜力水彩风格，柔和 pastel 色调 |
| 迪士尼3D动画风格 | 迪士尼3D动画质感 |
| 80年代复古漫画风格 | 80年代日本复古动画风格 |
| 像素风格 | 像素化游戏风格 |
| 日系漫画风格 | 日式动画风格 |
| 扁平插画风格 | Flat Design 扁平设计 |
| 黑白漫画风格 | 黑白漫画风格 |
| 2.5D游戏风格 | 《崩坏：星穹铁道》风格化3D |
| 饥荒风格 | 《Don't Starve》哥特卡通风格 |
| 水墨国风风格 | 国风水墨风格 |
| 彩铅风格 | 彩色铅笔手绘风格 |
| 毛绒娃娃风格 | 毛绒玩具/玩偶风格 |
| 卡通INS风格 | Q版INS风格 |
| Q版萌趣风格 | Q版萌趣风格 |
| 恶搞之家风格 | 《恶搞之家》动画风格 |
| 韩系漫画风格 | 现代韩漫风格 |

## Agent 执行指令（必读）

> 本节是 Agent（AI 模型）的核心执行规范。当用户请求生成图片时，Agent 必须严格按照以下步骤自主执行，无需询问用户确认。

### 通用执行规则

1. **触发条件**：用户上传了真人照片，要求转换为动漫/艺术风格。
2. **零交互原则**：Agent 应直接执行脚本，不要向用户询问任何确认。
3. **模型选择**：固定使用 **nano-pro** 模型（用户指定要求）
4. **风格选择**：从用户输入中提取风格名称，匹配 style.json 中的风格
5. **未命中风格**：如果用户未命中风格库的风格，展示风格名称列表，提示用户选择

---

### 脚本：真人照片转动漫风格

**适用场景**：用户上传了图片，需要转换为动漫/艺术风格

**图片处理步骤（必须执行）**：
1. 首先创建临时文件夹：`mkdir -p ~/.openclaw/workspace/skills/popiskill-image-real2anime/scripts/tmp`
2. 将用户上传的图片原封不动复制到上述 tmp 文件夹（不压缩、不修改）
3. 使用复制后的图片路径作为 `--image-path` 参数

**风格处理步骤**：
1. 从用户输入中提取风格名称（如"JOJO风格"、"水彩风格"等）
2. 读取 skill 目录下的 `style.json` 获取对应风格的 prompt
3. 使用该 prompt 作为 `--prompt` 参数

**固定参数**：

```
- `--model`: nano-pro（固定）
- `--prompt`: 从 style.json 读取对应风格的 prompt
- `--image-path`: 用户上传图片路径
```

**可变参数**：

| 参数 | 说明 | 默认值 | 可选值 |
|------|------|--------|--------|
| `--size` | 图片尺寸 | 2K | 2K, 4K, 1024x1024, 1280x1280 |
| `--aspect-ratio` | 宽高比 | 16:9 | 16:9, 4:3, 1:1, 2:3, 3:2, 9:16 |

**执行命令**：

```bash
python3 scripts/generate_image.py nano-pro --prompt "{从style.json读取的prompt}" --image-path "tmp/uploaded_image.png" --size 2K --aspect-ratio 16:9
```

**输出示例**：

```json
{
  "path": "C:/Users/xxx/.openclaw/workspace/scripts/image_20250325_161200.png",
  "model": "nano-pro",
  "size": "2K",
  "aspect_ratio": "16:9"
}
```

### 完整调用示例

**示例 1：JOJO漫画风格**
```bash
python3 scripts/generate_image.py nano-pro --prompt "将参考图中的角色转化为《JOJO的奇妙冒险》漫画风格。保持构图和核心特征" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

**示例 2：水彩风格**
```bash
python3 scripts/generate_image.py nano-pro --prompt "Transform the characters in the reference image into《Ghibli》style: soft watercolor edges, gentle pastel washes, clean white background, high contrast, muted palette with selective color pops, warm yet whimsical Studio-Ghibli vibe. Masterpiece quality, intricate hand-painted detail" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

**示例 3：迪士尼3D动画风格**
```bash
python3 scripts/generate_image.py nano-pro --prompt "将参考图中的角色转变为具有《迪士尼3d动画》质感的动画风格，背景变为白色背景" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

### Agent 须避免的行为

- 只打印脚本路径而不执行
- 向用户询问"是否要执行图片生成"——应直接执行
- 忘记读取输出结果中的 `path` 并返回给用户
- 图像生成失败时，自行编造图片路径
- 使用非 nano-pro 模型（用户明确要求使用 nano-pro）
- 忽略用户指定的风格，使用默认 prompt

## API 参考文档

暂无
