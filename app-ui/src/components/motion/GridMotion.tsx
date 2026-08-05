import { useEffect, useMemo, useRef, type ReactNode } from "react";

interface GridMotionProps {
  items?: ReactNode[];
  gradientColor?: string;
  className?: string;
}

const TOTAL_ITEMS = 28;
const ROW_COUNT = 4;
const ITEMS_PER_ROW = 7;

export function GridMotion({ items = [], gradientColor = "#f7faf5", className = "" }: GridMotionProps) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pointerXRef = useRef(0);
  const combinedItems = useMemo(() => {
    const source = items.length ? items : Array.from({ length: TOTAL_ITEMS }, (_, index) => `Item ${index + 1}`);
    return Array.from({ length: TOTAL_ITEMS }, (_, index) => source[index % source.length]);
  }, [items]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pointerXRef.current = window.innerWidth / 2;
    if (reduceMotion) return;

    let cancelled = false;
    let cleanupMotion = () => undefined;
    void import("gsap").then(({ gsap }) => {
      if (cancelled) return;

      const inertia = [1.05, 1.2, 1.35, 1.5];
      const rowSetters = rowRefs.current.map((row, index) => row
        ? gsap.quickTo(row, "x", { duration: inertia[index % inertia.length], ease: "power3.out" })
        : null);
      const handlePointerMove = (event: PointerEvent) => {
        pointerXRef.current = event.clientX;
      };
      const updateMotion = () => {
        const viewportWidth = Math.max(window.innerWidth, 1);
        const normalized = pointerXRef.current / viewportWidth - 0.5;
        rowSetters.forEach((setX, index) => {
          if (setX) setX(normalized * 150 * (index % 2 === 0 ? 1 : -1));
        });
      };

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      gsap.ticker.add(updateMotion);
      cleanupMotion = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        gsap.ticker.remove(updateMotion);
        rowRefs.current.forEach((row) => row && gsap.killTweensOf(row));
      };
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      cleanupMotion();
    };
  }, []);

  return (
    <div className={`peas-grid-motion ${className}`.trim()} aria-hidden="true">
      <div className="peas-grid-motion__gradient" style={{ background: `radial-gradient(circle, ${gradientColor} 0%, transparent 70%)` }} />
      <div className="peas-grid-motion__container">
        {Array.from({ length: ROW_COUNT }, (_, rowIndex) => (
          <div
            className="peas-grid-motion__row"
            key={rowIndex}
            ref={(element) => { rowRefs.current[rowIndex] = element; }}
          >
            {Array.from({ length: ITEMS_PER_ROW }, (_, itemIndex) => {
              const index = rowIndex * ITEMS_PER_ROW + itemIndex;
              return (
                <div className="peas-grid-motion__item" key={index}>
                  <div className="peas-grid-motion__item-inner">{combinedItems[index]}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
