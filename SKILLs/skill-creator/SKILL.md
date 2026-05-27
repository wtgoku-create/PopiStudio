---
name: skill-creator
display-name-zh: 技能创建
summary-cn: 把当前对话流程保存成可复用的技能
summary-en: Save current flow as reusable skill
description: |
  创建新 Skill、修改已有 Skill、将当前对话流程保存为可复用的 Skill，
  以及引导用户从市场安装 Skill、理解目录结构。
  触发词：创建skill、修改skill、保存为skill、把这个保存下来、
  变成技能、固化流程、记住这个做法、下次还想这样做、
  安装skill、下载skill、skill市场、管理skill、
  create skill、save as skill、turn this into a skill、
  make this reusable、update skill、install skill、setup skill。
  Also trigger when the user reviews a completed creative output and expresses intent
  to repeat the same process with different inputs.
version: 2.0.1
tags:
  - Tools
  - Meta
  - Skill
tags-cn:
  - 工具
  - 元
  - 技能
guide-prompt: 帮我使用它来创建一个新的技能。首先询问我这个技能应该做什么。
guide-prompt-en: Help me use it to create a new skill. First ask me what this skill should do.
exported-by: MiniMax-hub
official: true
category: 内容创作
---

# Skill Creator & Manager

创建、修改、安装和管理 Skill。本应用有一个 orchestrator（media-agent）
和多个子 agent：**image**、**video**、**audio**、**editing**。
大部分 Skill 协调这些 agent 完成创意产出。

## 目录结构

| 目录 | 用途 | 谁管理 |
|------|------|--------|
| `~/.hub/skills/` | **市场安装的 Skill** | 应用自动管理，不要手动修改 |
| `~/Movies/Hub/skills/` | **用户创建/编辑的 Skill** | 用户完全控制 |

用户目录优先级更高：同名 Skill 时用户目录的版本生效。

## 从市场安装 Skill

引导用户通过应用内的 Skill 广场页面操作：

1. 打开应用 → 进入「Skill 广场」页面
2. 浏览 Market tab 中的可用 Skill
3. 点击「安装」按钮
4. 安装完成后在 Skill 列表中启用

安装的 Skill 存放在 `~/.hub/skills/`，由应用管理，支持自动更新。

---

## 创建 Skill 流程

```
1. Capture Intent   --  理解工作流
2. Write SKILL.md   --  编写 Skill
3. Review & Iterate --  用户反馈循环
4. Validate         --  触发测试 + 工作流走查
5. Save & Reload    --  保存到用户目录 + 触发加载
6. Iterate (optional) -- 基于实际使用改进
```

### 三种使用场景

**场景 A：保存当前对话流程**
对话中已经完成了一个工作流，用户想把它固化为 Skill 以便复用。
→ 从对话历史提取工作流，进入 STEP 1。

**场景 B：从零创建新 Skill**
用户有一个想法但还没有执行过，想直接创建 Skill。
→ 通过问答了解需求，进入 STEP 1（从头创建分支）。

**场景 C：修改已有 Skill**
用户想调整一个已存在的 Skill（改步骤、改参数、改触发词等）。
→ 读取现有 SKILL.md，了解修改意图，直接进入 STEP 2 修改。

### 什么值得保存为 Skill

不是每个工作流都值得保存。至少满足以下两条时才建议保存：

- **复杂度**：3 步以上、涉及多个 agent、或有分支逻辑
- **可复用**：用户可能用不同输入重复做同样的事
- **隐性知识**：包含不显而易见的技巧——模型选择、参数调优、
  失败时的应对方法、创意技法
- **纠错历史**：用户在流程中做了修正，这些修正适用于未来的执行

如果工作流是简单的一次性操作（如"生成一张图"），建议用户下次直接描述即可。

---

## STEP 1: Capture Intent

### 场景 A：从对话历史提取

对话中很可能已包含完整工作流。先从对话历史提取，不要问已有答案的问题。

#### 获取对话历史

如果当前上下文不包含完整工作流（发生在之前的会话），
通过 agent 自身的对话历史能力查询之前的会话记录。

