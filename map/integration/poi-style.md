# POI / 就业区标记样式

状态：已替换原有图标式 POI 标记，配色与大小对齐 `map/analysis/game-pois-extended.png`。

![圆形 POI 与方形就业区](../preview/poi-circles.png)

## 为什么单独写模块

旧逻辑把 POI 图标、白色底圈、等级光环和标签偏移都写在 `scene.ts` / `editor.ts` 里，导致：

- 游戏和编辑模式各画一套，容易不一致；
- 颜色来自 UI 的 `POI_META.css`，和 `game-pois-extended.png` 的分析配色不同；
- 图标 glyph 代码 (旧 `poiGlyph.ts`) 被删除后，没有统一的标记入口。

现在统一到：

```text
src/render/poiMarkers.ts
```

只负责“类型颜色 + 等级尺寸 + 圆/方形状”，`scene.ts` 和 `editor.ts` 都调用它。

## 颜色

严格使用 `map/scripts/render-game-pois-extended.py` 的 9 类 RGB：

| 类型 | RGB | Hex |
|---|---|---|
| scenic | 180,72,48 | `#B44830` |
| hospital | 185,95,110 | `#B95F6E` |
| station | 80,105,140 | `#50698C` |
| ferry | 70,125,135 | `#467D87` |
| school | 188,145,60 | `#BC913C` |
| mall | 150,100,155 | `#96649B` |
| park | 90,125,78 | `#5A7D4E` |
| stadium | 130,100,160 | `#8264A0` |
| industry | 110,95,72 | `#6E5F48` |

## 大小

原分析图规则：

- 城市级 S/A/B：圆半径约 9px；
- 本地级 C：圆半径约 3px；
- 就业区方形：城市级 8px，本地级 4px。

游戏内使用连续的 1–6 级：

```text
radius = 3.2 + (level - 1) × 1.35
```

- 1 级：3.2px
- 3 级：5.9px
- 6 级：9.95px

透明度：

- 1–2 级（本地级）：0.58
- 3–6 级（城市级）：0.92

## 形状

- 普通 POI：实心圆；
- `poi.type === 'industry'`：实心正方形；
- `zone.kind === 'employment'`：
  - 外层影响范围：方形；
  - 中心核：方形；
  - 选中/悬停轮廓：方形；
- 住宅 / 混合组团：圆形。

## 点击 / 悬停

- 旧逻辑点击 POI 会画 `radiusKm × pxPerKm` 的影响半径，2–8 km 的 POI 会显示成很大的圆；
- 现在点击/悬停只画 `poiMarkerBounds(level) + 5` 的小环，跟随标记大小；
- 编辑模式选中 POI 也从影响半径改为小环；
- 影响半径仍保留在数据里，只不再用于选中态绘制；
- 命中测试也不再使用影响半径：只命中 `poiMarkerBounds(level) + 4px` 的标记范围。

## 文件

```text
src/render/poiMarkers.ts    类型颜色 / 等级半径 / 圆形或方形绘制
src/render/scene.ts        游戏内调用 drawPoiMarker()
src/editor/editor.ts       编辑模式调用同一模块
map/scripts/render-game-pois-extended.py   分析图原始配色/大小来源
map/preview/poi-circles.png
```

旧的 `src/render/poiGlyph.ts` 已删除；`scene.ts` / `editor.ts` 不再包含 POI 图标 glyph 逻辑。

## 验证

- `npx tsc --noEmit`：通过
- `npm run build`：通过
- 默认 e2e：通过
- 全量测试：**80/80 通过**
- 692 个 POI 全开图层：约 **90 FPS**（1920×1080）
