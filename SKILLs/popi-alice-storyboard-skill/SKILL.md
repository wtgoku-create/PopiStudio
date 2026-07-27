---
name: popi-alice-storyboard-skill
description: 使用 MCP 的文生图、Alice 参考图图生图、图生视频能力，为 Alice vlog 生成封面图、镜头参考图和短视频片段。
version: 1.0.0
official: true
name_i18n:
  zh: Alice 分镜生成
  en: Alice Storyboard Generation
description_i18n:
  zh: 为 Alice vlog 生成封面图、镜头参考图和短视频片段。
  en: Generate cover images, shot references, and short video clips for Alice vlogs.
---

# Popi Alice Storyboard Skill

## 任务定位

这是 Popi Alice 的 Alice 专属视觉执行 skill。

当 Alice vlog 已经确定主题、情绪、镜头意图之后，使用这个 skill 生成对应素材。

默认上游来自 `popi-alice-vlog-director` 的确认版导演 brief。

这是执行型 skill，不是默认对话模式。

- 只有当用户明确要求生成素材，或明确批准执行时，才调用这个 skill。
- 如果用户还在讨论选题、标题、脚本、镜头、封面方向或发布策略，不要提前进入素材生成。
- 如果缺少 `XX日` 主题、情绪关键词、Hook、场景流或视觉方向，先回到 `popi-alice-vlog-director` 完成导演确认，再进入执行。

执行前先读取：

- `../popi-alice-vlog-director/references/alice-ip-spec.md`
- `../popi-alice-vlog-director/references/alice-assets.md`
- `references/alice-environment-library.md`
- `references/alice-style-reference-map.md`
- 若任务涉及镜头语气、prompt 颗粒度或动作表达，先读取 `../popi-alice-vlog-director/references/cases/case-selection-guide.md`
- 再根据导演 brief 或用户意图，只读取 1 个主参考 case：
  - `../popi-alice-vlog-director/references/cases/full-day-vlog-case.md`
  - `../popi-alice-vlog-director/references/cases/weekend-home-vlog-case.md`
  - `../popi-alice-vlog-director/references/cases/new-year-vlog-case.md`

若案例参考与 `alice-ip-spec.md` 冲突，以 `alice-ip-spec.md` 为准。

- 这里读取的 case 也只是结构案例，不是具体内容参考。
- 只能借用被选 case 的镜头长度分布、段落推进和 prompt 颗粒度。
- 禁止把 case 中的具体食物、道具、节日动作、场景事件直接复制到执行 prompt 里，除非这些内容本来就来自导演 brief。

## 支持模式（必须先确定）

1. `text2image`
   - 用于生成封面图、key visual、单镜头参考图。
2. `image2image`
   - 用于基于固定 Alice 角色图，生成角色一致的新图。
3. `image2video`
   - 用于基于已确认的 Alice 静帧生成短视频片段。

## Alice 参考资产规则（必须）

- 固定 Alice 角色图 URL：`https://static.popi.art/media/image/2026/0527/97025_thumb.webp`
- `image2image` 默认使用这张 Alice 角色图作为主输入参考图。
- Alice 必须作为素材中的主角完整出现，不能仅作为风格参考。
- Alice 三视图链接以 `../popi-alice-vlog-director/references/alice-assets.md` 为准；若已提供，仅用于角色结构、发型、服装和正侧背视信息校准，不替代主输入图。
- Alice 固定生活空间与周边环境参考以 `references/alice-environment-library.md` 为准；该文件仅用于环境连续性，不替代角色参考。
- 效果融合参考优先以 `references/alice-style-reference-map.md` 为准；若当前语义明确，可用语义匹配的效果融合参考图替换默认效果示例图，但只替换风格融合参考，不替代角色参考。
- 效果示例图：`https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/storyboard/2026/02/05/590c6597bc3f49308dffa10fdce7f01d.png`
- 效果示例图仅用于参考最终效果方向：
  - 保留 2D 动漫人物形象
  - 场景环境改为真实世界中式现代生活场景
  - 索尼实拍质感、自然光、8K 高清、细节真实、无 AI 失真
  - 中式生活化光影、暖调写实（真实世界中国现代风格）
