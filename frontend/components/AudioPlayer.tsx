'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Track } from '@/lib/mockData';
import { formatDuration } from '@/lib/mockData';

interface AudioPlayerProps {
  tracks: Track[];
  isPlaying: boolean;
  onPlayStateChange: (playing: boolean) => void;
}

export default function AudioPlayer({
  tracks,
  isPlaying,
  onPlayStateChange,
}: AudioPlayerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const active = tracks[activeIndex];

  return (
    <div className="flex flex-col gap-4">
      {/* Track list */}
      <div className="flex flex-col gap-2">
        {tracks.map((track, i) => {
          const isActive = i === activeIndex;
          return (
            <motion.button
              key={track.id}
              onClick={() => {
                setActiveIndex(i);
                onPlayStateChange(true);
              }}
              whileHover={{ x: 4 }}
              transition={{ duration: 0.25 }}
              className={[
                'flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-500 focus:outline-none',
                isActive
                  ? 'border-white/10 bg-white/[0.06]'
                  : 'border-transparent bg-transparent hover:bg-white/[0.03]',
              ].join(' ')}
            >
              {/* Play indicator */}
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
                style={{
                  background: isActive
                    ? `${track.waveColor}33`
                    : 'transparent',
                  border: `1px solid ${track.waveColor}44`,
                }}
              >
                {isActive && isPlaying ? (
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    ▶
                  </motion.span>
                ) : (
                  '▷'
                )}
              </span>

              {/* Info */}
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="text-sm text-fog/90 truncate">
                  {track.title}
                </span>
                <span className="text-xs text-fog/40 truncate">
                  {track.description}
                </span>
              </div>

              <span className="shrink-0 text-xs text-fog/30">
                {formatDuration(track.duration)}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Now playing bar */}
      <AnimatePresence>
        {active && (
          <motion.div
            key={active.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3"
          >
            {/* Wave animation */}
            <div className="flex h-8 items-end gap-0.5 shrink-0">
              {Array.from({ length: 7 }).map((_, i) => (
                <motion.div
                  key={i}
                  animate={
                    isPlaying
                      ? {
                          height: ['40%', '100%', '60%', '80%', '40%'],
                          opacity: [0.5, 1, 0.7, 0.9, 0.5],
                        }
                      : { height: '30%', opacity: 0.3 }
                  }
                  transition={
                    isPlaying
                      ? {
                          duration: 0.8 + i * 0.1,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: i * 0.07,
                        }
                      : { duration: 0.5 }
                  }
                  style={{ background: active.waveColor }}
                  className="w-1 rounded-full"
                />
              ))}
            </div>

            {/* Track details */}
            <div className="flex flex-1 flex-col min-w-0">
              <span className="truncate text-xs font-medium text-fog/80">
                {active.title}
              </span>
              <span className="truncate text-[10px] text-fog/40">
                {active.genre}
              </span>
            </div>

            {/* Play/Pause button */}
            <motion.button
              onClick={() => onPlayStateChange(!isPlaying)}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.9 }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-base focus:outline-none"
            >
              {isPlaying ? '⏸' : '▶'}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
