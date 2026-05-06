/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Aptos', 'Segoe UI Variable', 'Trebuchet MS', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        shell: '#081018',
        ink: '#e6f7ff',
      },
      boxShadow: {
        hero: '0 16px 38px rgba(14, 74, 108, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
        panel: '0 12px 28px rgba(14, 74, 108, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
      },
      keyframes: {
        raiseIn: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        raiseIn: 'raiseIn 700ms ease-out',
      },
    },
  },
  plugins: [],
}

