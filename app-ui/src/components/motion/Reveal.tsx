import type { ReactNode } from "react";
import { motion } from "motion/react";

interface RevealProps {
  children: ReactNode;
  index?: number;
  className?: string;
}

export function Reveal({ children, index = 0, className }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.035, 0.16), ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
