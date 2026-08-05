// The shader is intentionally isolated from the page content. The DOM carries
// all meaning and interaction; this canvas only supplies the visual atmosphere.
// @ts-nocheck
import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";

const vertexShader = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec3 uPillarBlend;
uniform vec3 uPrimaryGreen;
uniform vec3 uSecondaryGreen;
uniform vec3 uGold;
uniform vec3 uBackground;
out vec4 fragColor;

float ringField(vec2 point, float radius, float width) {
  float distanceFromRing = abs(length(point) - radius);
  return exp(-pow(distanceFromRing / max(width, 0.001), 2.0));
}

float arcField(vec2 point, float phase, float width) {
  float arc = point.y - sin(point.x * 3.2 + phase) * 0.16;
  return exp(-pow(abs(arc) / max(width, 0.001), 2.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 point = uv - 0.5;
  point.x *= aspect;

  vec2 pointer = uPointer - 0.5;
  pointer.x *= aspect;
  vec2 focalPoint = mix(vec2(0.0), pointer, uPointerStrength * 0.22);

  float preserve = uPillarBlend.x;
  float discover = uPillarBlend.y;
  float access = uPillarBlend.z;
  float motionRate = 0.055 + preserve * 0.025 + discover * 0.065 + access * 0.045;
  float time = uTime * motionRate;

  float preserveRings = ringField(point - focalPoint * 0.25 + vec2(sin(time * 0.7) * 0.035, cos(time * 0.55) * 0.025), 0.16 + sin(time) * 0.012, 0.012);
  preserveRings += ringField(point - focalPoint * 0.18, 0.32 + sin(time * 0.8) * 0.018, 0.010) * 0.72;
  preserveRings += ringField(point, 0.49 + cos(time * 0.55) * 0.02, 0.009) * 0.52;

  float scanAxis = point.x * 0.78 + point.y * 0.22 - sin(time * 0.7) * 0.42;
  float discoverSweep = exp(-pow(scanAxis / 0.035, 2.0));
  discoverSweep *= 0.55 + 0.45 * sin((point.y + 0.5) * 7.0 + time);

  float accessArcs = arcField(point, time * 0.8, 0.018);
  accessArcs += arcField(point * vec2(1.0, -1.0), time * -0.55 + 1.7, 0.022) * 0.72;
  float gateway = exp(-pow(abs(point.x) / 0.045, 2.0)) * smoothstep(0.72, 0.12, abs(point.y));
  accessArcs += gateway * 0.45;

  float pointerHalo = exp(-dot(point - focalPoint, point - focalPoint) * 10.0) * uPointerStrength;
  float discoveryFocal = exp(-dot(point - focalPoint, point - focalPoint) * 18.0);
  float vignette = smoothstep(1.15, 0.18, length(point));

  vec3 modeTint = uPrimaryGreen * preserve + uGold * discover + uSecondaryGreen * access;
  vec3 color = mix(uBackground, uBackground + modeTint * 0.06, vignette);
  color += uPrimaryGreen * preserveRings * (0.12 + preserve * 0.28);
  color += uGold * discoverSweep * (0.07 + discover * 0.26);
  color += uGold * discoveryFocal * (0.02 + discover * 0.1);
  color += uSecondaryGreen * accessArcs * (0.08 + access * 0.24);
  color += mix(uGold, uSecondaryGreen, 0.4) * pointerHalo * (0.035 + discover * 0.1);
  color = mix(uBackground, color, vignette);

  fragColor = vec4(clamp(color, 0.0, 1.0), 0.98);
}
`;

const PILLAR_BLEND = {
  preserve: [1, 0, 0],
  discover: [0, 1, 0],
  access: [0, 0, 1],
};

const hexToRgb = (hex: string) => {
  const match = hex.replace("#", "").match(/^(..)(..)(..)$/);
  if (!match) return [1, 1, 1];
  return match.slice(1).map((channel) => parseInt(channel, 16) / 255);
};

export type PeasOverviewPillarId = keyof typeof PILLAR_BLEND;

export function PeasOverviewShader({ activePillar }: { activePillar: PeasOverviewPillarId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePillarRef = useRef(activePillar);

  useEffect(() => {
    activePillarRef.current = activePillar;
  }, [activePillar]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const setFallback = () => {
      container.dataset.renderer = "css-fallback";
      container.dataset.motion = "static";
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setFallback();
      return;
    }

    let renderer;
    try {
      renderer = new Renderer({
        canvas,
        webgl: 2,
        alpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        powerPreference: "low-power",
      });
    } catch {
      setFallback();
      return;
    }

    const gl = renderer.gl;
    let program;
    try {
      program = new Program(gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms: {
          uResolution: { value: new Float32Array([1, 1]) },
          uTime: { value: 0 },
          uPointer: { value: new Float32Array([0.5, 0.5]) },
          uPointerStrength: { value: 0 },
          uPillarBlend: { value: new Float32Array(PILLAR_BLEND.preserve) },
          uPrimaryGreen: { value: new Float32Array(hexToRgb("#0b7659")) },
          uSecondaryGreen: { value: new Float32Array(hexToRgb("#3b9c7d")) },
          uGold: { value: new Float32Array(hexToRgb("#c39416")) },
          uBackground: { value: new Float32Array(hexToRgb("#f6faf7")) },
        },
      });
    } catch {
      setFallback();
      return;
    }

    const geometry = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry, program });
    const targetPointer = new Float32Array([0.5, 0.5]);
    const currentPointer = new Float32Array([0.5, 0.5]);
    const currentBlend = new Float32Array(PILLAR_BLEND.preserve);
    const targetBlend = new Float32Array(PILLAR_BLEND.preserve);
    let pointerStrength = 0;
    let targetPointerStrength = 0;
    let animationFrame = 0;
    let isVisible = true;
    let pageVisible = !document.hidden;
    let disposed = false;
    let startTime = performance.now();

    container.dataset.renderer = "webgl2";
    container.dataset.motion = "animated";

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height));
      const resolution = program.uniforms.uResolution.value;
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
    };

    const updateTargetBlend = () => {
      const blend = PILLAR_BLEND[activePillarRef.current] || PILLAR_BLEND.preserve;
      targetBlend[0] = blend[0];
      targetBlend[1] = blend[1];
      targetBlend[2] = blend[2];
    };

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const render = (now: number) => {
      animationFrame = 0;
      if (disposed || !isVisible || !pageVisible) return;

      updateTargetBlend();
      resize();
      const smooth = 0.075;
      for (let index = 0; index < 3; index += 1) {
        currentBlend[index] += (targetBlend[index] - currentBlend[index]) * smooth;
      }
      currentPointer[0] += (targetPointer[0] - currentPointer[0]) * 0.08;
      currentPointer[1] += (targetPointer[1] - currentPointer[1]) * 0.08;
      pointerStrength += (targetPointerStrength - pointerStrength) * 0.08;

      program.uniforms.uTime.value = (now - startTime) * 0.001;
      program.uniforms.uPointer.value[0] = currentPointer[0];
      program.uniforms.uPointer.value[1] = currentPointer[1];
      program.uniforms.uPointerStrength.value = pointerStrength;
      program.uniforms.uPillarBlend.value[0] = currentBlend[0];
      program.uniforms.uPillarBlend.value[1] = currentBlend[1];
      program.uniforms.uPillarBlend.value[2] = currentBlend[2];
      renderer.render({ scene: mesh });
      animationFrame = requestAnimationFrame(render);
    };

    const requestRender = () => {
      if (!animationFrame && isVisible && pageVisible) animationFrame = requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      targetPointer[0] = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      targetPointer[1] = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      targetPointerStrength = 1;
      requestRender();
    };

    const handlePointerLeave = () => {
      targetPointerStrength = 0;
      requestRender();
    };

    const handleVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) requestRender();
      else stop();
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      requestRender();
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry?.isIntersecting ?? true;
      if (isVisible) requestRender();
      else stop();
    }, { threshold: 0.05 });
    intersectionObserver.observe(container);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stop();
      setFallback();
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    resize();
    requestRender();

    return () => {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      geometry.remove();
      program.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div ref={containerRef} className="peas-overview-shader" data-renderer="initializing" data-motion="pending">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