**Skill 嵌套**：Skill 不能嵌套调用其他 Skill。如果对话历史中有 Skill 调用，
直接读取被引用 Skill 的 SKILL.md 了解它做了什么，不要尝试重新调用。

#### 从对话历史中提取：

1. **发生了什么**：使用了哪些能力，什么顺序
2. **媒体流转**：输入（音频、图片、文本）→ 中间产物 → 最终输出
3. **创意目的**：核心意图
4. **用户做的关键决策**：模型选择、参数调整、风格方向
5. **出错并修正的地方**：失败、重试、参数变更——这些是最有价值的知识
6. **用户没有改动的地方**：默认值正常工作也是信息，说明这些参数可以保持灵活

#### 确认理解

> "我从对话中提取了这些：[摘要]。这样对吗？"

如果用户纠正或提供自己的描述，以用户的为准。

### 场景 B：从零创建

如果没有现有工作流，通过问答了解需求：

- 输入是什么？最终输出是什么？
- 大致的步骤顺序？
- 有特定的模型或技术要求吗？
- 有什么约束（比例、时长、分辨率、风格一致性）？
- 最难的部分是什么——agent 在哪里容易出错？

### 场景 C：修改已有 Skill

1. 读取目标 Skill 的 SKILL.md
2. 了解用户想修改什么
3. 直接跳到 STEP 2 进行修改

---

## STEP 2: Write the SKILL.md

### 目录结构

```
skill-name/
├── SKILL.md           (必须 — Skill 定义)
├── scripts/           (可选 — 可复用脚本)
└── references/        (可选 — 按需加载的参考文档)
```

### 三层加载机制

1. **元数据**（name + description）— 始终在 agent 上下文中，用于触发匹配
2. **SKILL.md 正文** — Skill 触发后加载，控制在 500 行以内
3. **附带资源** — 按需加载。大文档放 `references/`，可执行脚本放 `scripts/`

### Frontmatter

必填字段：

```yaml
---
name: my-skill                    # kebab-case，和目录名一致
description: |
  详细描述，第一行是摘要。
  包含触发词，方便 agent 匹配。
  触发词包括：关键词1、关键词2。
summary-cn: 中文摘要，不超过二十五个汉字
summary-en: English summary, up to thirty words
version: 0.1.0
tags: [Video, Creative]
trigger-words: [关键词1, 关键词2, keyword1, keyword2]
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | kebab-case，和目录名一致 |
| `description` | ✅ | 详细描述 + 触发词（200-500 字符） |
| `summary-cn` | ✅ | 中文 UI 摘要（≤25 汉字） |
| `summary-en` | ✅ | 英文 UI 摘要（≤30 词） |
| `version` | ✅ | 语义化版本 |
| `tags` | 可选 | 分类标签 |
| `trigger-words` | 可选 | 触发词列表 |
| `allowed-tools` | 可选 | 依赖的 MCP 工具名 |

#### Description 写作要点

- **长度**：200-500 字符
- **语气**：描述用户意图，不是实现细节
- **覆盖**：包含多种表述（正式/口语/中英文）
- **边界**：和相近 Skill 有歧义时，加简短区分说明
- **反模式**：不要在 description 里写实现步骤

### 正文结构

1. `# Skill Name` — 标题
2. 简介段 — 何时使用、涉及什么媒体类型
3. 分步骤 — `## STEP N: 步骤名`

使用 `references/SKILL-TEMPLATE.md` 作为起始模板。

### 写作原则

#### 描述任务，不描述路由

- Good: "生成一张 16:9 的主角肖像画——红裙年轻女性，电影感光线"
- Bad: "调用 image agent，使用 nano_banana 模型生成..."

#### 只在用户明确指定时提及模型

用户说"用 Kling 生成视频"就记录。agent 自动选的默认值不要写死。

#### 解释约束背后的原因

- Good: "最终合成前去掉对口型片段的音轨，因为合成步骤会加原曲，重复音轨会造成叠音"
- Bad: "必须用 `-an` flag"

#### 捕捉创意流程，不是实现细节

- Good: "分析音乐的情绪变化、节奏转折和人声段落"
- Bad: "调用 `read_media`，参数 question 设为..."

