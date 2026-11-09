# 汽车三段式路径

![汽车三段式热力](../preview/car-three-leg.png)

汽车不再整段走机动车图，而是拆成：

```text
起点
  → 步行到最近可行驶主路节点
  → 机动车图行驶
  → 下车后步行到终点
```

## 实现

`WalkRouter.carRoute()`：

1. 在起点/终点 `maxAccessPx=160`（约 3.2 km）内找最近机动车主分量节点；
2. 接入、接出优先用步行图 `route(..., 'walk')`；
3. 中间段用 `aStar(..., vehicle=true)`，只走 `vehicleSpeed > 0` 的边；
4. 路径拼接去重；
5. 时间：

```text
accessMinutes + driveMinutes + egressMinutes
```

Simulation 在 `processBackgroundRoutes()` 中：

- 汽车 `bgMode=3` 调 `carRoute()`；
- 找到后写回 `backgroundPaths`，并用三段总时间更新 `bgTotal/walkLeft`；
- 失败回退步行图；
- 仍失败回退直线。

## 实测

07:32、无地铁：

```text
正在移动：2,010
已取得路网路径：1,410
汽车：283
  有完整三段路径：198
  回退：85
FPS：约 90
```

汽车路径最短 16 个折点，最长 743 个折点。

## 仍然回退的汽车

85 个汽车回退主要因为：

- 起终点 3.2 km 内没有机动车主分量节点；
- 最近的机动车节点在孤立碎片；
- 机动车主分量之间不连通；
- z14 缺少小区内部路/停车场。

## 限制

- 接入/接出点是最近主路节点，不是真实停车场/路侧车位；
- 没有停车容量、停车费、拥堵；
- 公交仍是旧背景方式，没有线路/班次；
- 找不到主路时回退直线，不伪造路径；
- 路径缓存不写入存档，读档后重新分帧生成。

## 文件

```text
src/sim/walkRouter.ts       carRoute / vehicle graph
src/sim/simulation.ts       processBackgroundRoutes 汽车分支
map/scripts/build-walk-graph.mjs  vehicleSpeed 边属性
tests/walk.test.ts          三段式路径测试
```
