---
name: wechat-article-writing
description: >-
  Use when the user wants a WeChat Official Account article draft: title options, opening hook, article outline, full long-form body, section headings, pull quotes, ending CTA, or rewriting a draft into a polished WeChat article. This skill is content-only and must not publish, scrape, log in, or call WeChat APIs.
version: 1.0.0
official: true
name_i18n:
  zh: 公众号长文创作
  en: WeChat Article Writing
description_i18n:
  zh: 创作公众号标题、导语、大纲、长文正文、小标题、金句和结尾引导。
  en: Draft WeChat Official Account titles, hooks, outlines, long-form articles, pull quotes, and CTAs.
---

# WeChat Official Account Article Writing | 公众号长文创作

## Use When

- 用户要写一篇公众号文章
- 用户要把主题扩写成长文
- 用户要标题、导语、小标题、金句、结尾引导
- 用户要把短视频/小红书/资料改成公众号版本
- 用户要把草稿改得更像公众号长文

## Input

优先读取：

- 主题或素材
- 目标读者
- 文章目标：传播、科普、观点、转化、建立信任、活动预热
- 语气：专业克制、故事感、观点犀利、品牌官方、个人号
- 字数范围
- 必须包含或不能写的内容

信息不足时，先按合理默认值生成初版，不要频繁追问。

## Writing Framework

### 1. Title Options

给 5-10 个标题方向，至少覆盖：

- 痛点型
- 结果型
- 观点型
- 故事型
- 清单型

避免标题党。标题承诺必须能被正文兑现。

### 2. Opening

导语要在前 200 字内说明：

- 这篇文章解决什么问题
- 为什么现在值得读
- 读完能得到什么

可选开头方式：

- 场景开头
- 问题开头
- 反常识观点
- 真实案例
- 数据/事实引入（没有真实来源时不要编造）

### 3. Body Structure

正文优先使用：

```text
导语
问题背景
核心观点
3-5 个分论点
案例/场景/操作建议
总结
行动引导
```

每个小节都要有明确小标题，不要大段堆叙。

### 4. WeChat Native Style

公众号长文要：

- 主线清楚
- 段落短一些
- 小标题有信息量
- 有具体例子
- 有判断，不只是罗列
- 金句自然，不硬凹
- 结尾有温和行动引导

避免：

- 新闻稿腔
- 品牌通稿腔
- 空泛价值观
- 过度堆砌排比
- 虚构数据、案例或权威背书

## Output Format

```text
# 公众号文章方案

## 标题备选
## 推荐标题
## 导语
## 正文
## 金句/摘要
## 结尾引导
## 排版建议
## 写作思路
```

## Quality Checklist

- 标题是否兑现正文？
- 导语是否有继续读的理由？
- 小标题是否有信息量？
- 正文是否有具体场景或例子？
- 是否有空话、AI 腔、通稿感？
- 是否没有编造数据、案例或引用？
- 结尾引导是否自然？
