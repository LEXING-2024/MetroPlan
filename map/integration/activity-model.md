# M1：活动需求模型数据层

状态：**M1 已实现；`?m1=1` 时作为 Simulation 的 agent/活动链来源**。  
M1 本身仍是独立、可测试的“地点 → 家庭/个人 → 活动链 → O/D → 背景方式”数据层；默认游戏是 M2 混合客流，M1 只通过 `?m1=1` 作为进一步实验源。

## 为什么先做 M1

直接替换 `Simulation` 会同时改需求生成、事件循环、站点选择、统计和 UI，风险很高。M1 先把“人”和“地点”建对，完成后再在 M2 用 feature flag 接入。

## 数据模型

```text
ActivityPlace
  id, kind, name, x, y, zoneId
  capacity, attraction, openMin, closeMin
  poiId?

Household
  id, homePlaceId, weight, personIds[]

Person
  id, householdId, homePlaceId
  age, role
  workPlaceId?, schoolPlaceId?
  hasCar, hasEBike, weight
  escortStudentId?

ActivityPlan
  personId
  activities: [{ purpose, placeId, startMin, endMin, flexible }]

ActivityTrip
  personId
  fromPlaceId → toPlaceId
  purpose, departMin, arriveMin
  distanceKm, mode
```

核心定义：

- **起点** = 上一次活动地点；
- **终点** = 下一次活动地点；
- **站点不是 O/D**，只是以后路径选择的结果；
- **home / work / school** 是长期锚点；
- **shopping / leisure / medical / errand** 是弹性活动；
- `Place.zoneId` 只用于统计和校准，agent 本身使用点坐标。

## 当前地点库来源

M1 先用现有游戏数据，不先爬全量 OSM 建筑：

- `PopulationField.residential` → `home` 地点；
- `PopulationField.employment` → `work` 地点；
- `PopulationField.pois` → 学校、医院、商场、公园/景区；
- 普通混合区 → `mixed` 街区机会池。

这是刻意的过渡方案：先验证数据结构和行为，再在 M1.5/M3 把来源换成 OSM 建筑/POI 全量候选库 + 100m 网格兜底。

## 生成流程

```text
buildPlaceLibrary(field)
  → buildSyntheticPopulation(field, places)
      抽样家庭
      生成成人/儿童/老人
      分配工作地（按岗位容量 + 距离衰减）
      分配学校（按距离 + 容量）
      计算 person / household 权重
  → buildPlansAndTrips(persons, field, places)
      活动链模板
      弹性目的地效用选择
      背景方式选择
      生成 trip 时间
  → summary
```

### 家庭与角色

- 1–3 个成人；
- 0–2 个儿童；
- 0–1 个老人；
- 成人：worker 或 homemaker；
- 6–17 岁：student；
- 0–5 岁：child；
- 65+：retiree；
- 一个 worker 家长可能承担 school escort。

### 活动链

| 角色 | 典型链 |
| --- | --- |
| worker | 家 → 工作 →（可选购物/休闲）→ 家 |
| worker + 接送 | 家 → 学校 → 工作 → 学校 → 家 |
| student | 家 → 学校 →（可选休闲）→ 家 |
| homemaker / retiree | 家 → 购物/休闲/就医 → 家 |
| child | 家 |

### 弹性目的地

- 候选地点按类型过滤；
- 检查营业时间；
- 效用：`ln(吸引力) − 距离/衰减 + 随机项`；
- 医疗的距离衰减更短，休闲更长；
- 选中后再在规划层插入活动。

### 背景方式

M1 只有非地铁方式：

- 步行 4.5 km/h；
- 电动车 15 km/h；
- 公交 18 km/h + 8 分钟候车；
- 小汽车 30 km/h + 5 分钟停车，按距离计费。

这是占位模型，**不参与当前游戏客流**；M3 会加入地铁选项和路网时间。

## 如何验证

```powershell
cd F:\MetroPlan
npx vitest run tests/activity.test.ts
```

测试覆盖：

- 地点/家庭/个人/计划/行程存在；
- 每个人都有合法 home；
- worker 有 workplace，student 有 school；
- 活动链从家开始、到家结束、时间单调；
- trip 的起终点合法、时间在一天内、方式合法；
- 同一 seed 完全可复现。

浏览器调试入口（不会自动运行，也不影响当前游戏）：

```js
const model = window.__metro.activityModel({ seed: 20260101 });
model.summary;
```

## 默认参数下的参考结果

用当前地形图、默认 seed、4200 个抽样家庭运行：

```text
places:     home 5692 / work 3856 / school 285 /
            shopping 16 / leisure 159 / medical 72 / mixed 0
households: 4200
persons:    10136
trips:      19121
mobile:     8074
avg trip:   9.13 km
mode:       walk 1388 / ebike 2624 / bus 11918 / car 3135
residents:  1120039
```

这些是**模型输出**，不是游戏最终客流；它们只用于验证数据结构和行为。

## 当前限制

- 地点来源已切换到 `map/analysis` 数据包（住宅单元/小区/建筑/692 POI/26 就业区）；
- 住宅候选把 `building=yes` 未知用途建筑也纳入，可能高估部分工业/仓储；
- 人口只有 12 个 OSM `population` 标签是真实值，其余按住宅楼层面积/村落面积推算；
- 没有步行路网，距离仍是直线；
- 没有地铁方式，只有背景方式；
- 没有真实人口/岗位校准；
- 只有基础活动链，没有多目的链、周末/节假日、天气、家庭车辆分配；
- 通过 `?m1=1` 接入 `Simulation`，作为混合客流的进一步实验；
- 构建默认模型约 1.8 秒（浏览器），M2 需要缓存/Worker/预计算。

## M2 状态

M2 已是默认：混合客流 agent 按群体生成活动链，地铁不可达时使用背景方式；`?commuter=1` 可切纯通勤实验。详见 [activity-m2.md](activity-m2.md)。

## 文件

```text
src/sim/activity/
├─ types.ts
├─ places.ts
├─ population.ts
├─ choice.ts
├─ activities.ts
└─ index.ts
tests/activity.test.ts
```
