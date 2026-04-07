import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quantchill — Immersive Relaxation Hub',
  description: 'Your serene corner of the Quant Ecosystem. Mood-based soundscapes, immersive audio, and chill rooms.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full min-h-screen bg-midnight text-fog antialiased">
        {children}
      </body>
    </html>
  );
}
