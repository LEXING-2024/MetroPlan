# MapLibre 底层 + Pixi 上层：游戏内接入

已把独立底图接进游戏：**MapLibre 画矢量底图，Pixi 继续画线路、站点、列车、热力、OD 和交互**。

![游戏内矢量底图](../preview/game-vector.png)

![放大后由 MapLibre 跟随游戏相机](../preview/game-vector-zoom.png)

![Pixi 线路与站点叠在矢量底图上](../preview/game-vector-stations.png)

> 内置地形图地点数据已全面替换为 `map/analysis` 数据包；生成与字段见 [game-data/README.md](../game-data/README.md)。
>
> 热力图已改为对数低值增强并加入左下角图例；山区/水域建站与跨河桥/渡口见 [heat-background.md](heat-background.md) 和 [terrain-constraints.md](terrain-constraints.md)。
>
> 住宅已改为真实 OSM 轮廓 + 密度着色，无轮廓村落按面积生成；见 [residential-areas.md](residential-areas.md)。
>
> POI 标记已改为按类型着色的实心圆，就业区/工业为方形；见 [poi-style.md](poi-style.md)。
>
> 默认运行 M2 活动链 + M3 步行路网 + M4 路网选站 + 混合客流；纯通勤通过 `?commuter=1`，M1 合成人口通过 `?m1=1` 开启，`?m3=0&m4=0` 关闭步行图。见 [activity-model.md](activity-model.md)、[activity-m2.md](activity-m2.md)、[activity-m3.md](activity-m3.md)、[activity-m4.md](activity-m4.md)。

## 已实现

- 游戏启动时创建 MapLibre 地图，放在 Pixi `#stage` 下方。
- Pixi 画布改为透明（`backgroundAlpha: 0`，WebGL 上下文 `premultipliedAlpha: false`），隐藏原静态 `mapSprite`。
- 游戏相机是唯一真源：`scale / offsetX / offsetY` 每次变化时换算成 MapLibre 的 `center / zoom`。
- 菜单、编辑器打开时隐藏矢量底图；进入游戏后显示。
- “底图”图层开关关闭时，矢量底图也一起隐藏。
- 地形图使用矢量底图；纯色图和自定义图回退原背景。
- 旧住宅、就业、POI 显示层在矢量地形图里默认关闭，数据和图层面板开关保留；纯色图/自定义图仍会显示这些旧层。
- 地图版权补充 OpenFreeMap / OpenMapTiles。
- **离线运行**：游戏内使用 `map/offline` 的 451 张 z9–14 瓦片 + 本地 glyph（约 9.2 MiB），不再请求 OpenFreeMap；断网也能显示地图。

## 修改的文件

| 文件 | 改动 |
| --- | --- |
| `src/render/vectorBasemap.ts` | 新增：MapLibre 实例、世界坐标 → `center/zoom`、可见性 |
| `src/render/offlineTiles.ts` | 新增：`metro://` 离线瓦片协议、本地 glyph |
| `map/offline/` | 新增：451 张 z9–14 瓦片、字体和索引（约 9.2 MiB） |
| `vite.config.ts` | `publicDir` 指向离线包，构建时复制到 `dist` |
| `src/main.ts` | 创建 `#basemap`，初始化 Pixi 透明画布，挂接 VectorBasemap |
| `src/render/scene.ts` | 静态底图/矢量底图切换、相机同步、菜单可见性 |
| `src/game/game.ts` | 地图样式切换、菜单/编辑器隐藏底图 |
| `src/ui/gameUi.ts` | 旧图层默认关闭、图例/筛选联动、版权文案 |
| `src/style.css` | `#basemap` 层叠、`#stage` 透明 |
| `package.json` / `package-lock.json` | 增加 `maplibre-gl` |
| `tsconfig.json` | `allowJs`，复用 `map/src/style.js` |

原文件备份在 `map/integration/backup/`：回滚时把备份按相对路径覆盖回游戏根目录，删除新增的 `src/render/vectorBasemap.ts`，再执行一次 `npm install`（备份的 `package.json` 不含 `maplibre-gl`）。

## 关键换算

`src/render/scene.ts` 的世界坐标仍为 2560 × 1440，投影范围与 `TERRAIN_BOUNDS` 一致。  
`VectorBasemap.setView()` 做两件事：

```text
屏幕中心 → 世界坐标 → 经纬度 → map.center
game scale → MapLibre zoom
```

缩放公式：

```text
zoom = log2(scale × 2560 × 360 / (512 × 0.5))
```

所以 1920 宽度、`scale = 0.75` 时是 z11.3987；2560 宽度、`scale = 1` 时是 z11.806，和静态底图导出完全一致。

## 现在还不是“MapLibre 自己交互”

MapLibre 配了 `interactive: false`，指针事件全部交给游戏 canvas：

- 拖动、右键/中键平移、`Ctrl + 滚轮` 缩放仍由 `Game` 处理；
- `scene.panBy()` / `zoomAt()` 改变相机后，MapLibre 跟随；
- MapLibre 自己的 POI 点击、地图控件不会抢占游戏输入；
- OSM POI 图标没有加入游戏底图，避免和游戏玩法 POI 混淆。

这是刻意的选择：保留现有 Pixi 线网/站点/热力/OD，不让游戏逻辑迁到 MapLibre。

## 运行

```powershell
cd F:\MetroPlan
npm run dev
# http://127.0.0.1:5173/
```

构建与测试：

```powershell
npm run build   # tsc + vite build
npm test        # 67 项通过
npm run e2e     # smoke 通过
```

## 当前限制

- 游戏相机上限仍为 5x，对应 MapLibre z≈14.1；要看更细的街道/建筑，需要把 `Scene.zoomAt()` 的 5 改大（同时测试线宽、站点图标和性能）。
- 离线包只覆盖游戏地形图范围 z9–14；移出 bbox / 缩放到包外会缺瓦片。瓦片是静态 OSM 快照，更新时重跑 `map/scripts/build-offline-tiles.py`。
- 仍需本地静态服务器（Vite / preview / 任意 HTTP 服务），不能直接 `file://` 打开；但不需要外网。
- 纯色图/自定义图仍使用旧 Pixi 背景和数据。
- OSM POI 未接入游戏；如果后续要“地图设施”点击，需要把游戏点击转发到 `map.queryRenderedFeatures()`，或单独做一个查看模式。
- 旧住宅/就业/POI 数据没有删除，只是在矢量地形图里默认关闭；后续重新选取地点时再决定是否替换数据模型。
- 目前是相机跟随，不是 MapLibre 原生拖动/缩放；若以后要全 MapLibre 交互，需要把线路/站点/热力/OD 迁到 GeoJSON/自定义图层，属于另一阶段。

## 验收记录

- `npx tsc --noEmit`：通过
- `npm run build`：通过
- `npm test`：67/67 通过
- `npm run e2e`：通过（菜单、放站、建线、早高峰、结算、存档）
- 1920 × 1080 浏览器实测：
  - MapLibre z11.3987，游戏 scale 0.75，中心 112.57 / 23.13
  - 放大到游戏 2.476x 时 MapLibre z12.7067，中心不变
  - 线路/站点与底图对齐
  - 底图关闭、纯色图回退、菜单隐藏均正常
- 断网测试：拦截并阻止所有非 `127.0.0.1` 请求，地图仍加载，外部请求为 `[]`，z11.3987，57 个图层，`errors: []`
