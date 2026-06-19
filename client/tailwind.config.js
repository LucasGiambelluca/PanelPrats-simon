/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Paleta OFICIAL de marca (Prats&Simon.ase): navy + dorado + blanco hueso.
          primary: '#1a2949',       // Navy MARCA — SIDEBAR / headings / botones / links
          primaryDark: '#111e30',   // Navy profundo (gradiente/bordes sidebar)
          secondary: '#24365a',     // Navy interactivo legible (acento texto/íconos s/ claro)
          accent: '#101820',        // Navy casi-negro (hover/pressed)
          gold: '#cca378',          // DORADO de marca — acento sobre navy, divisores, badges
          goldDark: '#b5895c',      // Dorado oscuro (texto dorado sobre claro, grande/bold)
          dark: '#0b0f1a',          // (legacy)
          card: '#111827',          // (legacy)
          textLight: '#f4f3ef',     // texto claro (sobre navy)
          textMuted: '#9aa6bd',     // azul-gris claro (secundario sobre navy)

          // Contenido — blanco hueso cálido con jerarquía de superficies:
          ivory: '#f4f3ef',         // fondo app (blanco hueso, marca #f7f7f7 cálido)
          surface: '#ffffff',       // cards (blanco, elevadas)
          panel: '#faf9f6',         // inset/panel sutil
          ink: '#101820',           // texto principal (navy casi-negro, ≈16:1)
          inkmuted: '#57534e',      // texto secundario (gris cálido, ≈7:1)
          hairline: '#e4e1da',      // borde cálido sutil
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,32,0.05), 0 8px 24px -12px rgba(16,24,32,0.14)',
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
