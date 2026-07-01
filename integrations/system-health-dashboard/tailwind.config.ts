import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-2px)' },
          '75%': { transform: 'translateX(2px)' },
        },
        'completion-glow': {
          '0%': { filter: 'brightness(1) drop-shadow(0 0 0px transparent)' },
          '30%': { filter: 'brightness(1.3) drop-shadow(0 0 8px #22c55e)' },
          '100%': { filter: 'brightness(1) drop-shadow(0 0 0px transparent)' },
        },
        'step-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        wiggle: 'wiggle 0.3s ease-in-out 2',
        'completion-glow': 'completion-glow 0.8s ease-out',
        'step-pop': 'step-pop 0.4s ease-out',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Semantic status colors — theme-aware via CSS vars (src/index.css).
        // Usage: text-status-success / bg-status-success-subtle / border-status-success-line
        status: {
          success: { DEFAULT: 'var(--st-success-fg)', subtle: 'var(--st-success-bg)', line: 'var(--st-success-bd)' },
          warning: { DEFAULT: 'var(--st-warning-fg)', subtle: 'var(--st-warning-bg)', line: 'var(--st-warning-bd)' },
          error:   { DEFAULT: 'var(--st-error-fg)',   subtle: 'var(--st-error-bg)',   line: 'var(--st-error-bd)' },
          info:    { DEFAULT: 'var(--st-info-fg)',    subtle: 'var(--st-info-bg)',    line: 'var(--st-info-bd)' },
          neutral: { DEFAULT: 'var(--st-neutral-fg)', subtle: 'var(--st-neutral-bg)', line: 'var(--st-neutral-bd)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
