import { useEffect, useState } from 'react';

// Single source of truth for the phone breakpoint. Kept in sync with the
// `@media (max-width: 768px)` rules in index.css.
export const MOBILE_BREAKPOINT = 768;

/**
 * Reactive phone-size check. Updates on viewport resize / orientation change
 * (and responsive device previews) so layouts never get stuck at the size the
 * component happened to mount at.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isMobile;
}
