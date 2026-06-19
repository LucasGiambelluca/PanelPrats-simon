/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // SaaS corporativo: navy sidebar + azul royal de acento + gris frío + blanco.
          primary: '#243150',       // Navy — SIDEBAR
          primaryDark: '#1b2640',   // Navy más oscuro (gradiente/bordes sidebar)
          secondary: '#3b6fe0',     // Azul royal — ACENTO PRIMARIO (botones, activo, links)
          accent: '#2f5fd0',        // Azul más oscuro (hover/pressed)
          dark: '#0b0f1a',          // (legacy)
          card: '#111827',          // (legacy)
          textLight: '#eef2f8',     // texto claro (sobre navy)
          textMuted: '#9fb0c9',     // azul-gris claro (texto secundario sobre navy)

          // Contenido — gris frío con jerarquía de superficies:
          ivory: '#eef1f6',         // fondo app (gris-azulado frío, como la referencia)
          surface: '#ffffff',       // cards (blanco, elevadas)
          panel: '#f5f7fb',         // inset/panel sutil (gris muy claro)
          ink: '#1f2a40',           // texto principal (slate navy, ≈12:1)
          inkmuted: '#64748b',      // texto secundario (slate-500, ≈4.8:1)
          hairline: '#e4e8f0',      // borde frío sutil
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(30,41,59,0.04), 0 8px 24px -12px rgba(30,41,59,0.12)',
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
