/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Estilo "Trust & Authority" (skill ui-ux-pro-max, legal/SaaS):
          // navy de autoridad + azul de acento + slate frío + blanco.
          primary: '#1e3a8a',       // Navy autoridad — SIDEBAR / headings
          primaryDark: '#172f6b',   // Navy más oscuro (gradiente/bordes sidebar)
          secondary: '#2563eb',     // Azul — ACENTO (activo, links, íconos, focus)
          accent: '#1d4ed8',        // Azul-700 (hover/pressed)
          dark: '#0b0f1a',          // (legacy)
          card: '#111827',          // (legacy)
          textLight: '#f8fafc',     // texto claro (sobre navy)
          textMuted: '#aebfdb',     // azul-gris claro (secundario sobre navy)

          // Contenido — slate frío con jerarquía de superficies:
          ivory: '#f8fafc',         // fondo app (slate-50, frío y claro)
          surface: '#ffffff',       // cards (blanco, elevadas)
          panel: '#f1f5fb',         // inset/panel sutil
          ink: '#0f172a',           // texto principal (slate-900, ≈16:1)
          inkmuted: '#475569',      // texto secundario (slate-600, ≈7:1)
          hairline: '#cbd5e1',      // borde (slate-300, visible)
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.12)',
      },
      fontFamily: {
        sans: ['Lato', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"EB Garamond"', 'Georgia', 'Cambria', 'serif'],
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