- 参考优先级固定为：
  1. 固定 Alice 角色图
  2. Alice 三视图参考
  3. 效果示例图
- 效果示例图不是新的角色参考图，不得替代固定 Alice 角色图，不得借用示例图里的人物脸、发型、服装或角色设定。

## MCP 调用规则（必须）

- 仅允许调用：
  - `upload_image`
  - `generate_image_from_text`
  - `generate_image_from_image`
  - `generate_video_from_image`
  - `get_generation_status`
  - `download_generation_asset`
- 禁止调用第三方图片生成 HTTP API。
- 单次调用只生成 1 个主要素材，除非用户明确要求批量。
- 整个流程禁止做图片分析、特征提取、caption、embedding、视觉理解步骤。
- 引用图输入必须直接作为 MCP 参数传入，不做中间解析。
- 若上一步已经拿到 MCP 或 provider 返回的正式图片地址，优先直接复用该地址作为下一步输入。
- 只有当没有可复用的 MCP / HTTP 地址时，才对本地图片调用 `upload_image`。
- 禁止把 `file://` 本地路径伪装成 `input_image_url` 直接传给 `generate_image_from_image` 或 `generate_video_from_image`。

## Prompt 约束（必须包含）

每次生成 prompt 必须同时包含以下约束：

1. 主角与角色一致性约束：
`Alice 必须作为画面主角完整出现。保持 Alice 角色一致：同一角色身份、二次元动画角色特征、脸型五官、发型发色、服装与主色调一致，不改变角色辨识度。`

2. vlog 场景与质感约束：
`保留 2D 动漫人物形象，场景环境改为真实世界中式现代生活场景，索尼实拍质感，自然光，8K 高清，细节真实，无 AI 失真，中式生活化光影，暖调写实（真实世界中国现代风格），适合小红书生活方式内容。`

3. 本期主题约束：
`画面必须服务当前这期 Alice 的 XX日 主题、情绪主张、镜头目的与生活片段。`

推荐 prompt 结构：

```text
Alice 必须作为画面主角完整出现。保持 Alice 角色一致：同一角色身份、二次元动画角色特征、脸型五官、发型发色、服装与主色调一致，不改变角色辨识度。保留 2D 动漫人物形象，场景环境改为真实世界中式现代生活场景，索尼实拍质感，自然光，8K 高清，细节真实，无 AI 失真，中式生活化光影，暖调写实（真实世界中国现代风格），适合小红书生活方式内容。画面必须服务当前这期 Alice 的 XX日 主题、情绪主张、镜头目的与生活片段。再补充本次具体场景、动作、道具、机位、构图和节奏要求。
```

## 模式执行规则

### `text2image`

1. 用于封面图、主视觉、镜头草图参考。
2. 调用 `generate_image_from_text`。
3. `prompt` 必须包含角色一致性、vlog 场景质感、本期主题约束。
4. 轮询 `get_generation_status` 直到结束。
5. 成功后调用 `download_generation_asset`。

### `image2image`

若当前 MCP 或 provider 只接受单张主输入图，主输入始终使用固定 Alice 角色图；Alice 三视图仅作为一致性辅助参考。

若 `alice-assets.md` 中已经提供 Alice 三视图链接，在写 prompt 和检查结果时同时参考，但不得把三视图替代为主输入图。

若用户指定了 `客厅`、`餐厨`、`户外`、`室内`、`卧室`、`娱乐`、`工作`、`超市`、`健身`、`商圈` 等固定场景，必须同时读取 `references/alice-environment-library.md` 中对应分类，优先从同类参考图中保持空间连续性，不随意改户型、布局、采光方向或生活痕迹。

