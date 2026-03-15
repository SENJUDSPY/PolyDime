@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Jost:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&display=swap');
@import "tailwindcss";

@theme {
  --color-primary: #710014;   /* Crimson Depth */
  --color-surface: #B38F6F;   /* Warm Sand */
  --color-background: #F2F1ED; /* Soft Pearl */
  --color-foreground: #161616; /* Obsidian Black */

  --font-serif: "Cormorant Garamond", serif;
  --font-sans: "Jost", sans-serif;

  --text-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
  --text-shadow-md: 0 2px 4px rgba(0, 0, 0, 0.1);
}

@layer base {
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-serif;
  }
}

@layer utilities {
  .text-shadow-sm {
    text-shadow: var(--text-shadow-sm);
  }
  .text-shadow-md {
    text-shadow: var(--text-shadow-md);
  }
}
