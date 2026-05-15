---
name: popiskill-image-real2anime
version: 0.2.0
description: 真人照片转动漫风格，支持同时选择多种动漫风格批量转换
homepage: https://llmapi.popi.art
user-invocable: true
official: true
metadata:
  {
    "openclaw":
      {
        "emoji": "🎭",
        "requires": { "bins": ["py", "popiart"] },
      },
  }
---
# 真人照片转动漫风格

将真人照片转换为多种动漫/艺术风格，支持 17 种风格，可同时选择多种风格批量生成。

## 前置检查

### 1. 检查 CLI 工具

```sh
py --version
popiart --version
```

- **缺少** → 提示用户安装

### 2. 检查 API Key

统一登录规则：先执行 `popiart auth login --key <product-key>`。如果使用环境变量，优先使用 `POPIART_KEY` 或 `POPIART_TOKEN`；旧的 `POPI_OPENAPI_KEY` 仅作为兼容别名。

```sh
# 检查是否已登录
popiart auth whoami
```

- **失败/未登录** → 提示用户执行 `popiart auth login --key <product-key>`，Key 申请与充值地址：**https://wwwskillhub.popi.art**
- **成功** → 继续下一步

> **认证方式说明：** 推荐使用 `popiart auth login --key <product-key>`。如需走环境变量，可设置 `POPIART_KEY` 或 `POPIART_TOKEN`；旧的 `POPI_OPENAPI_KEY` 仅作为兼容别名。

### 3. 余额检查

若执行过程中遇到 `InsufficientBalance` 或类似余额不足错误：

> 余额不足，请前往 **https://wwwskillhub.popi.art** 充值后再继续。

流程暂停，等待用户充值后手动继续。

## 用户须知

### 构图保持规则

> 上传半身照片 → 输出的动漫角色也是半身；上传全身照片 → 输出也是全身。
> 如果希望改变构图（如半身转全身），请在请求时明确说明，Agent 会在 prompt 中补充相应描述。

### 去背景选项

用户可选择是否去掉所有背景，只保留人物：

| 选项 | 说明 |
|------|------|
| **保留背景**（默认） | 生成的图片保留风格化背景 |
| **去背景** | 去掉所有背景，只保留人物，输出透明/白色背景 |

当用户选择"去背景"时，Agent 会在每个风格的 prompt 末尾追加：`Remove all backgrounds, keep only the character, pure white background.`

## 支持的风格

风格配置存储在 skill 目录下的 `style.json` 文件中。用户可同时选择多种风格批量生成。

| 风格名称 | 说明 | 有参考图 |
|----------|------|----------|
| JOJO漫画风格 | 《JOJO的奇妙冒险》漫画风格 | — |
| 水彩风格 | 吉卜力水彩风格，柔和 pastel 色调 | — |
| 迪士尼3D动画风格 | 迪士尼3D动画质感 | — |
| 80年代复古漫画风格 | 80年代日本复古动画风格 | — |
| 像素风格 | 像素化游戏风格 | — |
| 日系漫画风格 | 日式动画风格 | — |
| 扁平插画风格 | Flat Design 扁平设计 | — |
| 黑白漫画风格 | 黑白漫画风格 | — |
| 2.5D游戏风格 | 《崩坏：星穹铁道》风格化3D | — |
| 饥荒风格 | 《Don't Starve》哥特卡通风格 | — |
| 水墨国风风格 | 国风水墨风格 | — |
| 彩铅风格 | 彩色铅笔手绘风格 | — |
| 毛绒娃娃风格 | 毛绒玩具/玩偶风格 | — |
| 卡通INS风格 | Q版INS风格 | ✅ |
| Q版萌趣风格 | Q版萌趣风格 | ✅ |
| 恶搞之家风格 | 《恶搞之家》动画风格 | ✅ |
| 韩系漫画风格 | 现代韩漫风格 | ✅ |

> 标注 ✅ 的风格带有内置参考图（`style.json` 中 `base_img` 字段），用于辅助风格一致性。

## 模型与调用

### 推荐执行优先级

| 路径 | 说明 |
|------|------|
| `popiart image generate` | 文生图模式。无参考图时使用，直接根据文字描述生成形象。 |
| `popiart image img2img` | 图生图模式。有真人照片时使用，自动上传并转换风格。 |
| Gemini 原生 `generateContent` | 仅在调试或一次传多张本地参考图时作为兼容回退。 |

