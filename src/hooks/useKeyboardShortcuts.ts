import { useEffect } from 'react';
import { useModal } from '@/components/Modal';
import { ShortcutCheatSheet } from '@/components/ShortcutCheatSheet';

export const useKeyboardShortcuts = (shortcuts: Record<string, { handler: () => void; context?: string }>) => {
  const { openModal } = useModal();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault();
        openModal(<ShortcutCheatSheet shortcuts={shortcuts} />);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, openModal]);
};
