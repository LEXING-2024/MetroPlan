# M4：按步行路网重新选站

状态：**已实现，默认开启；`?m4=0` 关闭**。  
M4 自动包含 M2 活动链和 M3 步行路网；默认混合局跑 M2 + M3 + M4。

![M4 路网选站与活动链](../preview/m4-station-choice.png)

## 启用

```text
http://127.0.0.1:4173/?m4=1
```

开发模式：

```text
http://127.0.0.1:5173/?m4=1
```

## M4 修的是什么

M3 是“先按直线选站，再用步行图校核”；如果直线最近的站实际要走很远，M3 只能放弃地铁、退回背景方式。

M4 把顺序反过来：

```text
每个候选站
  → 步行图实际到站时间
  → 与乘车时间一起进入 pathfinding
  → 选总时间真正最短的站
```

这样不会因为“最近站没线路”或“最近站实际绕路”而误判。

## 实现方式

### 1. 站点步行场

`src/sim/walkRouter.ts` 新增：

```ts
stationAccess(point, station): number | null
```

- 每个车站第一次被使用时，从该站做一次 Dijkstra，生成覆盖整张步行图的分钟场；
- 后续任意 home / work / POI 到该站只需查最近节点 + 连接距离；
- 不会为每个 agent 跑一次 A*。

### 2. pathfinding 接收真实接驳成本

`PlanOptions` 新增：

```ts
accessStation?: (
  fromX, fromY,
  stationX, stationY
) => number | null;
```

`planTrip()` 的起点候选和终点候选都改为用 `accessStation` 计算步行时间；返回 null 的站直接剔除。

### 3. 站点选择与方式选择分离

- `planTrip()` 负责选站和线路方案；
- `startActivityTrip()` 负责比较地铁总时间与背景方式；
- 地铁只有在不明显慢于背景方式时才使用。

## 诊断

```js
window.__metro.game.sim.activityStats();
```

M4 新增：

```text
walkChoice: true
walkRoutedTrips
walkFallbackTrips
```

数据替换前的基线（12,055 agent）示例；替换后为 22,191 agent / 45,632 活动 trip：

```text
walkNodes:         39,071
walkRoutedTrips:   32
walkFallbackTrips: 9,825
metroTrips:        1
backgroundTrips:   9,856
```

`walkFallbackTrips` 包含“站点距离太远 / 站点不连通 / 没有可用方案”的情况；M4 仍然让这些出行走背景方式。

## 测试

```powershell
npx vitest run tests/walk.test.ts
```

覆盖：

- 步行图 A* 路径；
- M3 站点接驳；
- M4 `walkChoice` 开关与真实站点 access；
- 有站点覆盖时产生路网接驳记录；
- 旧模式不受影响。

全量测试：**80/80 通过**。

## 当前限制

- 步行图仍是 z14 瓦片 + 分量连接近似，不是完整 OSM 拓扑；
- 候选站先用 Euclidean 1.5 倍半径预筛，再做路网时间，极端绕路可能被预筛掉；
- 站点步行场按站缓存，频繁新建大量车站会消耗内存；
- 没有坡度、过街等待、天桥/地下通道；
- 纯步行方案仍用 Euclidean 时间，没有走步行图；
- M4 只对活动链模式生效；
- 读档仍会回到旧模型。

## 下一步

- 用 DEM 给步行边加坡度成本；
- 用过街/天桥数据加惩罚；
- 对纯步行方案也走路网；
- 用真实站点客流校准。
