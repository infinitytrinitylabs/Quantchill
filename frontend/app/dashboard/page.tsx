'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import type { MoodState } from '@/lib/mockData';
import { MOODS, TRACKS, MOCK_FRIENDS, RARE_CONNECTION_MOCK } from '@/lib/mockData';
import MoodSelector from '@/components/MoodSelector';
import AudioPlayer from '@/components/AudioPlayer';
import ChillRoomLobby from '@/components/ChillRoomLobby';
import SerendipityUI from '@/components/SerendipityUI';

// Dynamic import for canvas-based visualizer (client-only)
const AudioVisualizer = dynamic(
  () => import('@/components/AudioVisualizer'),
  { ssr: false }
);

export default function DashboardPage() {
  const [mood, setMood] = useState<MoodState>('relaxation');
  const [isPlaying, setIsPlaying] = useState(false);

  const currentMood = MOODS[mood];
  const tracks = TRACKS[mood];

  const handleMoodChange = (next: MoodState) => {
    setMood(next);
    setIsPlaying(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-midnight">
      {/* Full-screen visualizer background */}
      <AudioVisualizer isPlaying={isPlaying} accentColor={currentMood.accentColor} />

      {/* Gradient overlay to keep content readable */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-midnight/60 via-transparent to-midnight/80" />

      {/* Scrollable content layer */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Top nav */}
        <TopNav />

        {/* Main content */}
        <main className="flex flex-1 flex-col items-center gap-8 px-4 py-10 sm:px-8 md:px-12 lg:flex-row lg:items-start lg:justify-center lg:gap-10">
          {/* Left column – soundscape */}
          <motion.section
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9 }}
            className="flex w-full max-w-md flex-col gap-6"
          >
            {/* Mood header */}
            <AnimatePresence mode="wait">
              <motion.div
                key={mood}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.7 }}
                className="flex flex-col gap-1"
              >
                <h1 className="text-4xl font-extralight tracking-widest text-fog">
                  {currentMood.emoji}
                </h1>
                <h2
                  className="text-xl font-light tracking-wider"
                  style={{
                    color: currentMood.accentColor,
                    textShadow: `0 0 18px ${currentMood.accentColor}88`,
                  }}
                >
                  {currentMood.label}
                </h2>
                <p className="text-sm text-fog/50">{currentMood.description}</p>
              </motion.div>
            </AnimatePresence>

            {/* Mood selector */}
            <MoodSelector activeMood={mood} onMoodChange={handleMoodChange} />

            {/* Divider */}
            <div className="h-px w-full bg-white/5" />

            {/* Audio player */}
            <div className="flex flex-col gap-3">
              <p className="text-xs tracking-widest text-fog/40">
                SOUNDSCAPE QUEUE
              </p>
              <AudioPlayer
                tracks={tracks}
                isPlaying={isPlaying}
                onPlayStateChange={setIsPlaying}
              />
            </div>
          </motion.section>

          {/* Right column – chill rooms */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="flex w-full max-w-sm flex-col gap-6"
          >
            <ChillRoomLobby friends={MOCK_FRIENDS} />
            <SerendipityUI connection={RARE_CONNECTION_MOCK} />

            {/* Ecosystem sync badge */}
            <EcosystemBadge />
          </motion.section>
        </main>
      </div>
    </div>
  );
}

/* ─── Top Nav ──────────────────────────────────────────────────────────────── */
function TopNav() {
  return (
    <nav className="flex items-center justify-between border-b border-white/5 px-6 py-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-breathe rounded-full bg-aurora" />
        <span className="text-sm font-light tracking-widest text-fog/70">
          QUANTCHILL
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-fog/30 sm:block">
          Quant Ecosystem
        </span>
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm">
          🌙
        </div>
      </div>
    </nav>
  );
}

/* ─── Ecosystem Badge ─────────────────────────────────────────────────────── */
function EcosystemBadge() {
  const apps = [
    { emoji: '✉️', label: 'Quantmail' },
    { emoji: '💬', label: 'Quantchat' },
    { emoji: '🎬', label: 'Quanttube' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8 }}
      className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4"
    >
      <p className="text-xs tracking-widest text-fog/30">QUANT ECOSYSTEM</p>
      <div className="flex gap-2">
        {apps.map((app) => (
          <button
            key={app.label}
            title={app.label}
            className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-white/5 py-2 text-center transition-all duration-300 hover:bg-white/5 focus:outline-none"
          >
            <span className="text-lg">{app.emoji}</span>
            <span className="text-[9px] tracking-wider text-fog/30">
              {app.label}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
