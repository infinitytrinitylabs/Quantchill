'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';

export interface RareConnectionCard {
  id: string;
  name: string;
  compatibilityPercent: number;
  context: string;
}

export interface SerendipityUIProps {
  connection: RareConnectionCard;
  onOpen?: (connection: RareConnectionCard) => void;
}

function triggerMobileHaptics(): void {
  if (typeof navigator === 'undefined') return;
  if ('vibrate' in navigator) {
    navigator.vibrate([14, 32, 14]);
  }
}

export default function SerendipityUI({ connection, onOpen }: SerendipityUIProps) {
  useEffect(() => {
    triggerMobileHaptics();
  }, [connection.id]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-2xl border border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-500/15 via-indigo-500/10 to-black/30 p-4"
      style={{
        boxShadow: '0 0 24px rgba(217, 70, 239, 0.3), inset 0 0 28px rgba(99, 102, 241, 0.15)'
      }}
    >
      <div className="absolute right-3 top-3 rounded-full border border-fuchsia-300/40 bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-fuchsia-100">
        Rare Connection
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-fuchsia-100/70">SPONTANEOUS RESONANCE</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{connection.name}</h3>
          <p className="mt-1 text-xs text-white/70">{connection.context}</p>
        </div>
        <div className="rounded-xl border border-white/15 bg-white/5 px-2.5 py-1 text-right">
          <p className="text-[10px] uppercase tracking-widest text-white/60">Match</p>
          <p className="text-lg font-semibold text-fuchsia-200">{connection.compatibilityPercent}%</p>
        </div>
      </div>

      <button
        className="mt-4 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/30"
        onClick={() => onOpen?.(connection)}
      >
        Open spontaneous discovery
      </button>
    </motion.section>
  );
}
