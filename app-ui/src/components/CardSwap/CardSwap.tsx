import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import gsap from "gsap";
import "./CardSwap.css";

export const CardSwapCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={`peas-card-swap__card${className ? ` ${className}` : ""}`}
    />
  ),
);
CardSwapCard.displayName = "CardSwapCard";

type CardSwapProps = {
  activeIndex: number;
  width?: number | string;
  height?: number | string;
  cardDistance?: number;
  verticalDistance?: number;
  skewAmount?: number;
  children: ReactNode;
};

type Slot = {
  x: number;
  y: number;
  z: number;
  zIndex: number;
};

const makeSlot = (index: number, cardDistance: number, verticalDistance: number, total: number): Slot => ({
  x: index * cardDistance,
  y: -index * verticalDistance,
  z: -index * cardDistance * 1.5,
  zIndex: total - index,
});

const placeNow = (element: HTMLDivElement, slot: Slot, skewAmount: number) => {
  gsap.set(element, {
    x: slot.x,
    y: slot.y,
    z: slot.z,
    xPercent: -50,
    yPercent: -50,
    skewY: skewAmount,
    transformOrigin: "center center",
    zIndex: slot.zIndex,
    force3D: true,
  });
};

const dimension = (value: number | string) => typeof value === "number" ? `${value}px` : value;

/**
 * A controlled adaptation of the React Bits CardSwap effect. The parent owns
 * the selected card, while this component owns only the positional animation.
 */
export default function CardSwap({
  activeIndex,
  width = "100%",
  height = "100%",
  cardDistance = 26,
  verticalDistance = 18,
  skewAmount = 4,
  children,
}: CardSwapProps) {
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const order = useRef<number[]>([]);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const initializedLength = useRef(0);

  useLayoutEffect(() => {
    const elements = cardRefs.current;
    const total = elements.filter(Boolean).length;
    if (total < 1) return;

    const target = Math.max(0, Math.min(activeIndex, total - 1));
    const orderedElements = elements.filter((element): element is HTMLDivElement => Boolean(element));
    if (orderedElements.length !== total) return;

    if (initializedLength.current !== total) {
      timeline.current?.kill();
      order.current = [target, ...Array.from({ length: total }, (_, index) => index).filter((index) => index !== target)];
      order.current.forEach((cardIndex, slotIndex) => {
        const element = elements[cardIndex];
        if (element) placeNow(element, makeSlot(slotIndex, cardDistance, verticalDistance, total), skewAmount);
      });
      initializedLength.current = total;
      return;
    }

    if (order.current[0] === target) return;

    timeline.current?.kill();
    order.current.forEach((cardIndex, slotIndex) => {
      const element = elements[cardIndex];
      if (element) placeNow(element, makeSlot(slotIndex, cardDistance, verticalDistance, total), skewAmount);
    });

    const rest = order.current.filter((cardIndex) => cardIndex !== target);
    const nextOrder = [target, ...rest];
    const selected = elements[target];
    if (!selected) return;

    const nextTimeline = gsap.timeline({
      defaults: { duration: 0.68, ease: "power3.out" },
      onComplete: () => {
        order.current = nextOrder;
        timeline.current = null;
      },
    });
    timeline.current = nextTimeline;

    nextTimeline.to(selected, {
      y: "+=62",
      skewY: skewAmount * -0.5,
      duration: 0.24,
      ease: "power2.in",
    });
    nextTimeline.addLabel("promote", "-=0.04");
    nextTimeline.set(selected, { zIndex: total + 1 }, "promote");
    nextTimeline.to(selected, {
      x: 0,
      y: 0,
      z: 0,
      skewY: 0,
      duration: 0.68,
      ease: "elastic.out(0.72, 0.82)",
    }, "promote");

    rest.forEach((cardIndex, slotIndex) => {
      const element = elements[cardIndex];
      if (!element) return;
      const slot = makeSlot(slotIndex + 1, cardDistance, verticalDistance, total);
      nextTimeline.set(element, { zIndex: slot.zIndex }, "promote");
      nextTimeline.to(element, {
        x: slot.x,
        y: slot.y,
        z: slot.z,
        skewY: skewAmount,
        duration: 0.68,
        ease: "power3.out",
      }, "promote");
    });

    return () => {
      nextTimeline.kill();
    };
  }, [activeIndex, cardDistance, verticalDistance, skewAmount, childArray.length]);

  useLayoutEffect(() => () => {
    timeline.current?.kill();
    cardRefs.current.forEach((element) => element && gsap.killTweensOf(element));
  }, []);

  const containerStyle: CSSProperties = {
    width: dimension(width),
    height: dimension(height),
  };

  return (
    <div className="peas-card-swap" style={containerStyle}>
      {childArray.map((child, index) => isValidElement(child)
        ? cloneElement(child as any, {
            key: child.key ?? index,
            ref: (element: HTMLDivElement | null) => { cardRefs.current[index] = element; },
          })
        : child)}
    </div>
  );
}
