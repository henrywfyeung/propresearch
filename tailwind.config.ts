import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/report/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Palette per CLAUDE.md §13.4 / §15.3.
        bg: { DEFAULT: '#FAFAFA', card: '#FFFFFF' },
        ink: { DEFAULT: '#0A0A0A', muted: '#555555' },
        accent: { DEFAULT: '#1F3864' }, // PDF + UI accent
        danger: { DEFAULT: '#C9302C' },
      },
      fontFamily: {
        // Wired in once the woff2 files are self-hosted under public/fonts/.
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"General Sans"', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
