/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        darkbg: "#070913",
        panelbg: "rgba(15, 18, 36, 0.4)",
        cardbg: "rgba(22, 28, 54, 0.6)",
      },
    },
  },
  plugins: [],
}
