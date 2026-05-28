"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

type Props = {
  words: string[];
  intervalMs?: number;
  className?: string;
};

export function TextRotator({ words, intervalMs = 2200, className = "" }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length <= 1) return;
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % words.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [words, intervalMs]);

  const current = words[index];

  return (
    <span
      className={`relative inline-flex overflow-hidden align-bottom leading-[1.12] pb-[0.06em] ${className}`}
    >
      <span className="invisible whitespace-nowrap" aria-hidden>
        {longestWord(words)}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={current}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 top-0 whitespace-nowrap text-primary"
        >
          {current}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function longestWord(words: string[]) {
  return words.reduce((longest, word) => (word.length > longest.length ? word : longest), "");
}
