'use client';

import { motion } from 'framer-motion';

interface WaveformProps {
  isActive?: boolean;
}

export function Waveform({ isActive = true }: WaveformProps) {
  const bars = 12;

  return (
    <div className="flex h-16 items-center justify-center gap-1">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-yellow-400"
          animate={
            isActive
              ? {
                  height: [16, Math.random() * 48 + 16, 16],
                }
              : { height: 8 }
          }
          transition={
            isActive
              ? {
                  duration: 0.4 + Math.random() * 0.3,
                  repeat: Infinity,
                  repeatType: 'reverse',
                  delay: i * 0.05,
                }
              : { duration: 0.3 }
          }
          style={{ height: 16 }}
        />
      ))}
    </div>
  );
}
