import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PropResearch',
  description: 'AI-assisted property due-diligence for buyer’s agents',
  robots: { index: false, follow: false }, // internal tool
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
