# bfc-inventory — 木材库存管理器

> 英文原版：[English](../README.md) · 在线计算器：[https://boardfootcalc.net](https://boardfootcalc.net/)

一个离线优先的木材库存数据库，带有**完整的交易流水账**。收货入库、用自然语言搜索、为项目预留和分配库存、在锯台上消耗板材，余料自动回库。基于 SQLite — 结构上杜绝负库存。

相关指南：Companion guide: [硬木板尺计算器](https://boardfootcalc.net/hardwood-board-foot-calculator/) · See also [如何按板尺购买木材](https://boardfootcalc.net/how-to-buy-lumber-by-board-foot/) · and [木材尺寸表](https://boardfootcalc.net/lumber-size-chart/)。

## 功能

- **SQLite 存储** — 使用 Node 内置的 `node:sqlite`，零原生编译，一个场地一个 `.db` 文件。
- **交易流水账** — 每次 增加/编辑/移动/预留/分配/释放/消耗/报废/出售 都会写入流水，记录前后快照，任何操作都有迹可循。
- **自然语言搜索** — `"找 至少 8/4 x 10 x 72 的胡桃木"` 自动解析为 厚度 ≥ 2"、宽度 ≥ 10"、长度 ≥ 72"、木种 胡桃木。
- **项目与分配** — 预留 → 分配 → 释放，提交前先算出 需求板尺 / 可用匹配板尺 / 缺口 / 潜在废料。
- **消耗与余料** — 从板材消耗一段长度，剩余部分作为关联父板的新余料项自动回库。
- **状态模型** — `AVAILABLE → RESERVED → ALLOCATED → CUT`，外加 `SCRAP` / `SOLD`，只允许受守卫的流转。

## 安装

```bash
git clone <your-repo-url> 04-lumber-inventory-manager
cd 04-lumber-inventory-manager
npm install
npm run build        # 编译到 dist/
npm test             # 15 个测试
```

## 快速开始

```bash
npm run demo
bfc-inventory search "at least 8/4 x 10 x 60 walnut"
```

完整命令参考、输入格式与实现原理请见[英文 README](../README.md)。

## 计算引擎

本工具内置了共享的 [BoardFootCalc Desktop 木材计算引擎](https://boardfootcalc.net)
的冻结副本（位于 `src/core/`，涵盖板尺、单位、标称/实际厚度、四分之一厚度、
浪费系数、木种、计价与 CSV）。五个工具共用同一套数学逻辑，因此这里算出的数字
与网站上的在线计算器完全一致。

## 许可

MIT。估算结果仅供规划参考 — 采购前请与您的木材经销商核实尺寸、锯缝与价格。
