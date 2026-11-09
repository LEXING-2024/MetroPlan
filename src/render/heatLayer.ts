/**
 * 热力图渲染层（REQ-HEAT-003）：
 * 把 sim/heat.ts 算出的网格上传成一张低分辨率纹理，由 GPU 用自定义 shader
 * 做双线性采样 + 调色板映射 + 呼吸 / 闪烁动画，避免方块马赛克。
 */
import { BufferImageSource, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';
import { WORLD_H, WORLD_W } from '../sim/constants';
import { HEAT_GH, HEAT_GW } from '../sim/heat';

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec3 pos = mvp * vec3(aPosition, 1.0);
  vUV = aUV;
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uHeat;
uniform sampler2D uMask;
uniform float uTime;
uniform float uIntensity;
uniform float uUseMask;
out vec4 fragColor;

vec3 ramp(float t) {
  vec3 c0 = vec3(0.06, 0.20, 0.13); // 暗绿：轻微压力
  vec3 c1 = vec3(0.18, 0.45, 0.25); // 绿
  vec3 c2 = vec3(0.58, 0.70, 0.29); // 黄绿
  vec3 c3 = vec3(0.95, 0.74, 0.20); // 黄
  vec3 c4 = vec3(0.90, 0.34, 0.15); // 橙红
  vec3 c5 = vec3(0.62, 0.07, 0.05); // 深红
  if (t < 0.2) return mix(c0, c1, smoothstep(0.0, 0.2, t));
  if (t < 0.45) return mix(c1, c2, smoothstep(0.2, 0.45, t));
  if (t < 0.64) return mix(c2, c3, smoothstep(0.45, 0.64, t));
  if (t < 0.82) return mix(c3, c4, smoothstep(0.64, 0.82, t));
  return mix(c4, c5, smoothstep(0.82, 1.0, t));
}

void main() {
  vec4 s = texture(uHeat, vUV);
  float h = clamp(s.r * uIntensity, 0.0, 1.0);
  h = smoothstep(0.02, 1.0, h);
  float q = clamp(s.g, 0.0, 1.0);

  // 呼吸 + 缓慢流动：时间轴推进时热力不会硬切。
  float breathe = 0.90 + 0.10 * sin(uTime * 1.15 + vUV.x * 8.5 + vUV.y * 5.0);
  float alpha = smoothstep(0.012, 0.3, h) * (0.42 + 0.58 * h) * breathe;
  alpha *= mix(1.0, texture(uMask, vUV).a, uUseMask);
  if (alpha <= 0.004) discard;

  vec3 col = ramp(h);

  // 站点排队核心：更深、更红。
  float core = smoothstep(0.12, 0.85, q) * smoothstep(0.18, 0.72, h);
  col = mix(col, vec3(0.56, 0.05, 0.05), core * 0.78);
  alpha = min(0.94, alpha + core * 0.3);

  // 极致拥堵：闪烁的深红。
  float extreme = smoothstep(0.88, 1.0, h) * (0.55 + 0.45 * q);
  float flash = 0.5 + 0.5 * sin(uTime * 5.2);
  col = mix(col, vec3(0.93, 0.13, 0.08), extreme * 0.5 * flash);
  alpha = min(1.0, alpha * (1.0 + extreme * 0.4 * flash));

  fragColor = vec4(col * alpha, alpha);
}
`;

interface HeatUniforms {
  uniforms: { uTime: number; uIntensity: number; uUseMask: number };
  update(): void;
}

export class HeatLayer {
  readonly view: Mesh<MeshGeometry, Shader>;
  private shader: Shader;
  private source: BufferImageSource;
  private data: Uint8Array;
  private intensity = 1;
  private targetIntensity = 1;
  private time = 0;
  private useMask = 0;

  constructor(maskTexture?: Texture | null) {
    const gw = HEAT_GW;
    const gh = HEAT_GH;
    const worldW = WORLD_W;
    const worldH = WORLD_H;
    this.data = new Uint8Array(gw * gh * 4);
    this.source = new BufferImageSource({
      resource: this.data,
      width: gw,
      height: gh,
      format: 'rgba8unorm',
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
    });
    const white = document.createElement('canvas');
    white.width = 1;
    white.height = 1;
    const wctx = white.getContext('2d');
    if (wctx) {
      wctx.fillStyle = '#ffffff';
      wctx.fillRect(0, 0, 1, 1);
    }
    const mask = maskTexture ?? Texture.from(white);
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, worldW, 0, worldW, worldH, 0, worldH]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        uHeat: this.source,
        uHeatSampler: this.source.style,
        uMask: mask.source,
        uMaskSampler: mask.source.style,
        heatUniforms: {
          uTime: { value: 0, type: 'f32' },
          uIntensity: { value: 1, type: 'f32' },
          uUseMask: { value: 0, type: 'f32' },
        },
      },
    });
    this.view = new Mesh({ geometry, shader: this.shader });
    this.view.zIndex = 1.2;
  }

  /** 上传新的网格数据（0..1）。 */
  setData(values: Float32Array, queue: Float32Array): void {
    const d = this.data;
    const n = Math.min(values.length, d.length / 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = values[i]!;
      d[j] = (v * 255) | 0;
      const q = queue[i] ?? 0;
      d[j + 1] = (q * 255) | 0;
      d[j + 2] = 0;
      d[j + 3] = 255;
    }
    this.source.update();
  }

  setIntensity(value: number): void {
    this.targetIntensity = value;
  }

  /** 地形图：热力不铺到西江 / 鼎湖山的水面上。 */
  setMask(enabled: boolean): void {
    this.useMask = enabled ? 1 : 0;
  }

  /** 每帧推进动画时间，并把整体亮度平滑过渡到目标值（潮汐不硬切）。 */
  tick(dt: number): void {
    this.time += dt;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 2.4);
    const u = this.shader.resources.heatUniforms as unknown as HeatUniforms;
    if (!u) return;
    u.uniforms.uTime = this.time;
    u.uniforms.uIntensity = this.intensity;
    u.uniforms.uUseMask = this.useMask;
    u.update();
  }

  destroy(): void {
    this.view.destroy({ children: true, texture: true, textureSource: true });
  }
}
