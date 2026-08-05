import { useEffect, useRef } from "react";

const GRID_SIZE = 8;
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE;
const DISTORTION_INTENSITY = 1.9;
const DISTORTION_DECAY = 3;
const DISTORTION_RADIUS = 0.1;

const vertexShaderSource = `#version 300 es
out vec2 vUv;

void main() {
  vec2 position = gl_VertexID == 0
    ? vec2(-1.0, -1.0)
    : (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uObjectPosition;
uniform vec2 uGridDisplacements[${GRID_CELL_COUNT}];

in vec2 vUv;
out vec4 outColor;

vec2 coverUv(vec2 uv) {
  float viewportAspect = uResolution.x / max(uResolution.y, 1.0);
  float imageAspect = uImageSize.x / max(uImageSize.y, 1.0);

  if (imageAspect > viewportAspect) {
    float visibleWidth = viewportAspect / imageAspect;
    uv.x = uv.x * visibleWidth + (1.0 - visibleWidth) * uObjectPosition.x;
  } else {
    float visibleHeight = imageAspect / viewportAspect;
    uv.y = uv.y * visibleHeight + (1.0 - visibleHeight) * uObjectPosition.y;
  }

  return uv;
}

vec2 readGridCell(ivec2 cell) {
  ivec2 safeCell = clamp(cell, ivec2(0), ivec2(${GRID_SIZE - 1}));
  return uGridDisplacements[safeCell.y * ${GRID_SIZE} + safeCell.x];
}

vec2 sampleGridDisplacement(vec2 uv) {
  vec2 gridPosition = clamp(uv, vec2(0.0), vec2(1.0)) * float(${GRID_SIZE}) - 0.5;
  ivec2 baseCell = ivec2(floor(gridPosition));
  vec2 blend = fract(gridPosition);
  vec2 top = mix(readGridCell(baseCell), readGridCell(baseCell + ivec2(1, 0)), blend.x);
  vec2 bottom = mix(
    readGridCell(baseCell + ivec2(0, 1)),
    readGridCell(baseCell + ivec2(1, 1)),
    blend.x
  );
  return mix(top, bottom, blend.y);
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float cellsX = max(aspect >= 1.0 ? float(${GRID_SIZE}) * aspect : float(${GRID_SIZE}), 1.0);
  float cellsY = max(aspect >= 1.0 ? float(${GRID_SIZE}) : float(${GRID_SIZE}) / aspect, 1.0);
  vec2 snappedUv = (floor(vUv * vec2(cellsX, cellsY)) + 0.5) / vec2(cellsX, cellsY);
  vec2 displacement = clamp(sampleGridDisplacement(snappedUv), vec2(-0.1), vec2(0.1));
  vec2 displacedUv = vUv - displacement;
  vec2 imageUv = clamp(coverUv(displacedUv), vec2(0.001), vec2(0.999));
  outColor = texture(uImage, imageUv);
}
`;

