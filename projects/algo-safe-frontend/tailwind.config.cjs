/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#eef2ff',100:'#e0e7ff',500:'#6366f1',600:'#4f46e5',700:'#4338ca' },
        ink: { 900:'#0f172a',700:'#334155',500:'#64748b',400:'#94a3b8' },
        surface: { DEFAULT:'#ffffff', muted:'#f8fafc', border:'#e2e8f0' },
        ok:'#16a34a', warn:'#d97706', danger:'#dc2626',
      },
      borderRadius: { xl:'0.75rem','2xl':'1rem' },
      fontFamily: { sans: ['Inter','ui-sans-serif','system-ui','sans-serif'] },
    },
  },
  daisyui: {
    themes: ['lofi'],
    logs: false,
  },
  plugins: [require('daisyui')],
}
