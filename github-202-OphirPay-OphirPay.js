// src/hooks/useReducedMotion.js
import { useEffect, useState } from 'react';

export const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    
    const handleChange = () => {
      setReducedMotion(mediaQuery.matches);
    };

    // Set initial value
    handleChange();

    // Listen for changes
    mediaQuery.addEventListener('change', handleChange);
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return reducedMotion;
};

// src/components/AnimatedComponent.js
import React from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

const AnimatedComponent = ({ children, animateOnMount = true, animationDuration = '0.3s' }) => {
  const hasReducedMotion = useReducedMotion();
  
  const animationStyle = {
    transition: hasReducedMotion ? 'none' : `opacity ${animationDuration} ease-in-out`,
    opacity: animateOnMount && !hasReducedMotion ? 1 : 0,
    animation: hasReducedMotion ? 'none' : 'fadeIn 0.3s ease-in-out'
  };

  return (
    <div style={animationStyle}>
      {children}
    </div>
  );
};

// src/App.css
/* Add to global CSS */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Alternative approach using class (if media query override isn't sufficient) */
.reduced-motion * {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}

// src/index.js or App.js - Add class to document root
import { useEffect } from 'react';

useEffect(() => {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  
  if (mediaQuery.matches) {
    document.documentElement.classList.add('reduced-motion');
  }
  
  const handler = (e) => {
    if (e.matches) {
      document.documentElement.classList.add('reduced-motion');
    } else {
      document.documentElement.classList.remove('reduced-motion');
    }
  };
  
  mediaQuery.addEventListener('change', handler);
  return () => mediaQuery.removeEventListener('change', handler);
}, []);

// src/components/Spinner.js - Example animated component
import React from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

const Spinner = ({ size = 24, color = 'currentColor' }) => {
  const hasReducedMotion = useReducedMotion();
  
  return (
    <div 
      className="spinner"
      style={{
        width: size,
        height: size,
        border: `${size / 8}px solid ${color}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: hasReducedMotion ? 'none' : 'spin 1s linear infinite',
        display: 'inline-block'
      }}
    />
  );
};

// src/components/Modal.js - Example with animation
import React, { useEffect } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

const Modal = ({ isOpen, onClose, children }) => {
  const hasReducedMotion = useReducedMotion();
  
  useEffect(() => {
    if (!isOpen) return;
    
    if (!hasReducedMotion) {
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, hasReducedMotion]);

  if (!isOpen) return null;

  return (
    <div 
      className={`modal-overlay ${hasReducedMotion ? 'no-animation' : ''}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: hasReducedMotion ? 1 : 0,
        transition: hasReducedMotion ? 'none' : 'opacity 0.3s ease-in-out',
        visibility: hasReducedMotion ? 'visible' : 'hidden',
        zIndex: 1000
      }}
    >
      <div 
        className={`modal-content ${hasReducedMotion ? 'no-animation' : ''}`}
        style={{
          transform: hasReducedMotion ? 'none' : 'scale(0.9)',
          opacity: hasReducedMotion ? 1 : 0,
          transition: hasReducedMotion ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};