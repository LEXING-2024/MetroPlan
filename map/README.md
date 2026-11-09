# 端州 · 鼎湖 — MapLibre / OSM 可交互底图

> 为《地铁规划》Metro Plan 制作的 16:9 矢量背景地图。  
> 范围、比例尺和投影与游戏世界坐标一一对应；道路、建筑、土地利用、水系和 POI 都能随缩放展开。  
> 本目录最初是独立底图应用；现已作为 **MapLibre 底层 + Pixi 上层** 接入游戏，接入说明见 [`integration/README.md`](integration/README.md)。  
> 独立应用仍在线取瓦片；**游戏内**使用 [`offline/README.md`](offline/README.md) 的本地包，断网可运行。  
> 可直接作为住宅区/组团边界的实际村界、街道界和住宅用地面数据见 [`analysis/README.md`](analysis/README.md)。

![同一范围：游戏内置静态底图与 MapLibre + OSM 矢量底图](preview/comparison.png)

![可交互底图界面](preview/ui.png)

## 交付物

### 1. 可交互地图

`index.html` + `src/`：MapLibre GL JS 5.24，直连 OpenFreeMap 的 OSM 矢量瓦片。

- 16:9 的端州—鼎湖全图，初始视野自动拟合游戏范围 `112.32–112.82°E / 23.00–23.26°N`。
- 全量平移、滚轮/按钮缩放、双击缩放、触屏手势。
- 九个图层开关：地名、POI、建筑、道路、轨道/轮渡、土地利用、水系、行政边界、地形。
- 点击 POI 查看名称、类别和坐标；点击建筑可查看 OSM 建筑轮廓信息。
- 全域 / 端州 / 鼎湖 / 星湖 四个快速视角。
- “只看底图”模式保留地形、土地利用与水系，方便作为游戏线网底板。

### 2. 静态 16:9 底图

`out/` 中提供 1920、2560、3840 三种尺寸，各有“标注版”和“无字版”：

| 文件 | 尺寸 | 说明 |
| --- | --- | --- |
| `duanzhou-dinghu-basemap-1920x1080.png` | 1920 × 1080 | 标注版，适合 1080p |
| `duanzhou-dinghu-basemap-1920x1080-nolabels.png` | 1920 × 1080 | 无字版，无 POI 图标 |
| `duanzhou-dinghu-basemap-2560x1440.png` | 2560 × 1440 | **游戏世界原生尺寸**，标注版 |
| `duanzhou-dinghu-basemap-2560x1440-nolabels.png` | 2560 × 1440 | **游戏世界原生尺寸**，无字版 |
| `duanzhou-dinghu-basemap-3840x2160.png` | 3840 × 2160 | 4K 标注版 |
| `duanzhou-dinghu-basemap-3840x2160-nolabels.png` | 3840 × 2160 | 4K 无字版 |

导出参数、实际 bbox 和缩放级别见 `out/export-meta.json`。  
静态图保留角标版权行；如果游戏自身已有地图版权声明，可以在游戏内以游戏自己的声明为准。

### 3. 预览图

- `preview/ui.png`：1920 × 1080 界面总览
- `preview/detail.png`：街道级建筑与 POI 细节
- `preview/layers.png`：图层面板
- `preview/mobile.png`：手机竖屏布局
- `preview/comparison.png`：与游戏原静态底图的同范围对比

## 打开与运行

本目录本身是独立的 Vite 工程，可单独运行；游戏内的接入说明见 [`integration/README.md`](integration/README.md)，那条路径会使用游戏根目录的依赖。

```powershell
cd F:\MetroPlan\map
npm install
npm run dev
# 打开 http://127.0.0.1:4174/
```

生产构建与预览：

```powershell
npm run build
npm run preview
# 打开 http://127.0.0.1:4175/
```

重新生成六张静态底图（需要先让 `npm run dev` 在 4174 运行）：

```powershell
npm run export
```

如果只想对已经构建好的 4175 预览导出：

```powershell
$env:MAP_URL = 'http://127.0.0.1:4175/'
npm run export
```

