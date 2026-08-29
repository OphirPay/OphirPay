# Accessibility & Reduced Motion Guide

OphirPay complies with accessibility standards, specifically WCAG 2.1 Success Criterion 2.3.3 (Animation from Interactions), ensuring all non-essential animations and transitions respect the user's `prefers-reduced-motion` operating system preference.

---

## 1. Global CSS Overrides

In [`src/app/globals.css`](../src/app/globals.css), global media queries are applied automatically whenever `(prefers-reduced-motion: reduce)` matches:

```css
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .animate-fade-in,
  .animate-fade-in-up,
  .animate-pulse,
  .animate-ping,
  .animate-spin {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }

  .animate-shimmer {
    animation: none !important;
    background: #f3f4f6 !important;
  }

  .dark .animate-shimmer {
    background: #1f2937 !important;
  }
}
```

---

## 2. React Hook: `usePrefersReducedMotion`

The [`usePrefersReducedMotion`](../src/lib/reduced-motion.ts) hook provides reactive detection of the user's motion preference:

```tsx
import { usePrefersReducedMotion } from "@/lib/reduced-motion";

export function CustomChart() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div
      style={{
        transition: prefersReducedMotion ? "none" : "transform 300ms ease-out",
        transform: prefersReducedMotion ? "none" : "translateY(0)",
      }}
    >
      {/* Chart Content */}
    </div>
  );
}
```

### Utility Functions

- **`isReducedMotion()`**: Client/SSR-safe check for current reduced motion preference.
- **`getMotionSafeDuration(duration: number, prefersReduced?: boolean)`**: Returns `0` if reduced motion is requested, or the target duration in ms.
- **`waitForAnimation(element: HTMLElement, options?: { prefersReduced?: boolean })`**: Promise helper that resolves immediately when reduced motion is preferred.

---

## 3. Tailwind `motion-reduce:*` Utilities

Tailwind CSS utility variants are applied to all animated components across the application:

- **Spinners**: `animate-spin motion-reduce:animate-none`
- **Skeletons**: `animate-pulse motion-reduce:animate-none`
- **Status Indicators / Pings**: `animate-ping motion-reduce:animate-none`
- **Progress Bars**: `transition-all duration-500 ease-out motion-reduce:transition-none`
- **Buttons / Interactive Elements**: `transition-all duration-300 motion-reduce:transition-none motion-reduce:transform-none`
- **Modals / Toasts / Tooltips**: `animate-fade-in motion-reduce:animate-none`

---

## 4. Deterministic Testing

Compliance is verified by the Vitest test suite in [`src/__tests__/reduced-motion.test.tsx`](../src/__tests__/reduced-motion.test.tsx), covering:
1. Hook reactivity & cleanup on media query changes
2. Component class rendering with `motion-reduce:*`
3. CSS media query definitions in `globals.css`
4. Zero-transform and zero-timing assertions across tickers, charts, and transitions under reduced motion.
