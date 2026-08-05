import { Component, useEffect, useMemo, useRef, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { ArrowLeft, Home, LogIn, RefreshCw, Search } from "lucide-react";
import { GridMotion } from "../motion/GridMotion";
import { PublicFooter } from "./PublicFooter";
import { PublicNavbar } from "./PublicNavbar";

const ERROR_STATUSES = [400, 401, 403, 404, 408, 429, 500, 503] as const;
type ErrorStatus = typeof ERROR_STATUSES[number];

interface ErrorPageSpec {
  label: string;
  title: string;
  description: string;
  action: "back" | "home" | "login" | "reload" | "search";
  actionLabel: string;
  palette: readonly [readonly [number, number, number], readonly [number, number, number]];
}

const ERROR_PAGE_SPECS: Record<ErrorStatus, ErrorPageSpec> = {
  400: {
    label: "Bad request",
    title: "This request lost its shape.",
    description: "The address or information sent to PeAS could not be understood. Check it, then try again.",
    action: "back",
    actionLabel: "Go back",
    palette: [[0.11, 0.55, 0.40], [0.83, 0.63, 0.09]],
  },
  401: {
    label: "Authentication required",
    title: "Please sign in to continue.",
    description: "This part of the archive is available only after PeAS confirms your account.",
    action: "login",
    actionLabel: "Sign in",
    palette: [[0.04, 0.42, 0.31], [0.24, 0.67, 0.54]],
  },
  403: {
    label: "Access restricted",
    title: "This record is beyond your access level.",
    description: "Your account is recognized, but it does not have permission to open this page or file.",
    action: "back",
    actionLabel: "Go back",
    palette: [[0.60, 0.29, 0.12], [0.88, 0.65, 0.12]],
  },
  404: {
    label: "Page not found",
    title: "There is no record at this address.",
    description: "The page may have moved, the link may be outdated, or the address may contain a typo.",
    action: "search",
    actionLabel: "Search the repository",
    palette: [[0.02, 0.42, 0.31], [0.83, 0.63, 0.09]],
  },
  408: {
    label: "Request timed out",
    title: "The request took too long to arrive.",
    description: "The connection paused before PeAS could finish. Your data has not been changed by this page.",
    action: "reload",
    actionLabel: "Try again",
    palette: [[0.10, 0.38, 0.51], [0.26, 0.70, 0.65]],
  },
  429: {
    label: "Too many requests",
    title: "The archive needs a brief pause.",
    description: "Too many requests reached PeAS in a short period. Wait a moment before trying again.",
    action: "reload",
    actionLabel: "Try again",
    palette: [[0.51, 0.30, 0.08], [0.91, 0.69, 0.16]],
  },
  500: {
    label: "Internal server error",
    title: "Something interrupted the archive.",
    description: "PeAS encountered an unexpected problem. Refresh once, or return later if the issue continues.",
    action: "reload",
    actionLabel: "Refresh page",
    palette: [[0.48, 0.13, 0.18], [0.83, 0.38, 0.27]],
  },
  503: {
    label: "Service unavailable",
    title: "The archive is temporarily offline.",
    description: "PeAS may be restarting or undergoing maintenance. Please try again in a few moments.",
    action: "reload",
    actionLabel: "Try again",
    palette: [[0.21, 0.28, 0.50], [0.41, 0.53, 0.83]],
  },
};

export function PublicPageShell({
  children,
  mainClassName = "",
  pageClassName = "",
  showFooter = true,
  showNavbar = true,
}: {
  children: ReactNode;
  mainClassName?: string;
  pageClassName?: string;
  showFooter?: boolean;
  showNavbar?: boolean;
}) {
  return (
    <div className={`peas-public-page ${pageClassName}`.trim()}>
      <a className="peas-skip-link" href="#main-content">Skip to main content</a>
      {showNavbar ? <PublicNavbar /> : null}
      <main id="main-content" className={mainClassName}>{children}</main>
      {showFooter ? <PublicFooter /> : null}
    </div>
  );
}

export function AuthShell({ children, showHomeLink = true }: { children: ReactNode; showHomeLink?: boolean }) {
  return (
    <main id="main-content" className="peas-auth-shell">
      {showHomeLink ? <a className="peas-auth-home" href="/index.html" aria-label="Return to PeAS home">PeAS</a> : null}
      {children}
    </main>
  );
}

export function PublicErrorPage({ status }: { status?: number }) {
  const resolvedStatus = resolveErrorStatus(status);
  const spec = ERROR_PAGE_SPECS[resolvedStatus];
  const style = {
    "--peas-error-accent": rgbCss(spec.palette[0]),
    "--peas-error-glow": rgbCss(spec.palette[1]),
  } as CSSProperties;

  useEffect(() => {
    document.title = `${resolvedStatus} ${spec.label} | PeAS`;
  }, [resolvedStatus, spec.label]);

  const motionItems = useMemo(() => [
    <span className="peas-error-motion-number" key="status">{resolvedStatus}</span>,
    <img className="peas-error-motion-logo" src="/Components/images/spud_logo_s.png" alt="" key="university" />,
    <img className="peas-error-motion-logo" src="/Components/images/peas.png" alt="" key="department" />,
  ], [resolvedStatus]);

  return (
    <PublicPageShell mainClassName="peas-error-page" pageClassName="peas-public-page--error" showFooter={false} showNavbar={false}>
      <section className="peas-error-page__hero" style={style} aria-labelledby="peas-error-title">
        <ErrorShader status={resolvedStatus} palette={spec.palette} />
        <GridMotion className="peas-error-page__motion" gradientColor="rgba(255, 255, 255, .62)" items={motionItems} />
        <div className="peas-error-page__grid" aria-hidden="true" />

        <div className="peas-error-page__content" role="alert">
          <div className="peas-error-page__logos">
            <img src="/Components/images/spud_logo_s.png" alt="St. Paul University Dumaguete seal" />
            <img src="/Components/images/peas.png" alt="Office of Research and Publications logo" />
          </div>
          <p className="peas-error-page__eyebrow">HTTP {resolvedStatus} · {spec.label}</p>
          <h1 id="peas-error-title">{spec.title}</h1>
          <p className="peas-error-page__description">{spec.description}</p>
          <div className="peas-error-page__actions">
            <PrimaryErrorAction action={spec.action} label={spec.actionLabel} />
            <a className="peas-error-page__secondary" href="/index.html"><Home aria-hidden="true" /> Return home</a>
          </div>
          <p className="peas-error-page__hint">If this keeps happening, contact the Office of Research &amp; Publications.</p>
        </div>
      </section>
    </PublicPageShell>
  );
}

function PrimaryErrorAction({ action, label }: { action: ErrorPageSpec["action"]; label: string }) {
  const className = "peas-error-page__primary";

  if (action === "login") return <a className={className} href="/log-in.html"><LogIn aria-hidden="true" /> {label}</a>;
  if (action === "search") return <a className={className} href="/pages/searchResultsPage.html"><Search aria-hidden="true" /> {label}</a>;
  if (action === "home") return <a className={className} href="/index.html"><Home aria-hidden="true" /> {label}</a>;
  if (action === "back") {
    return <button className={className} type="button" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign("/index.html")}><ArrowLeft aria-hidden="true" /> {label}</button>;
  }
  return <button className={className} type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" /> {label}</button>;
}

