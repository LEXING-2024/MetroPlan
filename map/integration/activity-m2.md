# M2：活动链接入 Simulation

状态：**已实现并默认开启；`?activity=1` 已不需要**。  
默认是“混合客流 + 活动链”：通勤者多数仍走“家 → 工作 → 家”，但约三分之一的人会插入午间办事、下班购物 / 休闲 / 就医，少数家长会提前下班接孩子。旧 `outMin / backMin` 单次通勤模型只用于旧存档兼容。

![活动链模式下的游戏内画面](../preview/activity-mode.png)

## 如何开启

默认新游戏就是“混合客流 + 活动链”，不需要参数。需要纯通勤实验时：

```text
http://127.0.0.1:5173/?commuter=1
```

新手局也使用活动链；教程只引导建站/画线，不会改回旧模型。

## 现在发生了什么

开启后，每个 agent 不再只有“去程 → 返程”，而是得到一条 **1–6 段**活动链：

```text
家 → 工作 →（午间购物 / 办事 / 医院 → 工作）
     →（接孩子 / 购物 / 休闲 / 办事）→（第 2 个点）→ 家
```

- 第一段按原 `outMin` 出发，附加 ±3 分钟抖动；
- 在工作地至少停留 4–6 小时，避免“刚到就返程”；
- 约 12–26% 的通勤 / 灵活族会在午间插入一次 `工作 → POI → 工作`；
- 下班后按群体概率去 1 个购物 / 休闲 / 办事 / 就医 POI，6–20% 的人会再去第 2 个；
- 少数（约 7%）有孩子的通勤 / 反向通勤家长会在 16:00 左右提前离开去学校，然后直接回家；
- 任务结构按人稳定：约 80% 的人连续几天走同一条回家路线；只有约 20% 的不规律者（弹性 / 休闲 / 学生等）每天换任务。时间每天有 ±3–4 分钟抖动，但路线不变；
- **学生分成走读 / 住宿**：走读生工作日 `home → school → home`；住宿生把学校当工作日住处、家庭住址当周末目的地，`dayRule=2` 只在周末激活 `school → home → school`；学校 POI 的日吸引量只按走读比例计入，不再把全校学生都当成每天通勤；
- **每个 agent 有车辆 / 个人速度**：`vehicle = 0 步行 / 1 电动车 / 2 汽车`，`speedKmh` 是该 agent 的平均速度；约 58% 步行、32% 电动车、10% 汽车。没有车只步行，有车后任务链和背景行程按个人速度计时；
- **部分通勤者的工作地是 POI**：约 18% 的正向通勤者在商场 / 医院 / 学校 / 景区 / 车站等 POI 上班，`workAtPoi=1`，不会被当成访客硬截止或重选到就业区；
- 每一段都重新走 `planTrip`，有地铁可达就坐地铁；
- 没有地铁可达、或站点步行接受概率不通过时，走**背景方式**：
  - 步行 / 电动车 / 小汽车由车辆拥有决定；公交仍只用于 M1 合成人口；
  - 用背景时间推进，不占用列车容量；
- 背景行程进入**人流热力**（`AgentState.InBackground` 有位置插值与尾迹），但不占列车容量、不产生站点候车；站点热力仍只统计候车 / 乘车 / 排队。

## 关键实现

| 位置 | 改动 |
| --- | --- |
| `src/sim/activity/agentChains.ts` | 为现有 agent 生成 1–6 段活动链 |
| `src/sim/simulation.ts` | 活动链事件、动态下一段、背景方式、诊断 |
| `src/sim/types.ts` | 新增 `AgentState.InBackground` |
| `src/game/game.ts` | 默认传 `activity: true` + 混合客流；`?commuter=1` 切纯通勤 |
| `src/main.ts` | `window.__metro.activityModel()` 可单独查看 M1 |

### 事件流

```text
buildDayEvents()
  只排每个 agent 的第一段

startActivityTrip(i, 0)
  → planTrip() 成功：地铁状态机
  → planTrip() 失败 / 接驳概率不通过：InBackground

到达终点（WalkToDest / InBackground）
  → 记录 delivered
  → scheduleNextActivity()
  → 下一段到点后 startActivityTrip(i, next)
```

### 诊断

```js
window.__metro.game.sim.activityMode;     // true
window.__metro.game.sim.activityStats();
```

返回：

```text
mode, agents, chains, trips, multiTripAgents,
backgroundTrips, metroTrips
```

## 测试

```powershell
npx vitest run tests/activity-sim.test.ts
```

覆盖：

- 每个 agent 都有活动链；
- 多段链存在；
- 没有地铁时背景方式能完成行程；
- 有车站对时地铁方式被使用；
- `?activity` 关闭时旧 out/back 模型不变。

当前全量测试：**104/104 通过**。

## 当前限制

- 活动链只基于现有 agent 的 home/work，不是 M1 的完整合成家庭（没有家庭成员之间的接送合并）；
- 任务目的地由 POI 吸引力 / 距离概率决定，不是全知最优；医院 17:00 后、学校 17:00 后找不到开放 POI 时任务会被删掉；
- 背景方式不模拟道路容量、公交线路、停车和换乘；
- 没有硬截止 POI 的逐人取消逻辑；
- 任务结构按人稳定：约 80% 的人连续几天走同一条回家路线，只有约 20% 的不规律者每天换任务；所有人出发时刻有 ±3–4 分钟抖动，但一天之内不会因天气 / 心情临时改主意；
- 跨午夜仍在背景/地铁上的 agent 有边缘情况；
- 还没有“为什么没坐地铁”的 UI 面板，只有 `activityStats()` 控制台诊断。

## 下一步

M3 已接入步行图与方式比较，见 [activity-m3.md](activity-m3.md)。

- 增加“家 → 学校 → 单位”的前置送孩子链，并把家庭成员的接送合并到同一辆车；
- 把任务目的地从“出发时一次选定”升级为“到达前检查开放 / 排队，必要时改去附近备选”；
- 增加分目的（购物 / 就医 / 休闲 / 接孩子）的 UI 诊断；
- 继续压缩午夜在途 agent 的边缘情况。





