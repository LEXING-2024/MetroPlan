# 车站面板：候车目的地与今日出站

![车站面板](../preview/station-destinations.png)

点击车站后，右侧卡片显示：

- 候车 / 容量；
- 今日进站 / **历史最高进站**；
- 今日出站 / **历史最高出站**；
- 建设费、日运营成本、接入线路；
- **当前候车目的地** Top 6。

## 当前候车目的地

`Simulation.waitingDestinationsAt(stationId)`：

1. 遍历该站的候车队列；
2. 取每个 agent 的最终 `tripDestX/Y`；
3. 用 `nearestZone()` 匹配目的地组团；
4. 按人数降序，取前 6 个。

显示的是**最终目的地**，不是下一站/换乘站。

## 今日出站

`exitsToday: Map<stationId, number>`：

- 只有乘客真正离开付费区时 +1；
- 换乘不算出站；
- 每日 00:00 结算时清空；
- 车站卡片 `今日出站` 显示该计数。

对应方法：

```ts
sim.exitsAt(stationId);
sim.waitingDestinationsAt(stationId);
```

## 历史最高进站 / 出站

每个车站保存：

```text
entriesBest  历史单日最高进站
exitsBest    历史单日最高出站
```

- 每天 00:00 结算时，把当日进站/出站与历史最高比较并归档；
- 卡片实时显示 `max(历史最高, 今日当前)`，所以当天创新高会立即显示；
- 历史最高随存档保存，重载后不会丢；
- 换乘不计入出站峰值，和“今日出站”口径一致。

测试：

```text
第一天：进站 144 / 出站 92
次日 04:59：今日进站 1 / 历史最高 144
             今日出站 0 / 历史最高 92
```

## 末班车后的站台

之前 `resetDaily()` 只清 `entriesToday`，不清 `queues`，所以末班车后站台会一直留着候车乘客，第二天车站卡片还显示人数。

现在：

- 所有列车回库且已过线路收班时间后，清空站台队列；
- 这些乘客计入当日 `cancelled`，状态回到 `IdleHome/IdleWork`；
- 00:00 结算时再次清空队列，防止跨日残留；
- 车上乘客、步行者、背景出行不会被午夜重置打断。

## 文件

```text
src/sim/simulation.ts   exitsToday / exitsAt / waitingDestinationsAt
src/ui/gameUi.ts        车站卡片今日出站 + 目的地列表
src/style.css           .station-dest 列表样式
```
