// Mock data types and state for Quantchill frontend

export type MoodState = 'deep-focus' | 'relaxation' | 'sleep';

export interface Track {
  id: string;
  title: string;
  description: string;
  duration: number; // seconds
  waveColor: string;
  genre: string;
}

export interface ChillRoomFriend {
  id: string;
  name: string;
  avatar: string; // emoji avatar
  mood: MoodState;
  frequency: string;
}

export interface RareConnectionMock {
  id: string;
  name: string;
  compatibilityPercent: number;
  context: string;
}

export const MOODS: Record<
  MoodState,
  { label: string; emoji: string; description: string; accentColor: string; bgGradient: string }
> = {
  'deep-focus': {
    label: 'Deep Focus',
    emoji: '🧠',
    description: 'Sharp, clean neural frequencies to cut through noise',
    accentColor: '#9b6dff',
    bgGradient: 'from-aurora/20 to-midnight',
  },
  relaxation: {
    label: 'Relaxation',
    emoji: '🌊',
    description: 'Soft ocean harmonics and ambient warmth',
    accentColor: '#14cccc',
    bgGradient: 'from-teal/15 to-midnight',
  },
  sleep: {
    label: 'Sleep',
    emoji: '🌙',
    description: 'Delta-wave drifts into effortless rest',
    accentColor: '#4a6fa5',
    bgGradient: 'from-blue-900/20 to-midnight',
  },
};

export const TRACKS: Record<MoodState, Track[]> = {
  'deep-focus': [
    {
      id: 'df-1',
      title: 'Neural Clarity',
      description: '40 Hz gamma entrainment • binaural',
      duration: 3600,
      waveColor: '#9b6dff',
      genre: 'Binaural Focus',
    },
    {
      id: 'df-2',
      title: 'Synaptic Rain',
      description: 'White noise layered with alpha waves',
      duration: 2700,
      waveColor: '#7c5fbf',
      genre: 'Neural Ambient',
    },
  ],
  relaxation: [
    {
      id: 'rx-1',
      title: 'Tide Memory',
      description: 'Pacific shore · 432 Hz tuning',
      duration: 3600,
      waveColor: '#14cccc',
      genre: 'Nature Soundscape',
    },
    {
      id: 'rx-2',
      title: 'Vapor Forest',
      description: 'Gentle rain on ancient cedar',
      duration: 2400,
      waveColor: '#0e9999',
      genre: 'Nature Soundscape',
    },
  ],
  sleep: [
    {
      id: 'sl-1',
      title: 'Delta Cascade',
      description: '0.5–4 Hz deep sleep induction',
      duration: 28800,
      waveColor: '#4a6fa5',
      genre: 'Sleep Science',
    },
    {
      id: 'sl-2',
      title: 'Moonfield',
      description: 'Isochronic lunar resonance',
      duration: 21600,
      waveColor: '#365f8a',
      genre: 'Sleep Science',
    },
  ],
};

export const MOCK_FRIENDS: ChillRoomFriend[] = [
  { id: 'u1', name: 'Arya', avatar: '🦋', mood: 'deep-focus', frequency: 'Alpha 10 Hz' },
  { id: 'u2', name: 'Zara', avatar: '🌿', mood: 'relaxation', frequency: 'Theta 6 Hz' },
  { id: 'u3', name: 'Kai', avatar: '🌊', mood: 'sleep', frequency: 'Delta 2 Hz' },
  { id: 'u4', name: 'Nova', avatar: '🔮', mood: 'deep-focus', frequency: 'Beta 18 Hz' },
];

export const RARE_CONNECTION_MOCK: RareConnectionMock = {
  id: 'rare-nebula-17',
  name: 'Mina · Lisbon',
  compatibilityPercent: 94,
  context: 'Outside your usual radius, high latent resonance in music + travel.'
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
