/**
 * A WebGL2 glyph renderer after gcdAtlas: a scene shader renders HDR colour
 * at twice the character grid, a cell pass picks one glyph per cell from a
 * ramp ordered by measured ink (with - / | \ on real silhouette edges), a
 * blur at cell resolution makes the phosphor glow, and a final pass draws
 * the glyph masks at full resolution. Scenes are one fragment shader on top
 * of SCENE_COMMON plus a controller that sets its uniforms every frame.
 * Swarms and streams add point sprites (simulated in JS, drawn on the GPU)
 * into the same HDR scene before the glyphs are chosen.
 */

export type V3 = [number, number, number];

/** A camera as eye and target; screen right = forward x up, as lookAt in SCENE_COMMON. */
export interface Cam {
  eye: V3;
  target: V3;
}

/** Points: 8 floats each, x y z radius (world units) then r g b intensity. */
export const POINT_STRIDE = 8;

export type Setter = {
  f(name: string, v: number): void;
  v2(name: string, x: number, y: number): void;
  v3(name: string, x: number, y: number, z: number): void;
  v4(name: string, x: number, y: number, z: number, w: number): void;
  /** vec4 array uniform */
  v4v(name: string, data: Float32Array): void;
  tex(name: string, unit: number, tex: WebGLTexture): void;
  /** point sprites added to the scene this frame, seen through `cam` */
  points(data: Float32Array, count: number, cam: Cam): void;
};

function basis(cam: Cam) {
  const f = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!) || 1;
  const F: V3 = [f[0]! / fl, f[1]! / fl, f[2]! / fl];
  const rl = Math.hypot(F[2], F[0]) || 1;
  const R: V3 = [-F[2] / rl, 0, F[0] / rl];
  const U: V3 = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  return { R, U, F };
}

/** Where a world point lands in CSS px (top-left origin), or null when behind the camera. */
export function projectPoint(p: V3, cam: Cam, f: FrameInfo): { x: number; y: number; z: number } | null {
  const { R, U, F } = basis(cam);
  const v = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  const z = v[0]! * F[0] + v[1]! * F[1] + v[2]! * F[2];
  if (z <= 0.05) return null;
  const x = (v[0]! * R[0] + v[1]! * R[1] + v[2]! * R[2]) / (z * f.tan[0]) + f.shift;
  const y = (v[0]! * U[0] + v[1]! * U[1] + v[2]! * U[2]) / (z * f.tan[1]);
  return { x: ((x + 1) / 2) * f.width, y: ((1 - y) / 2) * f.height, z };
}

export interface FrameInfo {
  /** seconds since start (scene time) */
  t: number;
  dt: number;
  /** canvas width / height (CSS px) */
  aspect: number;
  /** tan of the half field of view, x and y */
  tan: [number, number];
  /** horizontal lens shift in NDC: the scene's centre sits at x = shift */
  shift: number;
  narrow: boolean;
  /** pointer in NDC (-1..1, y up) and whether it is over the canvas */
  pointer: { x: number; y: number; on: boolean };
  width: number;
  height: number;
}