### 使用模式

#### 模式1：文生图（无参考图）

当用户没有真人照片，只想用文字描述生成形象时：

```bash
py scripts/generate_image.py nano-pro --prompt "一个20岁亚洲女性，黑色长发，穿白色连衣裙，站在樱花树下，日系动漫风格" --size 2K --aspect-ratio 16:9
```

或显式使用 cli-generate：

```bash
py scripts/generate_image.py cli-generate --prompt "描述内容" --style "anime"
```

#### 模式2：图生图（有参考图）

```bash
py scripts/generate_image.py nano-pro --prompt "JOJO漫画风格" --image-path "photo.jpg"
```

### 稳定 payload 建议

**文生图：**
```json
{
  "model": "cli-generate",
  "prompt": "<角色描述>",
  "aspect_ratio": "16:9",
  "size": "2K",
  "style": "anime"
}
```

**图生图：**
```json
{
  "prompt": "<风格化提示词>",
  "image": "/path/to/photo.jpg",
  "aspect_ratio": "16:9",
  "size": "2K"
}
```

| 项目 | 值 |
|------|---|
| 文生图 | `popiart image generate` CLI 命令，或 `nano-pro`/`nano-2` 不传 `--image-path` |
| 图生图 | `popiart image img2img` CLI 命令 |
| 单风格脚本 | `py scripts/generate_image.py` |
| 多风格脚本 | `py scripts/batch_generate.py`（仅支持图生图） |
| 并发 | ≤ 4 张图真正并发（`batch_generate.py` 内部 `ThreadPoolExecutor`） |
| 重试 | 失败 → 重试 1 次 → 仍失败则停止并报告用户 |

## Agent 执行指令（必读）

> 本节是 Agent（AI 模型）的核心执行规范。当用户请求生成图片时，Agent 必须严格按照以下步骤自主执行，无需询问用户确认。

### 开场白（必须）

当用户调用此技能时，**必须**以以下固定语句开场：

> hello！我是你的ip形象生成助手。

然后立即进入引导流程。

### 通用执行规则

1. **触发条件**：用户调用此技能，或明确要求生成 IP 形象/动漫形象/角色形象。
2. **开场流程**：
   - 第一句：**"hello！我是你的ip形象生成助手。"**
   - 第二句开始引导用户描述需求
3. **模式判断**：
   - 用户上传了图片 → 进入**图生图模式**（真人照片转动漫风格）
   - 用户未上传图片 → 进入**文生图模式**（根据文字描述生成形象）
4. **最少交互原则**：Agent 应直接执行脚本，不要反复询问确认。但以下两项仍应在缺失时一次性问清：
   - **宽高比选择**（见下方第9条）
   - **尺寸选择**（见下方第10条）
5. **模型选择**：单张真人照片默认走 `popiart image img2img`；文生图走 `popiart image generate`。
4. **风格选择**：从用户输入中提取所有风格名称，匹配 style.json 中的风格。支持同时选择多种风格。
5. **构图提醒**：如果用户未特别说明，提醒用户"半身照输出半身，全身照输出全身"。
6. **去背景**：如果用户要求去背景，在 prompt 末尾追加 `Remove all backgrounds, keep only the character, pure white background.`
7. **宽高比选择（缺失时询问）**：如果用户未指定 `--aspect-ratio`，Agent 应一次性询问用户选择宽高比：
   - **横向：** `16:9`（宽屏/横版）、`4:3`、`3:2`
   - **方形：** `1:1`
   - **纵向：** `2:3`（竖版）、`9:16`（手机竖屏）
   - 用户选择后传入 `--aspect-ratio` 参数，默认 `16:9`。
8. **尺寸选择（缺失时询问）**：如果用户未指定 `--size`，Agent 应一次性询问用户选择尺寸：
   - `2K`（默认，均衡）
   - `4K`（高清）
   - 用户选择后传入 `--size` 参数。
   - **宽高比和尺寸选择可以合并为一次提问。**

---

### 脚本：真人照片转动漫风格 / 文生图

#### 模式A：用户有真人照片（图生图）

**适用场景**：用户上传了图片，需要转换为动漫/艺术风格