#### 批量处理，不要交替

- Good: "一次生成所有场景图，然后一次生成所有视频"
- Bad: "每个片段：先生图，再生视频，然后下一个"

#### 在创意决策点加用户确认

在高成本操作（视频生成、最终合成）前加确认步骤。不要每个小步骤都确认。

#### 编码用户的纠错，不只是成功路径

重试和修正是最有价值的知识。

#### 从具体中提炼通用

- Good: "分析音频确定段落边界"（通用）
- Bad: "在 0:45, 1:30, 2:15 处分割"（特定文件）

#### 所有输出都在会话项目目录

不要硬编码输出路径。使用工具返回的文件路径进行后续操作。

#### 正文 500 行以内

超出部分放 `references/`，可执行模式提取到 `scripts/`。

---

## STEP 3: Review & Iterate

展示完整 SKILL.md 给用户：

> "这是我编写的 Skill，看看有什么需要调整的？"

常见修改：调整步骤顺序、改模型选择、调参数灵活度、加边界情况处理、
改触发词、去掉过度具体的指令。

---

## STEP 4: Validate

### 4a: 触发测试

1. **写 6 个测试查询** — 3 个应该触发，3 个不应该触发
2. **自测**：只看 name 和 description，问自己"会触发吗？"
3. **给用户看**：展示测试查询和预期结果

### 4b: 工作流走查

用一个不同于原始对话的假设场景，逐步走查：

- [ ] **完整性**：每一步的输出是下一步需要的输入吗？
- [ ] **通用性**：有没有步骤绑定了原始对话的具体内容？
- [ ] **确认点**：用户确认在高成本操作之前吗？
- [ ] **失败路径**：生成失败时 Skill 有指导吗？
- [ ] **批量策略**：同类资源是批量处理还是逐个交替？

---

## STEP 5: Save & Reload

用户确认后保存到用户 Skill 目录：

### 1. 创建目录并写入

```bash
mkdir -p ~/Movies/Hub/skills/<skill-name>
```

将 SKILL.md 保存到 `~/Movies/Hub/skills/<skill-name>/SKILL.md`。

如有 references 或 scripts，创建对应子目录。

### 2. 验证引用完整

保存后确认 SKILL.md 中引用的所有文件都存在：

```bash
grep -oE '(references|scripts)/[^\s`"]+' ~/Movies/Hub/skills/<skill-name>/SKILL.md | \
  while read f; do
    [ -f ~/Movies/Hub/skills/<skill-name>/"$f" ] || echo "MISSING: $f"
  done
```

### 3. 触发 Skill 重新加载

保存完成后，调用 `hub_reload_skills` 工具触发 OpenCode 重新加载 Skill 列表。
如果当前有活跃会话，用户会看到一个通知条提示确认重启；如果没有活跃会话，重载会自动静默完成。

### 4. 告知用户

- Skill 已保存到 `~/Movies/Hub/skills/<skill-name>/`
- 已触发重新加载，新 Skill 可在当前或下次会话中使用
- 列出 Step 4a 的 3 个触发测试查询作为示例

---

## STEP 6: Iterate & Improve (Optional)

Skill 的第一版很少是最好的。实际使用后再来改进。

### 观察信号

| 信号 | 含义 | 修复 |
|------|------|------|
| Agent 没触发 Skill | description 缺少用户的说法 | 扩充触发词 |
| 触发了但执行差 | 指令不清晰或有歧义 | 澄清步骤，加示例 |
| 不该触发时触发了 | description 太宽泛 | 加边界说明 |
| Agent 每次都写类似脚本 | 重复工作未打包 | 提取到 `scripts/` |
| 用户每次都改同一步 | 约束不够紧 | 加明确指导和原因 |
| Agent 做了多余的事 | 指令导致无效工作 | 删除或简化 |

### 改进流程

1. 收集 2-3 次使用的证据
2. 诊断：触发问题（description）、执行问题（正文）、还是缺资源？
3. 精准修复：只改有问题的部分
4. 重新验证（跑 Step 4 checklist）
5. 修改后同样调用 `hub_reload_skills` 触发重新加载