> 矢量瓦片来自 OpenFreeMap，运行时需要网络。地形阴影、纸质纹理、精选地名和所有样式都是本地文件，不会因第三方 DEM 服务中断而消失。

## 数据链路

这是 OSM → 矢量瓦片 → MapLibre 的标准链路：

```text
OpenStreetMap planet / minutely diffs
        │
        ▼
OpenFreeMap 构建（OpenMapTiles 3.16 schema）
        │  https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf
        ▼
MapLibre GL JS 5.24
        │  自定义 style（本目录 src/style.js）
        ▼
WebGL canvas   ──  平移 / 缩放 / 点击查询 / 图层开关
```

本目录额外做了三件本地化处理：

```text
游戏 DEM（assets/maps/source/dem_crop.npy）
  → scripts/make-hillshade.py
  → assets/hillshade.png
  → MapLibre image source，严格覆盖同一组游戏 bounds

游戏内 OSM 提取物（osm_places / osm_peaks / osm_islands）
  → scripts/build-local-labels.mjs
  → data/local-labels.geojson
  → 端州区 / 鼎湖区 / 西江 / 砚洲岛 / 黄布沙岛 / 鼎湖山 等精选地名

scripts/make-paper-texture.py
  → assets/paper-grain.png
  → 页面纸纹叠加，并在截图中一并保留
```

把 DEM 预先烘焙成 PNG 的原因：游戏自带的 `dem_crop.npy` 已经严格对齐 112.32–112.82 / 23.00–23.26 的 Web Mercator 范围；本地 image source 既避免浏览器跨域 DEM 请求，也比在线 terrain 服务更贴合原始底图。`scripts/make-hillshade.py` 会把它重采样到 3840 × 2160，并输出带透明度的“纸面山影”，不覆盖 OSM 的土地利用颜色。

## 图层阶梯

所有层来自 OSM/OpenMapTiles，按缩放逐级出现。这样可以保证低缩放时是安静的“游戏底板”，放大后才逐渐变成完整的城市地图。

| 缩放 | 出现的内容 |
| --- | --- |
| z9.6–11.8 | 西江、水库、山体/林地、区界、主要高速与干道、城市与区名 |
| z11.8–13.4 | 镇街、村落、次级道路、铁路、轮渡、山地与岛屿注记 |
| z13.4+ | 医院、公园、景点、博物馆、渡口、铁路站等公共设施图标 |
| z13.6+ | 建筑轮廓（几乎全部 OSM building footprints） |
| z14.0+ | 巷道、服务道路、步道、街道名 |
| z14.2+ | 学校 / 幼儿园图标 |
| z14.9+ | 公共设施名称标签 |
| z15.1+ | 餐饮、咖啡、商店、酒店、祠庙等生活设施图标 |
| z15.5+ | 学校标签、更多村落/社区名 |
| z16.1+ | 生活设施名称标签 |

具体图层：

- **道路**：motorway / trunk / primary / secondary / tertiary / minor / service / track / path；独立的高速暖砂色、其他道路纸白填充与浅描边。
- **轨道与交通**：rail（纸白底 + 深色虚线）、transit（预留地铁/电车 class）、ferry（蓝色虚线）、runway / taxiway。
- **建筑**：`building` 填充 + 轮廓；z14 瓦片过缩放。
- **土地利用**：residential、commercial、retail、industrial、school、hospital、park/playground/pitch、cemetery、farmland 等。
- **自然地理**：water（河/湖/水库）、waterway、landcover（wood/grass/farmland/wetland）、park/protected_area、mountain_peak 与本地精选山名。
- **POI**：civic（医院/公园/景点/文化/渡口/车站）、school（学校/幼儿园）、minor（餐饮/咖啡/商店/酒店/祠庙）。每类有独立的圆形字标图标和缩放阈值。
- **标注**：OSM place（city/town/suburb/quarter/village/hamlet）、water_name、waterway、transportation_name，以及 13 个本地地标标签。

## 为什么它和游戏契合

1. **同一张世界坐标**  
   游戏 `src/maps/geo.ts` 的 `TERRAIN_BOUNDS` 是 112.32–112.82°E、23.00–23.26°N；`WORLD_W/H` 是 2560 × 1440。本底图使用同一组 bounds 和 Web Mercator，导出 2560 版时缩放为 z11.806，与游戏原生比例尺一致，可以直接作为同坐标背景使用。