**图片处理步骤（必须执行）**：
1. 确定临时文件夹路径：使用 skill 安装目录下的 `scripts/tmp/`（即 `$SKILL_DIR/scripts/tmp/`）
2. 将用户上传的图片原封不动复制到上述 tmp 文件夹（不压缩、不修改）
3. 使用复制后的图片路径作为 `--image-path` 参数

**风格处理步骤**：
1. 从用户输入中提取所有风格名称（如"JOJO风格和水彩风格" → 提取 2 种）
2. 读取 skill 目录下的 `style.json` 获取每种风格对应的 prompt
3. 每种风格使用各自的 prompt 作为 `--prompt` 参数

**固定参数**：

```
- `--model`: nano-pro（固定）
- `--prompt`: 从 style.json 读取对应风格的 prompt（每种风格不同）
- `--image-path`: 用户上传图片路径（所有风格共用）
```

#### 模式B：用户无参考图（文生图）

**适用场景**：用户没有照片，想直接根据文字描述生成动漫形象

**Agent 引导流程**：

1. **开场白**：hello！我是你的ip形象生成助手。

2. **询问角色描述**：引导用户描述想要的角色形象
   - 性别、年龄、种族
   - 发型、发色、眼睛颜色
   - 服装、配饰
   - 姿势、场景、表情
   - 整体风格（日系、欧美、写实、Q版等）

3. **询问风格偏好**：从 style.json 的17种风格中选择

4. **询问尺寸和比例**（如用户未指定）

5. **生成**：使用 `cli-generate` 模型或 `nano-pro` 不传 `--image-path`

**标准引导话术**：

```
hello！我是你的ip形象生成助手。

请描述一下你想要的角色形象：
1. 性别和年龄？（如：20岁女性）
2. 外貌特征？（如：黑色长发、大眼睛、微笑表情）
3. 穿着？（如：白色连衣裙、帆布鞋）
4. 场景或姿势？（如：站在樱花树下、侧身站立）
5. 风格偏好？（如：日系动漫、迪士尼3D、水彩风格、JOJO漫画等）

你也可以直接说："生成一个XX风格的XX角色"，我会帮你补充细节。
```

**固定参数**：

```
- `--model`: cli-generate（文生图专用）或 nano-pro（不传 --image-path 时自动走文生图）
- `--prompt`: 用户描述的角色 + 风格关键词
```

**可变参数**：

| 参数 | 说明 | 默认值 | 可选值 |
|------|------|--------|--------|
| `--size` | 图片尺寸 | 2K | 2K, 4K, 1024x1024, 1280x1280 |
| `--aspect-ratio` | 宽高比 | 16:9 | 16:9, 4:3, 1:1, 2:3, 3:2, 9:16 |
| `--style` | 视觉风格 | "" | anime, cinematic realism, product render 等 |

---

### 单风格执行

```bash
py scripts/generate_image.py nano-pro --prompt "{从style.json读取的prompt}" --image-path "tmp/uploaded_image.png" --size 2K --aspect-ratio 16:9
```

### 多风格执行（并发）

> ⚠️ **必须使用 `batch_generate.py` 实现真正并发，禁止逐个调用 `generate_image.py`。**

`batch_generate.py` 内部使用 `ThreadPoolExecutor`（max_workers=4），一次提交所有任务，等待全部完成后统一返回结果。

```bash
py scripts/batch_generate.py --image-path "tmp/uploaded_image.png" --prompts "prompt1###prompt2###prompt3" --style-names "JOJO漫画风格###水彩风格###韩系漫画风格" --size 2K --aspect-ratio 16:9
```

> **进度汇报：** 无论生成几张图，只输出**一条**进度消息，如"正在生成 3 种风格的图片..."，不要逐张汇报。完成后一次性展示所有结果。

**参数说明**：
- `--prompts`：多个 prompt 用 `###` 分隔
- `--style-names`：多个风格名称用 `###` 分隔，与 `--prompts` 一一对应（可选，默认自动编号"风格1/2/3"）
- 其余参数与 `generate_image.py` 相同，所有风格共用

**输出示例**：

```json
[
  {"style": "JOJO漫画风格", "path": "C:/Users/xxx/generation/gemini_edited_20260409_162011.png"},
  {"style": "水彩风格", "path": "C:/Users/xxx/generation/gemini_edited_20260409_162102.png"},
  {"style": "韩系漫画风格", "path": "C:/Users/xxx/generation/gemini_edited_20260409_162146.png"}
]
```

