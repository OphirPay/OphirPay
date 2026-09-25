import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  ariaLabel?: string;
}

export const Modal = ({ title, children, onClose, ariaLabel }: ModalProps) => {
  const [isOpen, setIsOpen] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusableElRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusableElRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const focusableElements = modalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements?.length) {
      firstFocusableElRef.current = focusableElements[0] as HTMLButtonElement;
      lastFocusableElRef.current = focusableElements[focusableElements.length - 1] as HTMLButtonElement;
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const firstEl = firstFocusableElRef.current;
      firstEl?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            const focusableElements = modalRef.current?.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (e.shiftKey && !e.target) {
              lastFocusableElRef.current?.focus();
              e.preventDefault();
            } else if (!e.shiftKey && focusableElements?.length && e.target === lastFocusableElRef.current) {
              firstFocusableElRef.current?.focus();
              e.preventDefault();
            }
          }
        }}
        tabIndex={-1}
        aria-modal="true"
        aria-label={ariaLabel || title}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};
