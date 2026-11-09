# 山区/水域建站与跨河路径

状态：已接入内置地形图。纯色图/自定义地图保持原来的自由放置。

![山体与水域限制](../preview/heat-background.png)

## 建站限制

`canPlaceStation()` 在内置地形图上读取 `map/game-data/terrain-rules.json`：

- 20 px（约 400 m）网格；
- 来自 `dem_crop.npy` 的 **最大坡度**；
- 来自底图水色的 **水域占比**。

规则：

```text
水域占比 > 25%        → 拒绝：水域不能建站
最大坡度 > 22°        → 拒绝：山体坡度过陡
```

- 预览阶段就会显示红色 / 不可放置；
- 点击后 toast 显示具体原因；
- 纯色图和自定义地图不读取这套地形规则；
- 测试/程序化 Simulation 默认 `enforceTerrain=false`，游戏新局显式开启。

### 为什么用 22°、25%

- 22° 是一般地铁地面站/高架站的施工舒适上限；
- 更陡的山体需要隧道/高架专项，当前没有这套成本模型；
- 水域占比取 400 m 网格，避免把河岸/码头边缘一刀切；
- 这是**规划约束**，不是工程可行性报告。

## 跨河 / 沙浦

### 旧方式

- M2 背景方式从起点到终点直接插值，直线穿过西江；
- 站点接驳在 M3 才用步行图；
- 因此沙浦等被江隔开的地方，热力/步行会“水上飘”。

### 现在

1. `terrainRules.crossesWater()` 检测背景直线是否穿过水域；
2. 如果穿过，且有步行图：
   - 用 `WalkRouter` 走桥/渡口路径；
   - 用路网时间替代直线方式时间；
   - 热力按这条折线画尾迹；
3. 步行图新增 `ferry` 类边：
   - 渡口速度 6 km/h；
   - 桥仍是 OSM 道路边；
4. 游戏 `?m3=1` / `?m4=1` 会带步行图，因此背景跨河也会尝试桥/渡口；默认混合局（M2）不走步行图；
5. 找不到连通路径时仍回退直线，热力会标记为近似。

### 当前限制

- 步行图来自 z14，桥/渡口可能不全；
- 渡口没有班次/等待时间；
- 公交/小汽车仍用步行图近似，没有独立道路容量；
- 跨河路径只影响背景出行；地铁接驳仍按 M3/M4 规则；
- 找不到路径时不会穿水建模，而是回退为直线（需要在 UI 中继续标注）。

## 文件

```text
map/scripts/build-terrain-rules.py     DEM 坡度 + 水色网格
map/game-data/terrain-rules.json      20px 约束网格
src/sim/terrainRules.ts               terrainAt / crossesWater
src/sim/walkRouter.ts                 A* 路径几何 + 桥/渡口
src/sim/simulation.ts                 建站检查 + 跨河背景时间
src/game/game.ts                      enforceTerrain / walkNetwork
tests/terrain.test.ts                 水域/陡坡测试
```

## 验证

- `tests/terrain.test.ts`：水域与 >30° 山体均拒绝；
- `tests/walk.test.ts`：路径包含折线几何；
- 全量测试：**83/83 通过**
- `npm run build`：通过
