# Android 设计系统迁移指南

## 📋 文档概述

本文档详细说明了 ClaudeLink Android 客户端从现有的硬编码样式向标准化 Material Design 3 设计系统的迁移方案。该迁移将解决当前代码中存在的主题一致性、可维护性和可访问性问题。

---

## 1. 现状问题分析

### 1.1 颜色问题（10个）

#### 问题清单

1. **硬编码颜色值泛滥**
   - `activity_main.xml`: 8处硬编码颜色（`#0A0D12`, `#1E2636`, `#4A90E2`, `#E74C3C` 等）
   - `item_task_card.xml`: 使用 `@android:color/black` 和 `@android:color/darker_gray`
   - **影响**: 无法响应系统主题切换，维护困难

2. **缺少主题属性引用**
   - 所有颜色都是直接引用，未使用 `?attr/colorPrimary` 等 MD3 主题属性
   - **影响**: 无法通过主题统一调整配色方案

3. **暗色主题支持不完整**
   - 缺少 `values-night/colors.xml`
   - **影响**: 在强制暗色模式下对比度不足，用户体验差

4. **颜色语义不清晰**
   - `colors.xml` 中定义了 `primary`、`primary_variant`、`primary_light`，但未映射到 MD3 角色
   - **影响**: 团队成员无法快速理解颜色用途

5. **对比度合规性未验证**
   - 未进行 WCAG AA 标准验证（要求文本对比度 ≥ 4.5:1）
   - 例如: `#6366F1`（primary）在 `#1E2636`（surface）上的对比度可能不足
   - **影响**: 可访问性不达标，可能被应用商店拒绝

