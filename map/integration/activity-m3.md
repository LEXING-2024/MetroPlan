# M3：步行路网 + 方式比较

状态：**已实现，默认开启；`?m3=0&m4=0` 关闭**。  
M3 自动包含 M2 活动链；默认混合局会加载 3.9 万节点步行图。

![M3 步行路网与活动链](../preview/m3-walk.png)

## 启用

```text
http://127.0.0.1:4173/?m3=1
```

开发模式：

```text
http://127.0.0.1:5173/?m3=1
```

## 现在做了什么

### 1. 本地步行图

`map/scripts/build-walk-graph.mjs` 从现有的离线 z14 OSM 瓦片中提取步行相关 `transportation` 图层：

- footway / path / pedestrian / steps；
- living_street / residential / service / unclassified；
- tertiary / secondary / primary / track；
- 按 class 分配步行速度（台阶更慢，普通道路 4.5 km/h）。

输出：

```text
map/data/walk-graph.json
  nodes: [[worldX, worldY], ...]
  edges: [[a, b, meters, speedKmh], ...]
```

当前规模：

```text
39,071 nodes
45,059 edges
约 1.6 MiB
```

z14 瓦片在边界处会截断道路，因此生成器会把孤立小分量用短连接边接到最大步行分量上；这是站点接驳的近似处理，不是完整 OSM 路由引擎。

### 2. 站点接驳

M3 在 `startActivityTrip()` 里不再只相信直线距离：

```text
trip 起点 → 步行图 → 起点站
地铁
终点站 → 步行图 → trip 终点
```

- 用 A* 在本地步行图上算实际步行分钟数；
- 把 `plan.walk1 / walk2 / total` 改成路网结果；
- 如果起点或终点 80m 内没有步行节点，或图不连通，回退背景方式；
- 记录 `walkRoutedTrips` / `walkFallbackTrips`。

### 3. 方式比较

M3 会比较：

```text
地铁方案总时间
vs
背景方式时间（步行 / 电动车 / 公交 / 小汽车）
```

只有当地铁方案不明显慢于背景方式时才坐地铁：

```text
plan.total <= background * 1.15
```

否则走背景方式。这是第一版方式选择，还没有分收入/时间价值的效用模型。

## 诊断

```js
window.__metro.game.sim.activityStats();
```

M3 新增：

```text
walkNodes
walkRoutedTrips
walkFallbackTrips
```

数据替换前的基线（12,055 个 agent）示例；替换后为 22,191 agent / 45,632 活动 trip：

```text
activity trips:       25,484
walkRoutedTrips:      11
walkFallbackTrips:    23
metroTrips:           1
backgroundTrips:      10,756
```

`walkRoutedTrips` 少是因为大部分 trip 在 `planTrip()` 阶段就没有地铁候选；只有站点附近的 trip 才进入 M3 接驳比较。这符合 M3 当前“只校核已有地铁方案”的范围。

## 测试

```powershell
npx vitest run tests/walk.test.ts
```

覆盖：

- 步行图能在主分量上算出路径；
- `walkNetwork: true` 时 Simulation 持有 `WalkRouter`；
- 有站点覆盖时产生路网接驳记录；
- M3 不会破坏旧模式。

全量测试：**104/104 通过**。

## 文件

```text
map/scripts/build-walk-graph.mjs   # 从离线瓦片生成图
map/data/walk-graph.json           # 节点/边
src/sim/walkRouter.ts              # A* 步行路由
src/sim/simulation.ts              # 站点接驳 + 方式比较
tests/walk.test.ts
```

## 当前限制

- 步行图来自 z14 矢量瓦片，缺少完整 OSM `foot/access` 属性和交叉口拓扑，已用分量连接补齐；
- 站点选择仍先用直线距离选候选，再用路网校核，不是“按路网时间重新选站”；
- 背景方式没有道路容量、公交时刻表、停车；
- 没有按收入/时间价值/换乘惩罚的完整 Logit；
- 没有步行坡度、过街等待、天桥/地下通道；
- M3 只对活动链模式生效，旧的默认模型保持原样；
- 读档仍会回到旧模型。

## 下一步

M4 已实现“用路网时间重新选站”，见 [activity-m4.md](activity-m4.md)。

- 用 DEM 给步行边加坡度；
- 加入步行坡度/过街惩罚；
- 背景方式使用道路/公交图；
- 用真实站点客流校准。





