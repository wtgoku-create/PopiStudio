# Alice 效果融合参考映射

这份映射用于为 Alice 的 `image2image` 与 `image2video` 选择更贴近当前语义的效果融合参考图。

它的职责是控制：

- `2D 动漫人物 + 真实世界中式现代生活场景` 的融合方式
- 光线、镜头气质、生活化氛围、真实空间质感

它不负责：

- 替代固定 Alice 角色图
- 替代 Alice 三视图
- 替代 `alice-environment-library.md` 的空间连续性控制

## 使用规则

- 固定 Alice 角色图始终是第一优先级。
- Alice 三视图始终只负责角色结构一致性。
- 效果融合参考图可以根据当前镜头语义替换，但只替换“风格融合参考”，不替换角色主参考。
- 若当前镜头语义明确，优先选用对应语义分类下的 1 张效果融合参考图。
- 若当前镜头语义不明确，或多类语义冲突，回退到默认效果融合参考图。
- 单次生成最多带 1 到 2 张效果融合参考图，避免风格冲突。
- 若结果出现角色漂移、空间漂移或过度写实导致失去 2D 人物感，立即回退到默认效果融合参考图。

## 默认效果融合参考图

适用：泛用场景、语义不明确场景、首次试跑、回退兜底。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/storyboard/2026/02/05/590c6597bc3f49308dffa10fdce7f01d.png

## 语义映射

### 居家客厅 / 陪伴感 / 沙发区 / 回家后放松

适用：窝在客厅、和小白互动、看电视、沙发区放空、黄昏回家。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2025-12-22T07-49-00-798Z-1970dff0-cf1e-4830-82f5-25495cba3969.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2026-01-31T10-44-49-425Z-81149a86-c685-4ace-8b58-6d4131241761.png

### 餐厨 / 做饭 / 摆盘 / 一人食 / 早餐

适用：做饭、煎蛋、洗菜、端盘子、餐桌准备、一人食。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2026-01-20T07-00-24-797Z-c11c73fd-8de5-4bec-91aa-40d66977dabc.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-195051.jpg

### 卧室 / 起床 / 睡前 / 私域安静时刻

适用：起床、伸懒腰、刷牙后回卧室、睡前阅读、床边安静镜头。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2026-01-15T03-51-13-837Z-9c83e683-f36e-4666-adb0-7227e3a60e24.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-183242.jpg

### 户外 / 遛狗 / 出门 / 小区散步 / 通勤在路上

适用：遛狗、下楼、步行、街边、出门前后、户外过渡镜头。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2025-12-23T08-25-20-970Z-d8b00093-f8a7-4aa6-856c-bc8978734ebf.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-194031.jpg

### 工作 / 桌面 / 专注状态 / 居家办公

适用：坐在桌前、打字、开会、改方案、认真工作。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2026-01-30T09-58-14-707Z-8e7cf23a-14dd-4ca5-b60f-648820de5c27.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-195059.jpg

### 超市 / 买菜 / 采购 / 货架动线

适用：推购物车、拿商品、逛货架、采购生活用品。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-183257.jpg
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-nano_banana_pro_2026-03-12T11-18-30-080Z.jpeg

### 健身 / 拉伸 / 运动 / 健康生活片段

适用：跑步机、拉伸、器械训练、运动后恢复。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-2025-12-29T10-46-03-477Z-0a9d03e7-b407-424b-8c19-815955d612ca.png
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-nano_banana_pro_2026-03-12T11-21-29-317Z.jpeg

### 商圈 / 逛街 / 外出办事 / 城市生活感

适用：商场、街区、逛街、顺路办事、城市生活方式镜头。

- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-20260312-183318.jpg
- https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/2026-03-12-nano_banana_pro_2026-03-12T11-17-01-933Z.jpeg

## 选择建议

- 若语义是“在家里但未明确房间”，优先尝试：
  - 客厅日常动作 -> `居家客厅 / 陪伴感 / 沙发区 / 回家后放松`
  - 做饭或吃饭 -> `餐厨 / 做饭 / 摆盘 / 一人食 / 早餐`
  - 起床或睡前 -> `卧室 / 起床 / 睡前 / 私域安静时刻`
- 若语义是“出门但未明确地点”，优先尝试：
  - 遛狗、散步、楼下 -> `户外 / 遛狗 / 出门 / 小区散步 / 通勤在路上`
  - 买东西 -> `超市 / 买菜 / 采购 / 货架动线`
  - 逛商场或办事 -> `商圈 / 逛街 / 外出办事 / 城市生活感`
- 若镜头主要强调“动作功能”，优先按动作选语义，不按大场景名机械匹配。
