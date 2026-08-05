import { useCallback, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import "./BorderGlow.css";

type GlowStyle = CSSProperties & Record<`--${string}`, string | number>;

interface BorderGlowProps {
  children: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  colors?: string[];
  fillOpacity?: number;
}

const GRADIENT_POSITIONS = ["80% 55%", "69% 34%", "8% 6%", "41% 38%", "86% 85%", "82% 18%", "51% 4%"];
const GRADIENT_KEYS = ["--gradient-one", "--gradient-two", "--gradient-three", "--gradient-four", "--gradient-five", "--gradient-six", "--gradient-seven"] as const;
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function parseHsl(value: string) {
  const match = value.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, s: 80, l: 80 };
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHsl(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ["", "-60", "-50", "-40", "-30", "-20", "-10"];

  return Object.fromEntries(
    opacities.map((opacity, index) => [
      `--glow-color${keys[index]}`,
      `hsl(${base} / ${Math.min(opacity * intensity, 100)}%)`,
    ]),
  );
}

function buildGradientVars(colors: string[]): Record<string, string> {
  const safeColors = colors.length ? colors : ["#0b7659"];
  const vars = Object.fromEntries(
    GRADIENT_KEYS.map((key, index) => {
      const color = safeColors[Math.min(COLOR_MAP[index], safeColors.length - 1)];
      return [key, `radial-gradient(at ${GRADIENT_POSITIONS[index]}, ${color} 0, transparent 50%)`];
    }),
  );

  return {
    ...vars,
    "--gradient-base": `linear-gradient(${safeColors[0]} 0 100%)`,
  };
}

export default function BorderGlow({
  children,
  className = "",
  edgeSensitivity = 30,
  glowColor = "40 80 80",
  backgroundColor = "#ffffff",
  borderRadius = 24,
  glowRadius = 32,
  glowIntensity = 0.45,
  coneSpread = 25,
  colors = ["#0b7659", "#c39416", "#3b9c7d"],
  fillOpacity = 0.12,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const getCenter = useCallback((element: HTMLDivElement) => {
    const { width, height } = element.getBoundingClientRect();
    return [width / 2, height / 2] as const;
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || event.pointerType === "touch") return;

    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const [centerX, centerY] = getCenter(card);
    const dx = x - centerX;
    const dy = y - centerY;
    const edgeX = dx === 0 ? Number.POSITIVE_INFINITY : centerX / Math.abs(dx);
    const edgeY = dy === 0 ? Number.POSITIVE_INFINITY : centerY / Math.abs(dy);
    const proximity = Math.min(Math.max(1 / Math.min(edgeX, edgeY), 0), 1);
    const angle = dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI + 90;

    card.style.setProperty("--edge-proximity", `${(proximity * 100).toFixed(3)}`);
    card.style.setProperty("--cursor-angle", `${(angle < 0 ? angle + 360 : angle).toFixed(3)}deg`);
  }, [getCenter]);

  const style: GlowStyle = {
    "--card-bg": backgroundColor,
    "--edge-sensitivity": edgeSensitivity,
    "--border-radius": `${borderRadius}px`,
    "--glow-padding": `${glowRadius}px`,
    "--cone-spread": coneSpread,
    "--fill-opacity": fillOpacity,
    ...buildGlowVars(glowColor, glowIntensity),
    ...buildGradientVars(colors),
  };

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`.trim()}
      onPointerMove={handlePointerMove}
      style={style}
    >
      <span className="edge-light" aria-hidden="true" />
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
