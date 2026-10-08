// tailwind.config.mjs

/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    primary: '#F9800B',
                    secondary: '#F4520B',
                    bg: '#FFF7E8',
                    text: '#1B1818',
                    accent: '#EAB86E',
                    shadow: '#442D27',
                },
            },
            fontFamily: {
                heading: ['Lilita One', 'system-ui', 'sans-serif'],
                subheading: ['Bevan', 'system-ui', 'sans-serif'],
                body: ['Nunito', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [],
};