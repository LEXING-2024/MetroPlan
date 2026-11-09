# 快车 / 慢车：80 / 120 km/h、动态停站与班距

![快慢车线路面板](../preview/ui2-mixed-line.png)

## 设计时速

`src/sim/constants.ts`：

```ts
LOCAL_TRAIN_SPEED_KMH = 80;
EXPRESS_TRAIN_SPEED_KMH = 120;
speedForTrainKind(kind);
```

- 慢车区段运行时间按 **80 km/h**；
- 快车区段运行时间按 **120 km/h**；
- 线路的 `speedKmh` 字段仅为旧存档兼容，实际运行不再使用它。

路径规划、列车运行、单程时间、班距估算都统一走 `speedForTrainKind()`。

## 动态停站时间

```ts
TRAIN_DWELL = 1.4;
TRAIN_DWELL_PER_BOARDING = 0.02;
TRAIN_DWELL_MAX_EXTRA = 2.6;
```

停站时间：

```text
1.4 分 + min(2.6 分, 本次上车人数 × 0.02)
```

快车和慢车使用同一规则；上车越多，停站越久，实际班距会被拉长。创建线路、加车、正常到站上车都会调用 `applyBoardingDwell()`。

## 班距显示

`Network.serviceHeadway(line, kind)` 按车种计算：

- 慢车周期 = 慢车单程 × 2 + 慢车停站；
- 快车周期 = 快车单程 × 2 + 快车停靠站停站；
- 班距 = 周期 / 该车种列车数。

线路面板在有快慢车的线路上显示：

```text
快车班距      ≈ 19 分钟
慢车班距      ≈ 10 分钟   半班距 ≈ 5 分
设计时速      慢车 80 · 快车 120 km/h
单程 · 慢车   14 分钟
```

没有快车时只显示慢车班距；没有慢车时只显示快车班距。

## 运行动画

- 线路按区段二次贝塞尔轻微弯曲：控制点偏离弦线 `min(26px, 弦长 × 0.11)`，线路不再像直尺画出来的一样直；
- 列车位置和线路共用 `src/sim/lineCurve.ts` 的同一条曲线，不会跑出线路；
- 列车位置用 `smoothTravel(prog)`（smoothstep）缓动：
  - 起步时速度从 0 逐渐增加；
  - 进站前逐渐减速到 0；
  - 停站时车头精确对齐站点，不再从站台前方 3% 处“跳一下”；
- 反向运行时沿同一条曲线倒着走，车头角度加 180°。

![曲线线路与列车](../preview/ui2-curves.png)

曲线与缓动有独立测试：`tests/line-curve.test.ts`。