export interface GlyphController {
  /** GLSL appended to SCENE_COMMON; must assign `o` (HDR colour times uOut, alpha 1) */
  frag: string;
  /** vertical field of view in degrees for the scene's camera (default 46) */
  fovY?: number;
  /** where the scene's centre sits on wide layouts, in NDC x (default 0) */
  shift?: number;
  /**
   * Also compile a light variant of `frag` with LITE defined, and show it until the full shader is
   * ready: for scenes whose full shader takes seconds to compile on some drivers (Direct3D above all).
   */
  lite?: boolean;
  init?(gl: WebGL2RenderingContext): void;
  frame(f: FrameInfo, set: Setter): void;
  /** HTML labels pinned to the scene this frame, in CSS px from the top-left */
  labels?(f: FrameInfo): { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[];
  dispose?(gl: WebGL2RenderingContext): void;
}

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p*2. - 1., 0., 1.); }`;

/** Prepended to every scene shader. */
export const SCENE_COMMON = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uRes;
uniform vec2 uTan;
uniform float uShift;
uniform float uTime;
uniform float uOut;
uniform vec3 uMouse;
out vec4 o;
const float PI = 3.14159265;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y)*p3.z); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
float fbm3(vec3 p){ float s = 0., a = .5; for(int i = 0; i < 3; i++){ s += a*noise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec2 ndc(){ return gl_FragCoord.xy/uRes*2. - 1.; }
mat3 lookAt(vec3 eye, vec3 target){ vec3 f = normalize(target - eye); vec3 r = normalize(cross(f, vec3(0., 1., 0.))); vec3 u = cross(r, f); return mat3(r, u, f); }
vec3 camRay(mat3 cam){ vec2 q = ndc(); q.x -= uShift; return normalize(cam*vec3(q*uTan, 1.)); }
vec2 sphIsect(vec3 ro, vec3 rd, vec3 c, float r){ vec3 oc = ro - c; float b = dot(oc, rd); float h = b*b - dot(oc, oc) + r*r; if(h < 0.) return vec2(-1.); h = sqrt(h); return vec2(-b - h, -b + h); }
/** squared distance between a ray and a segment, and where along the segment */
float segDist2(vec3 ro, vec3 rd, vec3 a, vec3 b, out float s){
  vec3 ba = b - a, oa = ro - a; float bb = dot(ba, ba) + 1e-6;
  float rb = dot(rd, ba), ro2 = dot(oa, rd), ob = dot(oa, ba);
  float den = bb - rb*rb + 1e-6;
  s = clamp((ob - ro2*rb)/den, 0., 1.);
  float t = max(dot(a + ba*s - ro, rd), 0.);
  vec3 d = ro + rd*t - (a + ba*s);
  return dot(d, d);
}
/** glow of a point source seen along the ray (a soft blob) */
float pointGlow(vec3 ro, vec3 rd, vec3 c, float r){ vec3 oc = c - ro; float t = max(dot(oc, rd), 0.); vec3 pc = oc - rd*t; return exp(-dot(pc, pc)/(r*r)); }
/** a quiet starfield in screen space, twinkling */
vec3 starfield(float density){
  vec2 cell = floor(gl_FragCoord.xy);
  float h = hash12(cell);
  if(h < 1. - density) return vec3(0.);
  float tw = .55 + .45*sin(uTime*(.6 + h*1.7) + h*40.);
  float k = hash12(cell + 7.1);
  vec3 tint = mix(vec3(.75, .82, 1.), vec3(1., .86, .7), k);
  return tint*tw*(.5 + 2.2*pow(fract(h*97.), 6.));
}
void outCol(vec3 c){ o = vec4(max(c, 0.)*uOut, 1.); }
`;

const VS_POINTS = `#version 300 es
layout(location = 0) in vec4 aP;
layout(location = 1) in vec4 aC;
uniform vec3 uEye; uniform vec3 uR; uniform vec3 uU; uniform vec3 uF;
uniform vec2 uTan; uniform float uShift; uniform vec2 uRes; uniform float uOut;
out vec3 vC;
void main(){
  vec3 v = aP.xyz - uEye;
  float z = dot(v, uF);
  if(z <= .05){ gl_Position = vec4(0., 0., 2., 1.); gl_PointSize = 0.; vC = vec3(0.); return; }
  gl_Position = vec4(dot(v, uR)/(z*uTan.x) + uShift, dot(v, uU)/(z*uTan.y), 0., 1.);
  float px = aP.w/(z*uTan.x)*uRes.x;
  gl_PointSize = clamp(px, 1.5, 28.);
  // a sprite smaller than its minimum size keeps its total light
  float k = px < 1.5 ? (px*px)/2.25 : 1.;
  vC = aC.rgb*aC.a*k*uOut;
}`;

const FS_POINTS = `#version 300 es
precision highp float;
in vec3 vC;
out vec4 o;
void main(){
  // scene pixels are 1.8 times taller than wide: squash the sprite back to round
  vec2 q = gl_PointCoord*2. - 1.;
  float r2 = q.x*q.x + q.y*q.y*3.24;
  if(r2 > 1.) discard;
  o = vec4(vC*exp(-r2*3.), 0.);
}`;

