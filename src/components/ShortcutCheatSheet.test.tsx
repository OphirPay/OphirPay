import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutCheatSheet } from './ShortcutCheatSheet';

describe('ShortcutCheatSheet', () => {
  const mockShortcuts = {
    'Escape': { handler: () => {}, description: 'Close dialog' },
    'Cmd+S': { handler: () => {}, context: 'Global', description: 'Save' },
    'ArrowDown': { handler: () => {}, context: 'Tables', description: 'Select next row' },
  };

  it('renders all registered shortcuts grouped by context', () => {
    render(<ShortcutCheatSheet shortcuts={mockShortcuts} />);

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.getByText('Close dialog')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Select next row')).toBeInTheDocument();
  });

  it('displays Kbd components for keys', () => {
    render(<ShortcutCheatSheet shortcuts={mockShortcuts} />);
    expect(screen.getByText('Escape')).toBeInTheDocument();
    expect(screen.getByText('Cmd+S')).toBeInTheDocument();
    expect(screen.getByText('ArrowDown')).toBeInTheDocument();
  });
});
