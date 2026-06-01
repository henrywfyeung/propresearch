import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Property research',
  description: 'Personal property research',
  robots: { index: false, follow: false }, // private, personal tool
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