const FS_CELL = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uGrid; uniform float uExp; uniform float uIn; uniform float uLv; uniform float uDir0; uniform float uEdge;
out vec4 o;
vec3 tmAt(vec2 c){ vec3 x = texture(uScene, (c + .5)/uGrid).rgb*uIn; return 1. - exp(-x*uExp); }
float lum(vec3 t){ return max(dot(t, vec3(.2126, .7152, .0722)), max(t.r, max(t.g, t.b))*.62); }
void main(){
  vec2 c = floor(gl_FragCoord.xy);
  vec3 t = tmAt(c); float v = lum(t);
  float g = 0.; const float th = 0.03;
  if(v > th) g = 1. + min(floor(pow((v - th)/(1. - th), 1.2)*uLv), uLv - 1.);
  if(uEdge > 0.5 && v > 0.09 && v < 0.9){
    float l00 = lum(tmAt(c + vec2(-1,-1))), l10 = lum(tmAt(c + vec2(0,-1))), l20 = lum(tmAt(c + vec2(1,-1)));
    float l01 = lum(tmAt(c + vec2(-1,0))), l21 = lum(tmAt(c + vec2(1,0)));
    float l02 = lum(tmAt(c + vec2(-1,1))), l12 = lum(tmAt(c + vec2(0,1))), l22 = lum(tmAt(c + vec2(1,1)));
    float gx = (l20 + 2.*l21 + l22) - (l00 + 2.*l01 + l02);
    float gy = (l02 + 2.*l12 + l22) - (l00 + 2.*l10 + l20);
    float G = length(vec2(gx, gy));
    float nb = (l00 + l10 + l20 + l01 + l21 + l02 + l12 + l22)*0.125;
    float bright = step(0.12, l00) + step(0.12, l10) + step(0.12, l20) + step(0.12, l01) + step(0.12, l21) + step(0.12, l02) + step(0.12, l12) + step(0.12, l22);
    float dark = step(l00, v*0.45) + step(l10, v*0.45) + step(l20, v*0.45) + step(l01, v*0.45) + step(l21, v*0.45) + step(l02, v*0.45) + step(l12, v*0.45) + step(l22, v*0.45);
    if(G > 1.5 && v < nb*1.7 + 0.04 && bright >= 4. && dark >= 3.){
      float ang = mod(atan(gy, gx) + 1.5707963, 3.14159265);
      g = uDir0 + mod(floor(ang/0.7853982 + 0.5), 4.);
    }
  }
  float mx = max(t.r, max(t.g, t.b));
  vec3 col = t/max(mx, 1e-4)*(0.34 + 0.66*sqrt(mx));
  col = mix(col, vec3(1.), smoothstep(0.8, 1., v)*0.35);
  o = vec4(col, g/255.);
}`;

const FS_GLOW = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uStep; uniform vec2 uGrid; uniform float uFirst; uniform float uExp; uniform float uIn;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy/uGrid; vec3 s = vec3(0.);
  float w[5] = float[](0.227, 0.1945, 0.1216, 0.054, 0.0162);
  for(int i = -4; i <= 4; i++){ vec3 x = texture(uSrc, uv + uStep*float(i)).rgb; if(uFirst > 0.5) x = 1. - exp(-x*uIn*uExp); s += x*w[i < 0 ? -i : i]; }
  o = vec4(s, 1.);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uCellT; uniform sampler2D uAtlas; uniform sampler2D uGlowT;
uniform vec2 uCell; uniform vec2 uGrid; uniform float uAtlasN; uniform float uGlowAmt; uniform vec3 uBg; uniform vec2 uOff;
out vec4 o;
void main(){
  vec2 cf = (gl_FragCoord.xy - uOff)/uCell; vec2 ci = floor(cf); vec2 lc = cf - ci;
  if(ci.x < 0. || ci.y < 0. || ci.x >= uGrid.x || ci.y >= uGrid.y){ o = vec4(uBg, 1.); return; }
  vec4 cd = texelFetch(uCellT, ivec2(ci), 0);
  float gi = floor(cd.a*255. + .5);
  float m = texture(uAtlas, vec2((gi + lc.x)/uAtlasN, 1. - lc.y)).a;
  vec3 glow = texture(uGlowT, cf/uGrid).rgb*uGlowAmt;
  o = vec4(uBg + glow*(1. - 0.6*m) + cd.rgb*m, 1.);
}`;

const RAMP_CANDIDATES = ".':;+*o%#&8@$W";
const DIR_CHARS = ["-", "/", "|", "\\"];

