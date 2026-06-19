/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Navy REAL de marca (extraído del logo Prats & Simon: #284050) + acento
          // petróleo armónico + slate frío. Estilo legal "Trust & Authority".
          primary: '#284050',       // Navy MARCA (logo) — SIDEBAR / headings
          primaryDark: '#1d2f3c',   // Navy más oscuro (gradiente/bordes sidebar)
          secondary: '#3f7ba3',     // Azul petróleo — ACENTO (activo, links, íconos)
          accent: '#335f7d',        // Petróleo más oscuro (hover/pressed)
          dark: '#0b0f1a',          // (legacy)
          card: '#111827',          // (legacy)
          textLight: '#f6f9fb',     // texto claro (sobre navy)
          textMuted: '#9db4c4',     // steel claro (secundario sobre navy)

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
