import React, { ReactNode, useEffect, useRef } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useLocation } from 'react-router-dom';

interface AppShellProps {
  children: ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const location = useLocation();
  const skipLinkRef = useRef<HTMLAnchorElement>(null);
  const mainRef = useRef<HTMLMainElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !skipLinkRef.current?.hasAttribute('tabindex')) {
        skipLinkRef.current?.setAttribute('tabindex', '0');
      }
    };

    const handleBlur = () => {
      skipLinkRef.current?.removeAttribute('tabindex');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur, true);
    };
  }, []);

  const handleSkipLinkClick = () => {
    mainRef.current?.focus();
  };

  return (
    <>
      <a
        ref={skipLinkRef}
        href="#main-content"
        className="skip-link visually-hidden focusable"
        onClick={handleSkipLinkClick}
      >
        Skip to main content
      </a>

      <Header />
      <Sidebar />

      <main id="main-content" ref={mainRef} className="main-landmark">
        {children}
      </main>
    </>
  );
};