若当前镜头语义明确，允许根据 `references/alice-style-reference-map.md` 选择对应语义的效果融合参考图来替换默认效果示例图；若语义不明确或结果漂移，回退到默认效果融合参考图。

1. 使用固定 Alice 角色图 URL：`https://static.popi.art/media/image/2026/0527/97025_thumb.webp`
2. 若需要校准“动漫人物 + 真实世界中式现代生活场景”的融合效果，可参考示例图：`https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/storyboard/2026/02/05/590c6597bc3f49308dffa10fdce7f01d.png`
3. 上述示例图仅作效果参考，不是主角色参考；固定 Alice 角色图优先级最高。
4. 若已经有 MCP 或 provider 返回的正式图片地址，直接复用该地址。
5. 若输入只有本地图片，先调用 `upload_image`，再把返回的 `input_image_url` 传给 MCP。
6. 调用 `generate_image_from_image`。
7. `prompt` 必须包含角色一致性、vlog 场景质感、本期主题约束；若用户需要该效果，明确写出“保留 2D 动漫人物形象 + 真实世界中式现代生活场景”的目标；若当前是固定场景，还要明确要求延续 Alice 既有环境设定；若当前语义明确，可显式声明采用对应语义的效果融合参考方向。
8. 轮询 `get_generation_status` 直到结束。
9. 成功后调用 `download_generation_asset`。

### `image2video`

1. 输入必须是已确认可用的 Alice 静帧。
2. 若已经有上一张静帧的 MCP 或 provider 返回图片地址，优先直接复用该地址。
3. 若输入只有本地图片，先调用 `upload_image`。
4. 调用 `generate_video_from_image`。
5. `prompt` 必须补充镜头运动、情绪变化、动作节奏、转场或机位意图；若当前镜头发生在 Alice 的固定环境中，还要延续 `references/alice-environment-library.md` 中对应场景的空间连续性；若当前镜头语义明确，可沿用 `references/alice-style-reference-map.md` 中对应语义的风格融合方向。
6. 默认优先使用 `ratio: "9:16"` 或与当前发布目标一致的竖版比例，时长优先 5 秒。
7. 轮询 `get_generation_status` 直到结束。
8. 成功后调用 `download_generation_asset`。

## 失败与重试规则

- 如果结果中 Alice 未作为主角完整出现，或角色一致性明显不足，允许重试 1 次。
- 如果 provider 返回参数错误或模型不可用，精简参数后重试 1 次。
- 如果仍失败，返回原始错误并停止自动重试。
- 若 `image2video` 失败，简洁报告失败原因，并给出下一步建议：
  - retry later
  - switch to `image2image`
  - deliver still frames for review
- 不要默认声称静态图已经足够，除非用户明确接受静态 fallback。

## 输出格式（必须）

- 若结果是图片，正文第一屏必须直接显示：
  - `![Alice 生成图](<image_url>)`
- 紧接着必须给下载项：
  - `下载链接: <download_url>`
- 若结果是视频，必须额外输出：
  - `video_url: <url>`
- 同时输出结构化字段：
  - `mode`
  - `job_id`
  - `status`
  - `image_url` 或 `video_url`
  - `download_url`
  - `local_path`
  - `source_reference`
  - `consistency_check`

## 完成汇报约束（必须）

- 不得输出未核验完成宣称。
- 不要说“所有图片和视频都已上传并可以访问”。
- 不要使用“现在你可以看到完整项目内容了”“全部都可访问”“已全部完成”这类泛化收尾。
- 只汇报已从 MCP / provider 返回的事实：已生成的素材类型、返回的 URL、本地保存路径、已写入的画布节点。
- 若没有逐个访问 URL 并确认 HTTP 成功，必须明确标注为“待验证”。
- 若只完成了画布节点写入，不要把它表述为素材已上传或链接已可访问。
- 不使用庆祝性 emoji 或营销式完成语。

## 安全约束

- 不在用户可见输出中暴露：
  - 本地开发路径 `alice.jpg`
  - 完整 data URL
  - `asset://` URL
