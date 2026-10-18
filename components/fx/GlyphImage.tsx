"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

/**
 * Renders a glyph grid (public/art/*.json, built by scripts/ascii-art.ts) as
 * live ASCII art with WebGL2: one draw call, every cell picks a density or
 * edge glyph from a font atlas. Effects: decode-in intro, a travelling light
 * band ("x") or radar ping rings ("ping"), faint twinkle, and a lens that
 * brightens glyphs under the pointer. Falls back to a single Canvas2D frame
 * without WebGL2, and to a still frame under prefers-reduced-motion.
 */

interface Grid {
  cols: number;
  rows: number;
  bytes: Uint8Array;
}

const cache = new Map<string, Promise<Grid>>();
function loadGrid(src: string): Promise<Grid> {
  let p = cache.get(src);
  if (!p) {
    p = fetch(src)
      .then((r) => r.json() as Promise<{ cols: number; rows: number; data: string }>)
      .then((j) => {
        const bin = atob(j.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { cols: j.cols, rows: j.rows, bytes };
      });
    cache.set(src, p);
  }
  return p;
}

const RAMP = " .,:;-~+=*o#%@";
const EDGES = "-/|\\";
const SCRAMBLE = "01<>=+*#%@ABCDEFGHKMNRSTXZ/\\|";
const ALL = RAMP + EDGES + SCRAMBLE;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VERT = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uLum;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform float uTime;
uniform float uIntro;
uniform float uPhase;
uniform int uMode;
uniform vec2 uCenter;
uniform vec2 uMouse;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform float uThresh;
uniform float uMotion;
uniform float uGain;
out vec4 o;
const float RAMP = ${RAMP.length}.0;
const float EDGES = ${EDGES.length}.0;
const float SCR = ${SCRAMBLE.length}.0;
const float GLYPHS = ${ALL.length}.0;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cf = px / uCell;
  vec2 cell = floor(cf);
  vec2 local = fract(cf);
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) { o = vec4(0.0); return; }
  vec2 uv = (cell + 0.5) / uGrid;
  vec4 s = texture(uLum, uv);
  float lum = clamp(s.r * uGain, 0.0, 1.0);
  float edge = floor(s.g * 255.0 + 0.5);
  float h = hash(cell);
  float b = lum;
  float lit = smoothstep(0.03, 0.22, lum);
  if (uMode == 1) { float d = uv.x - uPhase; b += exp(-d * d * 160.0) * 0.5 * lit; }
  if (uMode == 2) {
    vec2 v = (uv - uCenter) * vec2(uGrid.x / uGrid.y * 0.6, 1.0);
    float d = length(v);
    float ring = exp(-pow((d - uPhase) * 22.0, 2.0));
    b += ring * 0.45 * (0.25 + lit);
  }
  if (uMouse.x >= 0.0) {
    vec2 dm = (px - uMouse) / uCell * vec2(1.0, 1.65);
    b += 0.4 * exp(-dot(dm, dm) / 70.0) * (0.15 + lit);
  }
  b += uMotion * (sin(uTime * 1.7 + h * 50.0) * 0.5 + 0.5) * 0.06 * step(0.12, lum);
  b = clamp(b, 0.0, 1.0);
  bool revealed = (uIntro * 1.35 - (uv.x * 0.9 + h * 0.35)) > 0.0;
  float gi;
  if (!revealed) gi = RAMP + EDGES + floor(hash(cell + floor(uTime * 22.0)) * SCR);
  else if (edge > 0.5 && b > 0.26) gi = RAMP + edge - 1.0;
  else gi = floor(b * (RAMP - 1.0) + 0.5);
  float a = texture(uAtlas, vec2((gi + local.x) / GLYPHS, local.y)).a;
  float vis = revealed ? smoothstep(uThresh, uThresh + 0.05, b) : step(uThresh + 0.02, lum) * 0.55;
  float alpha = a * vis * (revealed ? (0.28 + 0.72 * b) : 0.6);
  vec3 col = mix(uTint2, uTint, b);
  o = vec4(col * alpha, alpha);
}`;

interface Props {
  src: string;
  tint: string;
  tint2?: string;
  /** Minimum cell width in CSS px; fewer columns are drawn on narrow screens. */
  minCell?: number;
  mode?: "x" | "ping" | "none";
  /** Ping centre in 0-1 image coordinates (top-left origin). */
  center?: [number, number];
  threshold?: number;
  /** Multiplies source luminance (brighter, denser glyphs). */
  gain?: number;
  className?: string;
  label: string;
}

export function GlyphImage({ src, tint, tint2 = "#1a1206", minCell = 6, mode = "x", center = [0.75, 0.72], threshold = 0.1, gain = 1, className = "", label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    const reduced = prefersReducedMotion();

    loadGrid(src).then(async (grid) => {
      if (disposed) return;
      try {
        await document.fonts.ready;
      } catch {
        // fonts API unavailable
      }
      if (disposed) return;
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";
      const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });

      let cols = grid.cols;
      let rows = grid.rows;
      let cellW = 8;
      let cellH = 13;
      let dpr = 1;

      const layout = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = wrap.clientWidth || 1;
        cols = Math.max(40, Math.min(grid.cols, Math.floor(width / minCell)));
        rows = Math.round((grid.rows * cols) / grid.cols);
        cellW = width / cols;
        cellH = cellW / 0.6;
        const height = rows * cellH;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      };

      const buildAtlas = () => {
        const cw = Math.max(4, Math.round(cellW * dpr));
        const ch = Math.max(6, Math.round(cellH * dpr));
        const atlas = document.createElement("canvas");
        atlas.width = cw * ALL.length;
        atlas.height = ch;
        const ctx = atlas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `500 ${Math.floor(ch * 0.78)}px ${fontVar}`;
        for (let i = 0; i < ALL.length; i++) ctx.fillText(ALL[i]!, i * cw + cw / 2, ch / 2 + ch * 0.04);
        return atlas;
      };

      if (!gl) {
        // Canvas2D fallback: a single still frame.
        const draw = () => {
          layout();
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.font = `500 ${Math.floor(cellH * 0.78)}px ${fontVar}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const gc = Math.floor((c / cols) * grid.cols);
              const gr = Math.floor((r / rows) * grid.rows);
              const L = Math.min(1, (grid.bytes[(gr * grid.cols + gc) * 2]! / 255) * gain);
              const e = grid.bytes[(gr * grid.cols + gc) * 2 + 1]!;
              if (L < threshold) continue;
              const ch = e && L > 0.26 ? EDGES[e - 1]! : RAMP[Math.round(L * (RAMP.length - 1))]!;
              ctx.globalAlpha = 0.28 + 0.72 * L;
              ctx.fillStyle = tint;
              ctx.fillText(ch, c * cellW + cellW / 2, r * cellH + cellH / 2);
            }
          }
        };
        draw();
        const ro = new ResizeObserver(draw);
        ro.observe(wrap);
        cleanup = () => ro.disconnect();
        return;
      }

      const compile = (type: number, srcText: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, srcText);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const lumTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lumTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, grid.cols, grid.rows, 0, gl.RG, gl.UNSIGNED_BYTE, grid.bytes);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const atlasTex = gl.createTexture();
      const uploadAtlas = () => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };

      const u = (n: string) => gl.getUniformLocation(prog, n);
      gl.uniform1i(u("uLum"), 0);
      gl.uniform1i(u("uAtlas"), 1);
      gl.uniform3fv(u("uTint"), hexToRgb(tint));
      gl.uniform3fv(u("uTint2"), hexToRgb(tint2));
      gl.uniform1f(u("uThresh"), threshold);
      gl.uniform1i(u("uMode"), reduced ? 0 : mode === "x" ? 1 : mode === "ping" ? 2 : 0);
      gl.uniform2f(u("uCenter"), center[0], center[1]);
      gl.uniform1f(u("uMotion"), reduced ? 0 : 1);
      gl.uniform1f(u("uGain"), gain);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      let mouse: [number, number] = [-1, -1];
      const onMove = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        mouse = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
      };
      const onLeave = () => {
        mouse = [-1, -1];
      };
      if (!reduced) {
        canvas.addEventListener("pointermove", onMove);
        canvas.addEventListener("pointerleave", onLeave);
      }

      const resize = () => {
        layout();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(u("uRes"), canvas.width, canvas.height);
        gl.uniform2f(u("uCell"), cellW * dpr, cellH * dpr);
        gl.uniform2f(u("uGrid"), cols, rows);
        uploadAtlas();
      };
      resize();

      const t0 = performance.now();
      let visible = true;
      const frame = (t: number) => {
        const s = (t - t0) / 1000;
        gl.uniform1f(u("uTime"), s);
        gl.uniform1f(u("uIntro"), reduced ? 10 : Math.min(10, s / 1.6));
        const period = mode === "ping" ? 4.5 : 7;
        const ph = (s % period) / period;
        gl.uniform1f(u("uPhase"), mode === "ping" ? ph * 1.6 : ph * 1.5 - 0.25);
        gl.uniform2f(u("uMouse"), mouse[0], mouse[1]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      const ro = new ResizeObserver(() => {
        resize();
        if (reduced) frame(performance.now());
      });
      ro.observe(wrap);
      const io = new IntersectionObserver((entries) => {
        const was = visible;
        visible = entries.some((e) => e.isIntersecting);
        if (visible && !was && !reduced) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(frame);
        }
      });
      io.observe(canvas);
      const onVis = () => {
        if (!document.hidden && visible && !reduced) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(frame);
        }
      };
      document.addEventListener("visibilitychange", onVis);

      cleanup = () => {
        ro.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        gl.deleteTexture(lumTex);
        gl.deleteTexture(atlasTex);
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
      };
    }).catch(() => {
      // Art is decorative; failure leaves the space empty.
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, [src, tint, tint2, minCell, mode, center, threshold, gain]);

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} role="img" aria-label={label}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
