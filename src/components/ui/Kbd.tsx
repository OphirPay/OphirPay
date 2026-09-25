import React from 'react';

interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

export const Kbd = ({ children, className }: KbdProps) => {
  return (
    <kbd
      className={`px-2 py-1 rounded bg-gray-100 text-gray-800 font-mono text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 ${className || ''}`}
      aria-label={`keyboard key: ${children}`}
    >
      {children}
    </kbd>
  );
};