interface Program {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
  shaders: WebGLShader[];
  state: "compiling" | "ready" | "failed";
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

/**
 * Compiles and links a program without asking whether it worked: asking blocks until the driver is
 * done, which for a big scene shader can take seconds. `settle` asks later, once the driver says the
 * work is finished (KHR_parallel_shader_compile).
 */
function program(gl: WebGL2RenderingContext, fs: string, vs = VS): Program {
  const p = gl.createProgram()!;
  const v = shader(gl, gl.VERTEX_SHADER, vs);
  const f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return { p, u: new Map(), shaders: [v, f], state: "compiling" };
}

/** COMPLETION_STATUS_KHR, from KHR_parallel_shader_compile */
const COMPLETION_STATUS = 0x91b1;

/** Whether a program has finished compiling (without blocking, when the driver can tell us), and if so whether it linked. */
function settle(gl: WebGL2RenderingContext, pr: Program, parallel: boolean, mayBlock: boolean): Program["state"] {
  if (pr.state !== "compiling") return pr.state;
  if (gl.isContextLost()) return pr.state;
  if (parallel ? !gl.getProgramParameter(pr.p, COMPLETION_STATUS) : !mayBlock) return pr.state;
  if (gl.getProgramParameter(pr.p, gl.LINK_STATUS)) pr.state = "ready";
  else {
    pr.state = "failed";
    const logs = pr.shaders.map((x) => gl.getShaderInfoLog(x) ?? "").join(" ");
    console.warn(`glyph program: ${gl.getProgramInfoLog(pr.p) ?? ""} ${logs}`.slice(0, 2000));
  }
  for (const x of pr.shaders) {
    gl.detachShader(pr.p, x);
    gl.deleteShader(x);
  }
  pr.shaders = [];
  return pr.state;
}

function loc(gl: WebGL2RenderingContext, pr: Program, name: string) {
  let l = pr.u.get(name);
  if (l === undefined) {
    l = gl.getUniformLocation(pr.p, name);
    pr.u.set(name, l);
  }
  return l;
}

function texture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export interface EngineOptions {
  /** CSS px per cell (width); cells are 1.8 times as tall */
  cell: number;
  /** page background behind the glyphs, 0..1 */
  bg: [number, number, number];
  glow: number;
  exposure: number;
  font: string;
}

export class GlyphEngine {
  private gl: WebGL2RenderingContext;
  private hdr: boolean;
  private out: number;
  /** whether the driver compiles in the background and can say when it is done */
  private parallel: boolean;
  private scene: Program;
  /** the light variant shown while `scene` compiles (scenes with `lite`), else null */
  private sceneLite: Program | null;
  /** the scene program being drawn with: the light one until the full one is ready */
  private active: Program | null = null;
  private cellP: Program;
  private glowP: Program;
  private finalP: Program;
  private pointsP: Program;
  private pointsVao: WebGLVertexArrayObject;
  private pointsBuf: WebGLBuffer;
  private pending: { data: Float32Array; count: number; cam: Cam } | null = null;
  private sceneTex: WebGLTexture;
  private cellTex: WebGLTexture;
  private glowA: WebGLTexture;
  private glowB: WebGLTexture;
  private atlasTex: WebGLTexture;
  private fbScene: WebGLFramebuffer;
  private fbCell: WebGLFramebuffer;
  private fbGlowA: WebGLFramebuffer;
  private fbGlowB: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private atlasN = 1;
  private levels = 1;
  private dir0 = 1;
  private cols = 1;
  private rows = 1;
  private cellW = 1;
  private cellH = 1;
  private offX = 0;
  private offY = 0;
  private width = 1;
  private height = 1;
  private setter: Setter;
  cssW = 1;
  cssH = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctl: GlyphController,
    private opts: EngineOptions,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    this.out = this.hdr ? 1 : 0.125;
    this.parallel = !!gl.getExtension("KHR_parallel_shader_compile");
    // the light variant first, so it is ready first
    this.sceneLite = ctl.lite ? program(gl, SCENE_COMMON.replace("#version 300 es\n", "#version 300 es\n#define LITE 1\n") + ctl.frag) : null;
    this.scene = program(gl, SCENE_COMMON + ctl.frag);
    this.cellP = program(gl, FS_CELL);
    this.glowP = program(gl, FS_GLOW);
    this.finalP = program(gl, FS_FINAL);
    this.pointsP = program(gl, FS_POINTS, VS_POINTS);
    this.pointsVao = gl.createVertexArray()!;
    this.pointsBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.pointsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointsBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, POINT_STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, POINT_STRIDE * 4, 16);
    gl.bindVertexArray(null);
    this.sceneTex = texture(gl, gl.LINEAR);
    this.cellTex = texture(gl, gl.NEAREST);
    this.glowA = texture(gl, gl.LINEAR);
    this.glowB = texture(gl, gl.LINEAR);
    this.atlasTex = texture(gl, gl.NEAREST);
    this.fbScene = gl.createFramebuffer()!;
    this.fbCell = gl.createFramebuffer()!;
    this.fbGlowA = gl.createFramebuffer()!;
    this.fbGlowB = gl.createFramebuffer()!;
    this.vao = gl.createVertexArray()!;
    ctl.init?.(gl);
    // uniforms go to whichever scene program is drawing this frame
    const sc = () => this.active!;
    this.setter = {
      f: (n, v) => gl.uniform1f(loc(gl, sc(), n), v),
      v2: (n, x, y) => gl.uniform2f(loc(gl, sc(), n), x, y),
      v3: (n, x, y, z) => gl.uniform3f(loc(gl, sc(), n), x, y, z),
      v4: (n, x, y, z, w) => gl.uniform4f(loc(gl, sc(), n), x, y, z, w),
      v4v: (n, d) => gl.uniform4fv(loc(gl, sc(), n), d),
      tex: (n, unit, t) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(loc(gl, sc(), n), unit);
      },
      points: (data, count, cam) => {
        this.pending = { data, count, cam };
      },
    };
  }

  /**
   * Checks on the shaders without waiting for them: true once the frame programs and a scene program
   * (the light one, then the full one) are ready to draw. Without KHR_parallel_shader_compile the
   * check has to wait for the driver, so callers pass mayBlock only when the page can afford a stall.
   * Throws when nothing can be drawn (a frame program, or every scene program, failed).
   */
  poll(mayBlock = false): boolean {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    // the small frame programs are cheap enough to wait for
    for (const pr of [this.cellP, this.glowP, this.finalP, this.pointsP]) if (settle(gl, pr, this.parallel, true) === "failed") throw new Error("glyph frame program failed");
    const lite = this.sceneLite ? settle(gl, this.sceneLite, this.parallel, true) : "failed";
    const full = settle(gl, this.scene, this.parallel, mayBlock || !this.sceneLite);
    if (full === "ready" && this.active !== this.scene) {
      this.active = this.scene;
      if (this.sceneLite) {
        gl.deleteProgram(this.sceneLite.p);
        this.sceneLite = null;
      }
    } else if (!this.active && lite === "ready") this.active = this.sceneLite;
    if (full === "failed" && lite === "failed") throw new Error("glyph scene program failed");
    return !!this.active;
  }

  /** whether the full scene shader is drawing (not the light one, nor nothing yet) */
  get complete() {
    return this.active === this.scene;
  }

  get grid() {
    return { cols: this.cols, rows: this.rows };
  }

  setCell(cell: number) {
    this.opts.cell = cell;
    this.resize(this.cssW, this.cssH);
  }

  resize(cssW: number, cssH: number) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.width = Math.max(1, Math.round(this.cssW * dpr));
    this.height = Math.max(1, Math.round(this.cssH * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.cellW = Math.max(3, Math.round(this.opts.cell * dpr));
    this.cellH = Math.round(this.cellW * 1.8);
    this.cols = Math.max(1, Math.floor(this.width / this.cellW));
    this.rows = Math.max(1, Math.floor(this.height / this.cellH));
    this.offX = Math.floor((this.width - this.cols * this.cellW) / 2);
    this.offY = Math.floor((this.height - this.rows * this.cellH) / 2);
    const sw = this.cols * 2;
    const sh = this.rows * 2;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, sh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const t of [this.cellTex, this.glowA, this.glowB]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const attach = (fb: WebGLFramebuffer, t: WebGLTexture) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    };
    attach(this.fbScene, this.sceneTex);
    attach(this.fbCell, this.cellTex);
    attach(this.fbGlowA, this.glowA);
    attach(this.fbGlowB, this.glowB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.buildAtlas();
  }

  /** Glyph atlas with a ramp chosen by measured ink coverage. */
  buildAtlas() {
    const gl = this.gl;
    const cw = this.cellW;
    const ch = this.cellH;
    const fontPx = cw / 0.6;
    const font = `500 ${fontPx}px ${this.opts.font}`;
    const mc = document.createElement("canvas");
    mc.width = cw;
    mc.height = ch;
    const mx = mc.getContext("2d", { willReadFrequently: true })!;
    mx.font = font;
    mx.textAlign = "center";
    mx.textBaseline = "middle";
    mx.fillStyle = "#fff";
    const cov: [string, number][] = [];
    for (const chr of new Set(RAMP_CANDIDATES)) {
      mx.clearRect(0, 0, cw, ch);
      mx.fillText(chr, cw / 2, ch / 2 + fontPx * 0.03);
      const d = mx.getImageData(0, 0, cw, ch).data;
      let s = 0;
      for (let i = 3; i < d.length; i += 4) s += d[i]!;
      cov.push([chr, s / (255 * cw * ch)]);
    }
    cov.sort((a, b) => a[1] - b[1]);
    const N = Math.min(18, cov.length);
    const lo = cov[0]![1];
    const hi = cov[cov.length - 1]![1];
    const used = new Set<string>();
    const ramp: [string, number][] = [];
    for (let i = 0; i < N; i++) {
      const target = lo + (hi - lo) * Math.pow(i / (N - 1), 1.15);
      let best: [string, number] | null = null;
      let bd = 1e9;
      for (const e of cov) {
        if (used.has(e[0])) continue;
        const dd = Math.abs(e[1] - target);
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      if (best) {
        used.add(best[0]);
        ramp.push(best);
      }
    }
    ramp.sort((a, b) => a[1] - b[1]);
    const chars = [" ", ...ramp.map((e) => e[0]), ...DIR_CHARS];
    const ac = document.createElement("canvas");
    ac.width = cw * chars.length;
    ac.height = ch;
    const ax = ac.getContext("2d")!;
    ax.font = font;
    ax.textAlign = "center";
    ax.textBaseline = "middle";
    ax.fillStyle = "#fff";
    chars.forEach((c, i) => ax.fillText(c, i * cw + cw / 2, ch / 2 + fontPx * 0.03));
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ac);
    this.atlasN = chars.length;
    this.levels = ramp.length;
    this.dir0 = ramp.length + 1;
  }

  private takePoints() {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  /** The frame description the controller saw last (for labels). */
  last: FrameInfo | null = null;

  /** Draws a frame; false (and nothing drawn) until a scene program is ready (see poll). */
  render(t: number, dt: number, pointer: { x: number; y: number; on: boolean }): boolean {
    const gl = this.gl;
    if (gl.isContextLost() || !this.active) return false;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    const sw = this.cols * 2;
    const sh = this.rows * 2;
    const aspect = (this.cols * this.cellW) / (this.rows * this.cellH);
    const narrow = this.cssW < 720;
    const tanY = Math.tan(((this.ctl.fovY ?? 46) * Math.PI) / 360) * (aspect < 0.9 ? 1.25 : 1);
    const tanX = tanY * aspect;
    const shift = narrow ? 0 : (this.ctl.shift ?? 0);

    // 1. the scene, HDR, at twice the glyph grid
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbScene);
    gl.viewport(0, 0, sw, sh);
    gl.useProgram(this.active.p);
    const s = this.setter;
    s.v2("uRes", sw, sh);
    s.v2("uTan", tanX, tanY);
    s.f("uShift", shift);
    s.f("uTime", t);
    s.f("uOut", this.out);
    s.v3("uMouse", pointer.x, pointer.y, pointer.on ? 1 : 0);
    this.last = { t, dt, aspect, tan: [tanX, tanY], shift, narrow, pointer, width: this.cssW, height: this.cssH };
    this.pending = null;
    this.ctl.frame(this.last, s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 1b. point sprites, added on top of the scene
    // (set by the controller during frame(), so read it back through a call)
    const pend = this.takePoints();
    if (pend && pend.count > 0) {
      const { data, count, cam } = pend;
      const { R, U, F } = basis(cam);
      const pp = this.pointsP;
      gl.useProgram(pp.p);
      gl.uniform3f(loc(gl, pp, "uEye"), cam.eye[0], cam.eye[1], cam.eye[2]);
      gl.uniform3f(loc(gl, pp, "uR"), R[0], R[1], R[2]);
      gl.uniform3f(loc(gl, pp, "uU"), U[0], U[1], U[2]);
      gl.uniform3f(loc(gl, pp, "uF"), F[0], F[1], F[2]);
      gl.uniform2f(loc(gl, pp, "uTan"), tanX, tanY);
      gl.uniform1f(loc(gl, pp, "uShift"), shift);
      gl.uniform2f(loc(gl, pp, "uRes"), sw, sh);
      gl.uniform1f(loc(gl, pp, "uOut"), this.out);
      gl.bindVertexArray(this.pointsVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointsBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * POINT_STRIDE), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.vao);
    }

    // 2. one glyph per cell
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbCell);
    gl.viewport(0, 0, this.cols, this.rows);
    const c = this.cellP;
    gl.useProgram(c.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(loc(gl, c, "uScene"), 0);
    gl.uniform2f(loc(gl, c, "uGrid"), this.cols, this.rows);
    gl.uniform1f(loc(gl, c, "uExp"), this.opts.exposure);
    gl.uniform1f(loc(gl, c, "uIn"), 1 / this.out);
    gl.uniform1f(loc(gl, c, "uLv"), this.levels);
    gl.uniform1f(loc(gl, c, "uDir0"), this.dir0);
    gl.uniform1f(loc(gl, c, "uEdge"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. glow at cell resolution: horizontal from the scene, then vertical
    const g = this.glowP;
    gl.useProgram(g.p);
    gl.uniform2f(loc(gl, g, "uGrid"), this.cols, this.rows);
    gl.uniform1f(loc(gl, g, "uExp"), this.opts.exposure);
    gl.uniform1f(loc(gl, g, "uIn"), 1 / this.out);
    gl.uniform1i(loc(gl, g, "uSrc"), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbGlowA);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform2f(loc(gl, g, "uStep"), 1.7 / this.cols, 0);
    gl.uniform1f(loc(gl, g, "uFirst"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbGlowB);
    gl.bindTexture(gl.TEXTURE_2D, this.glowA);
    gl.uniform2f(loc(gl, g, "uStep"), 0, 1.7 / this.rows);
    gl.uniform1f(loc(gl, g, "uFirst"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. glyph masks at full resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const f = this.finalP;
    gl.useProgram(f.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.uniform1i(loc(gl, f, "uCellT"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(loc(gl, f, "uAtlas"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.glowB);
    gl.uniform1i(loc(gl, f, "uGlowT"), 2);
    gl.uniform2f(loc(gl, f, "uCell"), this.cellW, this.cellH);
    gl.uniform2f(loc(gl, f, "uGrid"), this.cols, this.rows);
    gl.uniform2f(loc(gl, f, "uOff"), this.offX, this.offY);
    gl.uniform1f(loc(gl, f, "uAtlasN"), this.atlasN);
    gl.uniform1f(loc(gl, f, "uGlowAmt"), this.opts.glow);
    gl.uniform3f(loc(gl, f, "uBg"), this.opts.bg[0], this.opts.bg[1], this.opts.bg[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  /** Development probe: the cell texture's glyph indices and colours, read back (used to check software renderers). */
  debugCells() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbCell);
    const px = new Uint8Array(this.cols * this.rows * 4);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let glyphs = 0;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! > 0) glyphs++;
      if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
    }
    // the scene's brightest value and how many scene pixels pass the glyph threshold
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbScene);
    const sw = this.cols * 2;
    const sh = this.rows * 2;
    const sc = new Float32Array(sw * sh * 4);
    if (this.hdr) gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, sc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let max = 0;
    let bright = 0;
    for (let i = 0; i < sc.length; i += 4) {
      const m = Math.max(sc[i]!, sc[i + 1]!, sc[i + 2]!);
      if (m > max) max = m;
      if (m > 0.1) bright++;
    }
    return { cols: this.cols, rows: this.rows, glyphs, lit, max, bright, err: gl.getError(), levels: this.levels, hdr: this.hdr };
  }

  dispose() {
    const gl = this.gl;
    this.ctl.dispose?.(gl);
    for (const t of [this.sceneTex, this.cellTex, this.glowA, this.glowB, this.atlasTex]) gl.deleteTexture(t);
    for (const fb of [this.fbScene, this.fbCell, this.fbGlowA, this.fbGlowB]) gl.deleteFramebuffer(fb);
    for (const p of [this.scene, this.sceneLite, this.cellP, this.glowP, this.finalP, this.pointsP]) if (p) gl.deleteProgram(p.p);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.pointsVao);
    gl.deleteBuffer(this.pointsBuf);
    // give the context back now rather than at garbage collection (browsers cap live WebGL contexts)
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
