/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#304352',       // Deep Blue-Grey
          secondary: '#C6AC98',     // Light elegant bronze/gold
          accent: '#a57b5a',        // Warm copper/gold
          dark: '#0b0f1a',          // Main dark background
          card: '#111827',          // Card/sidebar dark background
          textLight: '#f6f4f1',     // Elegant light text
          textMuted: '#94a3b8',     // Muted gray text
        }
      },
      fontFamily: {
        sans: ['Raleway', 'Poppins', 'Inter', 'sans-serif'],
      },
      animation: {
        'shimmer': 'shimmer 2.5s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: 0.6, transform: 'scale(1)' },
          '50%': { opacity: 1, transform: 'scale(1.02)' },
        }
      }
    },
  },
  plugins: [],
};