interface InteractiveImageDistortionProps {
  src: string;
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

export function InteractiveImageDistortion({ src }: InteractiveImageDistortionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const artwork = canvas.parentElement;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
    });
    if (!artwork || !gl) return;

    const program = createProgram(gl);
    const texture = gl.createTexture();
    const vertexArray = gl.createVertexArray();
    if (!program || !texture || !vertexArray) {
      if (program) gl.deleteProgram(program);
      if (texture) gl.deleteTexture(texture);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      return;
    }

    const resolutionLocation = gl.getUniformLocation(program, "uResolution");
    const imageSizeLocation = gl.getUniformLocation(program, "uImageSize");
    const objectPositionLocation = gl.getUniformLocation(program, "uObjectPosition");
    const gridDisplacementsLocation = gl.getUniformLocation(program, "uGridDisplacements[0]");
    const imageLocation = gl.getUniformLocation(program, "uImage");
    const gridDisplacements = new Float32Array(GRID_CELL_COUNT * 2);
    let animationFrame = 0;
    let isIntersecting = true;
    let imageWidth = 1;
    let imageHeight = 1;
    let pointerX = 0.5;
    let pointerY = 0.5;
    let previousPointerX = 0.5;
    let previousPointerY = 0.5;
    let smoothedVelocityX = 0;
    let smoothedVelocityY = 0;
    let pointerInside = false;
    let previousFrameTime = 0;
    let disposed = false;

    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(imageLocation, 0);

    const resize = () => {
      const bounds = artwork.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * pixelRatio));
      const height = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (now: number) => {
      animationFrame = 0;
      if (disposed || !isIntersecting || document.hidden) return;
      resize();

      const deltaTime = previousFrameTime
        ? Math.min((now - previousFrameTime) / 1000, 0.016)
        : 0.016;
      previousFrameTime = now;

      const rawVelocityX = pointerInside ? (pointerX - previousPointerX) / deltaTime : 0;
      const rawVelocityY = pointerInside ? (pointerY - previousPointerY) / deltaTime : 0;
      smoothedVelocityX = smoothedVelocityX * 0.85 + rawVelocityX * 0.15;
      smoothedVelocityY = smoothedVelocityY * 0.85 + rawVelocityY * 0.15;
      previousPointerX = pointerX;
      previousPointerY = pointerY;

      const aspect = canvas.width / Math.max(canvas.height, 1);
      const velocityMagnitude = Math.abs(smoothedVelocityX) + Math.abs(smoothedVelocityY);
      let hasMotion = velocityMagnitude > 0.001;
      for (let cellY = 0; cellY < GRID_SIZE; cellY += 1) {
        for (let cellX = 0; cellX < GRID_SIZE; cellX += 1) {
          const index = (cellY * GRID_SIZE + cellX) * 2;
          let displacementX = gridDisplacements[index] * (1 - DISTORTION_DECAY * deltaTime);
          let displacementY = gridDisplacements[index + 1] * (1 - DISTORTION_DECAY * deltaTime);
          const gridX = (cellX + 0.5) / GRID_SIZE;
          const gridY = (cellY + 0.5) / GRID_SIZE;
          const distanceX = aspect >= 1 ? (gridX - pointerX) * aspect : gridX - pointerX;
          const distanceY = aspect >= 1 ? gridY - pointerY : (gridY - pointerY) / aspect;
          const distanceSquared = distanceX * distanceX + distanceY * distanceY;

          if (
            pointerInside
            && velocityMagnitude > 0.01
            && distanceSquared < (DISTORTION_RADIUS * 2) ** 2
          ) {
            const influence = Math.exp(-distanceSquared / (DISTORTION_RADIUS ** 2));
            displacementX += smoothedVelocityX * influence * DISTORTION_INTENSITY * deltaTime * 0.5;
            displacementY += smoothedVelocityY * influence * DISTORTION_INTENSITY * deltaTime * 0.5;
          }

          gridDisplacements[index] = Math.max(-1, Math.min(1, displacementX));
          gridDisplacements[index + 1] = Math.max(-1, Math.min(1, displacementY));
          hasMotion ||= Math.abs(displacementX) + Math.abs(displacementY) > 0.0001;
        }
      }

      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform2f(imageSizeLocation, imageWidth, imageHeight);
      const compactLayout = window.matchMedia("(max-width: 900px)").matches;
      gl.uniform2f(
        objectPositionLocation,
        compactLayout ? 0.5 : 0.52,
        compactLayout ? 0.57 : 0.5,
      );
      gl.uniform2fv(gridDisplacementsLocation, gridDisplacements);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.classList.add("is-ready");

      if (hasMotion) animationFrame = requestAnimationFrame(draw);
    };

    const requestDraw = () => {
      if (!animationFrame && isIntersecting && !document.hidden) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const updatePointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = artwork.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      pointerX = (event.clientX - bounds.left) / bounds.width;
      pointerY = 1 - (event.clientY - bounds.top) / bounds.height;
      pointerInside = true;
      requestDraw();
    };

    const resetPointer = () => {
      pointerInside = false;
      requestDraw();
    };

    const handleVisibility = () => {
      if (document.hidden && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        requestDraw();
      }
    };

    const resizeObserver = new ResizeObserver(() => requestDraw());
    resizeObserver.observe(artwork);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = entry?.isIntersecting ?? true;
      if (isIntersecting) requestDraw();
      else if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    });
    intersectionObserver.observe(artwork);
    artwork.addEventListener("pointermove", updatePointer, { passive: true });
    artwork.addEventListener("pointerleave", resetPointer);
    document.addEventListener("visibilitychange", handleVisibility);

    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (disposed) return;
      imageWidth = image.naturalWidth || 1;
      imageHeight = image.naturalHeight || 1;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        requestDraw();
      } catch {
        canvas.classList.remove("is-ready");
      }
    };
    image.src = src;

    return () => {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      artwork.removeEventListener("pointermove", updatePointer);
      artwork.removeEventListener("pointerleave", resetPointer);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.classList.remove("is-ready");
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vertexArray);
      gl.deleteProgram(program);
    };
  }, [src]);

  return <>
    <img className="peas-login-art__image" src={src} alt="" />
    <canvas
      ref={canvasRef}
      className="peas-login-art__canvas"
      data-effect="grid-distortion"
      aria-hidden="true"
    />
  </>;
}