function resolveErrorStatus(explicitStatus?: number): ErrorStatus {
  if (ERROR_STATUSES.includes(explicitStatus as ErrorStatus)) return explicitStatus as ErrorStatus;

  const serverStatus = Number(document.body.dataset.peasErrorStatus);
  if (ERROR_STATUSES.includes(serverStatus as ErrorStatus)) return serverStatus as ErrorStatus;

  const pathStatus = Number(window.location.pathname.match(/^\/error\/(\d{3})\/?$/)?.[1]);
  return ERROR_STATUSES.includes(pathStatus as ErrorStatus) ? pathStatus as ErrorStatus : 404;
}

function rgbCss(color: readonly [number, number, number]) {
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(" ")})`;
}

function ErrorShader({ status, palette }: { status: ErrorStatus; palette: ErrorPageSpec["palette"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) {
      canvas.dataset.renderer = "gradient-fallback";
      return;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_seed;
      uniform vec3 u_primary;
      uniform vec3 u_secondary;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 p = uv - 0.5;
        p.x *= u_resolution.x / max(u_resolution.y, 1.0);
        float t = u_time * 0.12;
        float field = noise(p * 3.2 + vec2(t, -t * 0.7) + u_seed);
        float ridgeA = 1.0 - smoothstep(0.0, 0.19, abs(p.y + sin(p.x * 3.8 + t + field) * 0.13));
        float ridgeB = 1.0 - smoothstep(0.0, 0.24, abs(p.y * 0.7 - cos(p.x * 2.4 - t * 0.8) * 0.24));
        float halo = exp(-2.6 * dot(p - vec2(0.24, 0.02), p - vec2(0.24, 0.02)));
        float grain = (hash(gl_FragCoord.xy + floor(u_time * 4.0)) - 0.5) * 0.012;
        vec3 base = vec3(0.965, 0.976, 0.957);
        vec3 color = mix(base, u_primary, 0.035 + ridgeB * 0.065 + field * 0.018);
        color = mix(color, u_secondary, ridgeA * 0.085 + halo * 0.055);
        color += grain;
        gl_FragColor = vec4(color, 1.0);
      }
    `);

    if (!vertexShader || !fragmentShader) {
      canvas.dataset.renderer = "gradient-fallback";
      return;
    }

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.dataset.renderer = "gradient-fallback";
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const seed = gl.getUniformLocation(program, "u_seed");
    const primary = gl.getUniformLocation(program, "u_primary");
    const secondary = gl.getUniformLocation(program, "u_secondary");
    gl.uniform1f(seed, status / 100);
    gl.uniform3fv(primary, palette[0]);
    gl.uniform3fv(secondary, palette[1]);
    canvas.dataset.renderer = "webgl-fragment-shader";

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    const startedAt = performance.now();
    const render = (now: number) => {
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(canvas.clientWidth * density));
      const height = Math.max(1, Math.round(canvas.clientHeight * density));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(time, reduceMotion ? 2.5 : (now - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduceMotion) animationFrame = window.requestAnimationFrame(render);
    };
    render(startedAt);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, [palette, status]);

  return <canvas ref={canvasRef} className="peas-error-page__shader" aria-hidden="true" />;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class PublicErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Public page render failed", error, info); }

  render() {
    if (this.state.failed) {
      return <PublicErrorPage status={500} />;
    }
    return this.props.children;
  }
}
