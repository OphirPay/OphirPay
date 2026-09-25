import { useEffect, useRef } from 'react';
import { Modal, ModalProps } from './Modal';
import { Kbd } from './ui/Kbd';

interface ShortcutGroup {
  context: string;
  shortcuts: { key: string; description: string }[];
}

interface ShortcutCheatSheetProps {
  shortcuts: Record<string, { handler: () => void; context?: string }>;
}

export const ShortcutCheatSheet = ({ shortcuts }: ShortcutCheatSheetProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Group shortcuts by context
  const groupedShortcuts: ShortcutGroup[] = Object.entries(shortcuts).reduce((acc, [key, { context = 'Global', description }]) => {
    const existingGroup = acc.find(g => g.context === context);
    if (existingGroup) {
      existingGroup.shortcuts.push({ key, description });
    } else {
      acc.push({ context, shortcuts: [{ key, description }] });
    }
    return acc;
  }, [] as ShortcutGroup[]);

  return (
    <Modal
      title="Keyboard Shortcuts"
      onClose={() => {}}
      ref={modalRef}
      aria-label="Keyboard shortcut cheat sheet"
    >
      <div className="p-4 max-h-[80vh] overflow-y-auto">
        {groupedShortcuts.map((group) => (
          <div key={group.context} className="mb-6">
            <h3 className="font-semibold mb-2 text-sm">{group.context}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.key} className="flex items-center">
                  <Kbd>{shortcut.key}</Kbd>
                  <span className="ml-2 text-sm">{shortcut.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};
