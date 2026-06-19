/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#2f4256',       // Azul pizarra profundo — SIDEBAR
          primaryDark: '#26384a',   // azul más oscuro (bordes/hover sidebar)
          secondary: '#9c7a55',     // Bronce (acento, legible sobre claro y sobre azul)
          accent: '#b88a5e',        // Cobre/dorado cálido (acento sobre azul)
          dark: '#0b0f1a',          // (legacy) fondo oscuro
          card: '#111827',          // (legacy) card oscuro
          textLight: '#f4f1ea',     // texto claro (sobre azul)
          textMuted: '#a9b6c4',     // gris-azulado claro (texto secundario sobre azul)

          // Contenido — tema MARFIL con jerarquía de superficies:
          ivory: '#ebe5d9',         // fondo app (marfil cálido, MÁS profundo → las cards elevan)
          surface: '#ffffff',       // cards (blanco, contrastan sobre ivory)
          panel: '#f4efe5',         // inset/panel sutil (entre ivory y blanco)
          ink: '#283039',           // texto principal (≈10:1 sobre marfil)
          inkmuted: '#5a6573',      // texto secundario (≈5.5:1)
          hairline: '#ddd4c4',      // borde cálido (visible sobre marfil/blanco)
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(40,48,57,0.04), 0 6px 16px -8px rgba(40,48,57,0.10)',
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
