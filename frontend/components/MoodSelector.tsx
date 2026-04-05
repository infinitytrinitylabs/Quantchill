'use client';

import { motion } from 'framer-motion';
import type { MoodState } from '@/lib/mockData';
import { MOODS } from '@/lib/mockData';

interface MoodSelectorProps {
  activeMood: MoodState;
  onMoodChange: (mood: MoodState) => void;
}

export default function MoodSelector({
  activeMood,
  onMoodChange,
}: MoodSelectorProps) {
  const moods = Object.entries(MOODS) as [
    MoodState,
    (typeof MOODS)[MoodState],
  ][];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs tracking-widest text-fog/40">CURRENT MOOD</p>
      <div className="flex gap-2">
        {moods.map(([key, mood]) => {
          const isActive = key === activeMood;
          return (
            <motion.button
              key={key}
              onClick={() => onMoodChange(key)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.25 }}
              style={
                isActive
                  ? { boxShadow: `0 0 16px 2px ${mood.accentColor}55` }
                  : {}
              }
              className={[
                'flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 px-2',
                'text-center transition-all duration-500 focus:outline-none',
                isActive
                  ? 'border-white/20 bg-white/10 text-fog'
                  : 'border-white/5 bg-white/[0.02] text-fog/50 hover:bg-white/5',
              ].join(' ')}
            >
              <span className="text-xl">{mood.emoji}</span>
              <span className="text-[10px] tracking-wider">{mood.label}</span>
            </motion.button>
          );
        })}
      </div>
      <motion.p
        key={activeMood}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-xs text-fog/40 italic"
      >
        {MOODS[activeMood].description}
      </motion.p>
    </div>
  );
}
