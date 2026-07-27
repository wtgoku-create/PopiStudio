---
name: content-quality-review
description: >-
  Use when reviewing new-media content before publishing or handing off: detect AI tone, hard-sell language, vague claims, weak hooks, unsupported data, platform mismatch, compliance risk, and missing CTA.
version: 1.0.0
official: true
name_i18n:
  zh: 内容质检
  en: Content Quality Review
description_i18n:
  zh: 发布前检查新媒体内容的 AI 腔、硬广感、弱钩子、证据不足、平台错位和合规风险。
  en: Review new-media content for AI tone, hard sell, weak hooks, unsupported claims, platform mismatch, and compliance risk.
---

# Content Quality Review | 内容质检

## Use When

- 用户要检查一篇内容能不能发
- 用户说“帮我看看哪里像 AI”
- 用户说“有没有硬广感”
- 用户要检查标题、脚本、公众号文章、小红书笔记
- 内容创作专家完成成稿后做发布前自检

## Review Dimensions

### 1. Platform Fit

- 小红书：是否真实、具体、可收藏、有评论引导？
- 抖音：前 3 秒是否抓人，口播是否能说出口？
- B站：标题封面、开场、章节和观点是否支撑完播？
- 公众号：导语、主线、小标题和结尾是否完整？

### 2. Human Voice

检查：

- AI 腔
- 书面腔
- 新闻稿腔
- 品牌通稿感
- 过度排比
- 空泛形容词
- 没有具体场景

### 3. Claim Safety

检查：

- 是否编造数据
- 是否承诺涨粉、爆款、成交、疗效、收益
- 是否使用绝对化表达
- 是否标题承诺大于正文内容
- 是否有需要证据但没有证据的判断

### 4. Conversion Naturalness

检查：

- CTA 是否太硬
- 评论引导是否自然
- 是否有下一步动作
- 是否过度卖货

## Output Format

```text
# 内容质检结果

## 总体判断
可发布 / 需要小改 / 需要重写

## 主要问题
1.
2.
3.

## 具体修改建议
1.
2.
3.

## 高风险表述
- 原句：
  问题：
  建议：

## 优化后示例
```

## Quality Checklist

- 只指出真实问题，不为了显得专业而挑刺。
- 每个问题都给可执行修改建议。
- 没有证据时，不判断平台趋势或数据表现。
- 不承诺修改后一定爆款、涨粉或成交。