2. **同一套纸本颜色**  
   从游戏 `src/style.css`、`assets/maps/README.md` 和 `tools/build_simple_map.py` 提取并微调：

   | 元素 | 色值 |
   | --- | --- |
   | 纸面 | `#F4F0E6` |
   | 江水 | `#B8D3D7` |
   | 江岸 | `#94B5B9` |
   | 林地/山体 | `#CFDBC0` |
   | 道路 | `#FBF4E4` / `#EBCDB4` |
   | 建筑 | `#E7DECD` |
   | 墨色 | `#34382F` |
   | 强调 | `#B4623F` |

   水面、山体和道路都压低饱和度和对比度，把最高饱和度留给游戏自己的线路颜色（朱红、靛蓝、松绿、琥珀等）。

3. **同一套信息层级**  
   游戏底图只需要“西江、山、岛、区名”这一层骨架；本底图在低缩放时也只显示这一层，公路/铁路只是很淡的线。放大后才出现建筑、POI 与街名——玩家在规划线路时不会被底图抢走注意力。

4. **和游戏 UI 同一种纸面语言**  
   UI 使用宋体标题、细描边、半透明纸底、暖灰阴影和朱红小标记；图层、快速视角和 POI 卡片都沿用游戏 HUD 的排版逻辑。

5. **没有替换游戏任何数据**  
   本目录没有改 `assets/maps`、`src`、`index.html` 或根 `package.json`。游戏原底图、POI、线路和存档完全不受影响。

## 交互与操作

| 操作 | 方式 |
| --- | --- |
| 平移 | 拖动 |
| 缩放 | 滚轮 / 双击 / 右下 `+` `−` |
| 回到游戏全图 | 顶部“全图”或 `F` |
| 快速前往 | 底部“全域 / 端州 / 鼎湖 / 星湖” |
| 打开图层 | 顶部“图层” |
| 查看设施 | 点击圆形 POI 图标 |
| 查看建筑 | z14+ 点击建筑轮廓 |
| 关闭面板 / 卡片 | `Esc` 或点击地图 |

## 目录结构

```text
map/
├─ index.html
├─ src/
│  ├─ main.js          # 地图初始化、交互、图层面板、POI 卡片
│  ├─ style.js         # 完整 OpenMapTiles 样式（60+ 图层）
│  ├─ poiLayers.js     # 三级 POI 图层与缩放阈值
│  ├─ poi.js           # POI 分类、中文标签、图标表达式
│  ├─ icons.js         # Canvas 烘焙的圆形字标
│  └─ ui.css           # 游戏化 UI / 纸纹 / 响应式
├─ data/
│  └─ local-labels.geojson
├─ assets/
│  ├─ hillshade.png    # 本地 DEM 山影（3840 × 2160）
│  └─ paper-grain.png
├─ scripts/
│  ├─ build-local-labels.mjs
│  ├─ make-hillshade.py
│  ├─ make-paper-texture.py
│  ├─ export.mjs
│  ├─ make-preview.py
│  └─ ...              # 交互 / 截图 QA
├─ research/           # OSM 瓦片图层探查记录
├─ preview/            # README 用预览图
├─ out/                # 六张最终底图 + export-meta.json
├─ dist/               # Vite 生产构建
└─ package.json
```

`node_modules/` 是本地依赖安装目录，不列入版本控制；运行 `npm install` 即可恢复。

## 数据与版权

- 矢量数据：© OpenStreetMap contributors，ODbL 1.0  
  https://www.openstreetmap.org/copyright
- 矢量瓦片与 schema：OpenFreeMap / OpenMapTiles 3.16  
  https://openfreemap.org / https://openmaptiles.org
- 地形：AWS Terrain Tiles（Mapzen Terrarium，SRTM 等派生）；使用游戏已下载的 DEM crop 在本地生成山影  
  https://registry.opendata.aws/terrain-tiles/
- 地图的样式、配色、标注筛选、UI 与导出图由本项目制作。

