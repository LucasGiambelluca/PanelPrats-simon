/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#304352',       // Deep Blue-Grey
          secondary: '#9c7a55',     // Bronce (oscurecido para contraste sobre marfil)
          accent: '#a57b5a',        // Warm copper/gold
          dark: '#0b0f1a',          // (legacy) fondo oscuro
          card: '#111827',          // (legacy) card oscuro
          textLight: '#f6f4f1',     // (legacy) texto claro
          textMuted: '#94a3b8',     // (legacy) gris

          // Tema MARFIL (claro) — contraste cuidado:
          ivory: '#f5f2ec',         // fondo app (marfil cálido)
          surface: '#ffffff',       // cards / sidebar
          panel: '#fbfaf6',         // panel sutil (marfil más claro)
          ink: '#27303a',           // texto principal (≈11:1 sobre ivory)
          inkmuted: '#5b6470',      // texto secundario (≈6:1)
          hairline: '#e7e2d6',      // borde cálido
        }
      },
      fontFamily: {
        sans: ['Raleway', 'Poppins', 'Inter', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'Cambria', 'serif'],
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
