# 端州 · 鼎湖 离线瓦片包

游戏内 MapLibre 现在读取本地离线包，不再请求 OpenFreeMap。只要本地静态服务器能打开游戏，就**不需要连接外网**。

![离线运行截图](../preview/game-offline.png)

## 内容

- **矢量瓦片**：z9–14，覆盖 `112.32–112.82°E / 23.00–23.26°N`，共 **451** 张 PBF，**7.23 MiB**
- **字体 glyph**：Noto Sans Regular / Bold / Italic，拉丁、标点、CJK 标点和全角范围，24 个文件，**1.98 MiB**
- 合计约 **9.22 MiB**

文件：

```text
map/offline/
├─ manifest.json              # 范围、zoom、瓦片数、来源、字体清单
├─ public/
│  ├─ tiles.bin               # 451 张 PBF 顺序拼接
│  ├─ tile-index.json         # "z/x/y" -> [offset, length]
│  └─ glyphs/                 # 本地字体 glyph
└─ README.md
```

## 运行原理

1. `scripts/build-offline-tiles.py` 根据游戏范围计算 z9–14 的瓦片坐标，从 OpenFreeMap 下载并打包。
2. `src/render/offlineTiles.ts` 注册 `metro://` 协议：
   - 首次请求时 `fetch('/tile-index.json')` 和 `fetch('/tiles.bin')`；
   - 按 `z/x/y` 在 `tiles.bin` 里切片，返回对应 PBF；
   - 不再访问 `tiles.openfreemap.org`。
3. MapLibre 的 `glyphs` 改为本地 `/glyphs/{fontstack}/{range}.pbf`。
4. CJK 字形使用 MapLibre 的 `localIdeographFontFamily` 在本地渲染，避免下载数百个中文字体区间。
5. `vite.config.ts` 设置：

   ```ts
   publicDir: 'map/offline/public'
   ```

   开发时 Vite 直接提供；构建时把 `tiles.bin`、索引和 glyphs 复制到 `dist/`。

## 生成 / 更新

```powershell
cd F:\MetroPlan\map
python scripts/build-offline-tiles.py
```

脚本会重新读取 OpenFreeMap 的 TileJSON，下载全部瓦片和字体，覆盖现有包。  
OSM 数据会随时间变化；需要更新离线地图时重跑一次即可。

## 验证

用 Puppeteer 拦截所有非 `127.0.0.1:5173` 的请求并 `abort()`：

```text
external requests: []
map loaded: true
zoom: 11.3987
layers: 57
errors: []
```

离线截图见 `preview/game-offline.png`。

## 限制

- 只包含游戏地形图范围；把地图拖出这个 bbox 或缩放到 z9 以下/超过 z14 太多，会没有新瓦片。
- 游戏当前最大缩放 5x，对应 z≈13.7，在包内；如果以后把 5x 改大，需要同时补更高 zoom（OpenFreeMap 最高 z14，再高是 overzoom）。
- 字体 glyph 只预置了常见拉丁/标点范围；中文由系统字体本地渲染。如果目标系统没有 `Noto Sans SC` / `Microsoft YaHei` / `PingFang SC`，中文标签可能退化。
- 仍然需要一个本地静态服务器（Vite dev / preview 或任意静态服务器），不能直接 `file://` 打开 ES module 页面；但不需要外网。
- 瓦片来源：© OpenStreetMap contributors (ODbL)，OpenFreeMap / OpenMapTiles；地形来自游戏 DEM 本地烘焙。