### 完整调用示例

**示例 1：单风格 — JOJO漫画风格**
```bash
py scripts/generate_image.py nano-pro --prompt "将参考图中的角色转化为《JOJO的奇妙冒险》漫画风格。保持构图和核心特征" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

**示例 2：单风格 — 水彩风格**
```bash
py scripts/generate_image.py nano-pro --prompt "Transform the characters in the reference image into《Ghibli》style: soft watercolor edges, gentle pastel washes, clean white background, high contrast, muted palette with selective color pops, warm yet whimsical Studio-Ghibli vibe. Masterpiece quality, intricate hand-painted detail" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

**示例 3：单风格 — 迪士尼3D动画风格**
```bash
py scripts/generate_image.py nano-pro --prompt "将参考图中的角色转变为具有《迪士尼3d动画》质感的动画风格，背景变为白色背景" --image-path "tmp/photo.jpg" --size 2K --aspect-ratio 16:9
```

**示例 4：多风格 — JOJO + 水彩 + 韩系漫画（真正并发）**
```bash
py scripts/batch_generate.py --image-path "tmp/photo.jpg" --prompts "将参考图中的角色转化为《JOJO的奇妙冒险》漫画风格。保持构图和核心特征###Transform the characters in the reference image into《Ghibli》style: soft watercolor edges, gentle pastel washes, clean white background, high contrast, muted palette with selective color pops, warm yet whimsical Studio-Ghibli vibe. Masterpiece quality, intricate hand-painted detail###将参考图中的角色转变为具有现代韩漫风格。保持参考图1的构图和核心特征，背景变为白色，风格参考图2（现代韩漫风格）" --style-names "JOJO漫画风格###水彩风格###韩系漫画风格" --size 2K --aspect-ratio 16:9
```

### Agent 须避免的行为

- 只打印脚本路径而不执行
- 向用户询问"是否要执行图片生成"——应直接执行（但**宽高比和尺寸**必须询问，见通用执行规则第7、8条）
- 忘记询问用户宽高比和尺寸选择（用户未指定时）
- 忘记读取输出结果中的 `path` 并返回给用户
- 使用非 nano-pro 模型（用户明确要求使用 nano-pro）
- 忽略用户指定的风格，使用默认 prompt
- 逐张汇报生成进度（批量操作只汇报一次）
- 多风格时逐个调用 `generate_image.py`（必须用 `batch_generate.py` 并发）
- 硬编码临时目录路径（必须使用 skill 安装目录下的 `scripts/tmp/`）

### 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| 生成失败（非余额原因） | 重试 1 次 → 仍失败则停止并报告错误信息 |
| `InsufficientBalance` | 暂停流程，引导用户前往 https://wwwskillhub.popi.art 充值 |
| 输出缺少 `path` 字段 | 视为失败，报告"模型未返回图片路径" |
| 图片文件不存在 | 视为失败，报告"输出路径无效" |
| Python 脚本报错 | 报告完整 stderr 信息，不编造结果 |

## 环境变量

脚本默认沿用 skill 现有直连网关；如需显式覆盖，优先设置 `POPIART_ENDPOINT`，旧的 `POPI_OPENAPI_URL` 仅作为兼容别名。

### 认证方式

推荐直接复用 `popiart auth login --key <product-key>` 的本地配置；脚本会优先读取 `POPIART_KEY` / `POPIART_TOKEN`，再回退到兼容变量和 `~/.popiart/config.json`。

**认证优先级：**
1. 环境变量 `POPIART_KEY` / `POPIART_TOKEN`
2. 兼容变量 `POPI_OPENAPI_KEY`
3. `~/.popiart/config.json` 中的 `token` / `key` / `api_key` 字段

### 配置 API Key

```sh
# 方式1：通过 popiart CLI 登录（推荐）
popiart auth login --key <product-key>

# 方式2：设置环境变量
# Windows PowerShell
$env:POPIART_KEY = "sk_xxx"

# Linux/macOS
export POPIART_KEY="sk_xxx"
```

Key 申请地址：https://wwwskillhub.popi.art

验证是否已配置：

```sh
popiart auth whoami
```
