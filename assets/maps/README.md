# 端州 · 鼎湖 地形底图

为《地铁规划》准备的 16:9 静态地图背景。按“只保留西江、大山位置和两个江心岛”的简化方向制作，平涂、低对比，方便叠加车站、线路和热力层。

## 文件

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `duanzhou-dinghu-simple.png` | 2560 × 1440 | 无文字，2K 底图（低 DPI 屏幕 / 兜底） |
| `duanzhou-dinghu-simple-4k.png` | 3840 × 2160 | **推荐**：无文字，原生 4K 底图；游戏在物理像素 > 2560 时自动使用 |
| `duanzhou-dinghu-simple-1920.png` | 1920 × 1080 | 无文字，1080p 版本 |
| `duanzhou-dinghu-simple-labels.png` | 2560 × 1440 | 仅保留区名、江名、岛名的标注版 |
| `duanzhou-dinghu-simple-labels-4k.png` | 3840 × 2160 | 标注版，原生 4K |
| `duanzhou-dinghu-simple-labels-1920.png` | 1920 × 1080 | 标注版 1080p |
| `duanzhou-dinghu-terrain.png` | 2560 × 1440 | 备选：带山体阴影的精细地形版 |
| `duanzhou-dinghu-terrain-clean.png` | 2560 × 1440 | 备选：精细地形无标注版 |

4K 版不是放大插值，而是按同一套源数据（OSM 岸线 / 岛屿 + DEM 山体）在 3840 × 2160 上重新栅格化：
岸线、岛屿轮廓和山体边线都按 1.5 倍重绘，字号、线宽、虚线也同比放大，
只有抗锯齿过渡保持约 1 像素，所以放大看时边缘依旧锐利。

## 画面内容

- **西江**：由 OSM 水面数据提取主河道，简化岸线，保留大字湾、羚羊峡一带的走向。
- **大山**：从 DEM 平滑后提取北岭—鼎湖山、烂柯山（含西侧余脉）两片主要山体，另保留左缘山体；只用平涂色块，不做等高线或阴影。
- **两个江心岛**：砚洲岛、黄布沙岛；岛面用纸色，外侧留一圈窄水带与岸线分开。
- **标注**：只保留端州区、鼎湖区、西江、砚洲岛、黄布沙岛和一个小肇庆标记；**山名不写字**。
- 无道路、无小水体、无村镇点，避免和游戏线路抢视觉。

## 配色

| 元素 | 色值 |
| --- | --- |
| 纸面 | `#F4F0E6` |
| 江水 | `#B7D2D6` |
| 江岸 | `#8FB0B5` |
| 山体 | `#D3DEC1` |
| 山体边线 | `#ADBD9D` |
| 文字 | `#4D5246` |

## 数据与版权

- 地形高程：AWS Terrain Tiles（Mapzen Terrarium，SRTM 等数据派生）。
- 河道、岛屿、行政边界：© OpenStreetMap contributors，ODbL 1.0。
  - https://www.openstreetmap.org/copyright
- 地图的简化、配色、排版和标注为本项目制作。

如果游戏对外发布，建议在制作人员名单或设置页保留一行：
`Map data © OpenStreetMap contributors (ODbL)`。

## 重新生成

脚本在 `tools/`：

- `fetch_dem.py`：下载并拼接 DEM。
- `build_simple_map.py`：生成上述简化地图（主交付）。
- `build_map.py`：生成带山体阴影的精细版。

环境需要 Python 3.11+、Pillow、NumPy、OpenCV：

```powershell
python tools/fetch_dem.py
python tools/build_simple_map.py                      # 2560 × 1440 一套
$env:MAP_SCALE='1.5'; $env:MAP_SUFFIX='-4k'           # 3840 × 2160 一套
python tools/build_simple_map.py
```

`MAP_SCALE` 是渲染倍率（1 = 2560 × 1440，1.5 = 3840 × 2160，2 = 5120 × 2880），
`MAP_SUFFIX` 是输出文件后缀。世界坐标里的尺寸（线宽、字号、岛屿水带、
河道细化参数）都会随倍率缩放，所以不同倍率的成图构图完全一致，只是细节更细。

源数据保存在 `assets/maps/source/`，可以调整 `build_simple_map.py` 里的配色、标注位置和山体轮廓（`mountain_contours()`）。