如果把这些静态图放进对外发布的游戏，建议在设置页或制作人员名单中保留：

```text
Map data © OpenStreetMap contributors (ODbL)
Tiles: OpenFreeMap / OpenMapTiles
Terrain: AWS Terrain Tiles / Mapzen Terrarium
```

## 制作过程与验收

1. **读游戏文件，确定硬约束**  
   从 `src/maps/geo.ts` 确认地形图 bounds 和 World Mercator 投影，从 `src/sim/constants.ts` 确认 2560 × 1440、50 px/km，从 `tools/build_simple_map.py` 和 `src/style.css` 提取纸面/江水/山体/墨色，从 `assets/maps/README.md` 确认游戏已有底图的交付尺寸和“只保留骨架”的设计目标。

2. **勘查 OSM 瓦片**  
   用 `research/inspect-tiles.mjs` 下载并解析 z11 / z12 / z14 瓦片，确认该区域实际有：
   - z14 约 900 个 POI，覆盖医院、学校、餐厅、商店、公交站等；
   - `building` 层在 z14 以 MultiPolygon 合并方式提供完整建筑轮廓；
   - `transportation` 包含 motorway 到 path、rail、ferry；
   - `landuse` / `landcover` / `park` / `water` / `waterway` / `place` / `boundary` 均可用；
   - OpenFreeMap 的 maxzoom 为 14，因此 z>14 使用过缩放，这是它作为“背景图”而不是测绘产品的合理边界。

3. **搭建样式**  
   先建立完整 60+ 图层的 OpenMapTiles 样式，再按游戏的低对比目标逐层降饱和、降不透明度；POI 被拆成 civic / school / minor 三层，避免 z14 就把餐厅和便利店全部铺满。

4. **本地化地形**  
   起初尝试 MapLibre `raster-dem` + 在线 Terrarium，但浏览器端 DEM 域名出现连接失败；改为用游戏自带的 `dem_crop.npy` 烘焙透明山影 PNG，既解决跨域/网络问题，也让地形与原游戏底图严格同源同范围。这一步是 `scripts/make-hillshade.py`。

5. **标注优先级调试**  
   发现 z12 左右“鼎湖区”会被“坑口街道”或山名挤掉，于是把 5 个精选地标层移到样式末尾，并给它们独立的 `symbol-sort-key`；再通过 `research`/QA 脚本确认端州区、鼎湖区、高要区、西江、砚洲岛、黄布沙岛在不同缩放都能稳定出现。

6. **交互与响应式**  
   加入九组图层开关、四个快速视角、POI 卡片、建筑点击、移动端底部图层面板；用 1920 桌面和 390 手机尺寸分别截图检查。

7. **导出与验收**  
   用 Puppeteer 在 CSS viewport 2560 × 1440 下以 `deviceScaleFactor` 0.75 / 1 / 1.5 截图，得到 1920 / 2560 / 3840 三套图；所有变体 `errors: []`，PNG 头尺寸和 `export-meta.json` 一致。  
   4K 标注版中，字号、线宽和地标文字都按 1.5 倍像素密度渲染，不是把 2K 图简单放大。

### 已知边界

- **在线瓦片**：应用本身需要联网获取 OpenFreeMap 矢量瓦片；静态 `out/` 图不需要网络。  
- **OSM 完整性**：建筑、POI、公交站等覆盖程度取决于当地 OSM 贡献；底图不虚构缺失设施。  
- **没有地铁/电车线**：端州—鼎湖当前 OSM 里没有运营中的 metro/tram 要素；样式已支持 `transit` class，但地图上不会凭空出现一条地铁。游戏玩家规划的线路仍然应该叠加在底图之上。  
- **独立应用与游戏接入是两条路径**：本 `map/` 仍可单独运行；游戏内采用 MapLibre 底层 + Pixi 上层的混合接入，改动清单、相机换算和回滚方式见 [`integration/README.md`](integration/README.md)。  
- **静态图上的版权行**：`out/` 图右下角保留了极小的 OSM / OpenFreeMap / Terrain 版权行；如果游戏界面已有统一版权声明，可以按发布规范调整位置，但不建议删除。
