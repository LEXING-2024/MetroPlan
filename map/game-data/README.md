# 地形图运行时数据包

这里的数据由 `map/analysis` 的 OSM 分析结果生成，**全面替换**内置地形图原来的点阵住宅 / POI / 就业数据。纯色图和自定义地图仍走 `buildField()` 旧路径。

## 生成

```powershell
cd F:\MetroPlan\map
node scripts/build-game-data.mjs
```

输出：

```text
map/game-data/terrain-field.json   （约 2.3 MB，住宅轮廓几何已从运行时移除）
```

运行时读取：

```text
src/maps/analysisField.ts
  → src/maps/terrain.ts 的 terrainField()
```

## 当前规模

| 内容 | 数量 |
|---|---:|
| 住宅区域（仅人口/密度，不绘制） | 1,109 |
| 住宅单元 zone | 118（30 个“余部”剔除） |
| 就业区 zone | 26 |
| POI zone | 588 |
| 全部 zone | 762 |
| 住宅 cell | 5,692 |
| 就业 cell | 3,856 |
| 生成住宅区域（不绘制） | 90 |
| 排除的“余部”单元 | 30 |
| 住宅点标注 | 1,069 |
| OSM population 标签 | 12 个 |
| POI | 692 |
| dots | 9,364 |
| 代表常住人口 | 1,120,582（区县普查控制后） |
| 代表岗位 | 385,600 |

数据来源：

- `residential-units-enriched-osm.geojson`（148 个住宅单元）
- `residential-communities.geojson`（643 个有名称小区）
- `buildings-osm.geojson`（5,756 栋 OSM 建筑）
- `game-pois-extended.geojson`（692 个 POI）
- `employment-areas.geojson`（26 个就业区）

## 生成规则

### 住宅

1. 取 `building_type = residential | unknown` 的建筑中心（仅用于人口/密度计算，不绘制轮廓）；
2. 加入 643 个有名称小区/住宅用地的中心；
3. 每个住宅单元至少补一个中心点；
4. 每个住宅 cell 的容量来自其住宅轮廓人口，不再固定 100 人；
5. 没有住宅用地 / 住宅建筑足迹的单元不能用 `total_building_footprint` 兜底（其中主要是工业厂房）；否则禄村会被算成 3.36 km² 的住宅区，再被控制总量放大到 6.8 万人。现在只按住宅足迹或 place 点给小村范围；
6. 运行时按 `population` 加权从 cell 抽 agent，而不是按 cell 个数平均抽；否则端州会独占八成 agent，鼎湖 / 高要几乎没人；
7. cell 归入最近的住宅单元 zone，用于 zone 统计。

### 住宅人口

- **12 个 OSM `population` 标签**作为真实值（`populationSource = osm`）；
- 有住宅楼层面积的轮廓按 `floorAreaM2 × personsPerM2` 计算（`floor-area`）；
- 没有建筑数据的村落按轮廓面积 × 1800 人/km² 兜底（`area-density`）；
- 每个住宅轮廓的 `population / areaKm2` 用于人口/密度计算；
- 因此 1,120,582 是“区县普查控制总量 + 真实标签 + 建筑面积分配”的游戏人口；区县总量来自 2020 普查，区内分配仍是模型。

### 就业

- 将 3,856 个就业 cell 按 26 个就业区的 `daily` 权重分配；
- 每个 cell 代表 100 个岗位；
- 在就业区半径内按种子随机撒点。

### POI

- 692 个 POI 全量进入 `field.pois`；
- 9 类：hospital / scenic / station / ferry / school / mall / park / stadium / industry；
- `industry` 不生成 POI zone（`POI_META.group = null`），其余 588 个生成；
- `level / daily / radius_km` 来自分析数据，`open/close/profile` 使用游戏既有类型默认值。

## 数据质量说明

- OSM 里 3,506 栋是 `building=yes`，用途未知；本包把 `residential + unknown` 都作为住宅候选，会高估部分工业/仓储建筑；
- 只有 12 个 OSM population 标签；其余人口是建筑面积/村落面积推算，不能当作真实普查；
- 小区中心是 `landuse=residential` 的几何中心，不是法定小区边界；
- 148 个住宅单元中 30 个是镇街余部派生单元；
- 就业 cell 是在就业区半径内生成的，不是逐栋厂房；
- POI 的 `daily` 是分析/游戏平衡估值，不是实测客流；
- `鼎湖山` 等个别入口坐标是近似值；
- 全部 OSM 数据遵循 ODbL，地图与文档保留 OpenStreetMap 署名。

## 回退

- 纯色图：`src/maps/plain.ts` → `buildField(PLAIN_ZONES, PLAIN_POIS, ...)`；
- 自定义地图：`src/sim/mapData.ts` → `buildPopulationField()`；
- 如果 `terrain-field.json` 缺失，Vite 构建会直接失败，不会静默回退——这是刻意的，避免数据替换后误用旧点阵。
