// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Textarea, Select } from '@/components/ui/Form';
import { SendIcon, WalletIcon, CheckIcon } from '@/components/ui/Icon';

// ═══════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════
describe('Pagination', () => {
  it('returns null for single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} hasNext={false} hasPrev={false} onNext={vi.fn()} onPrev={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders prev/next buttons for multi-page', () => {
    render(
      <Pagination page={2} totalPages={5} hasNext={true} hasPrev={true} onNext={vi.fn()} onPrev={vi.fn()} />
    );
    expect(screen.getByText('← Previous')).toBeDefined();
    expect(screen.getByText('Next →')).toBeDefined();
  });

  it('disables prev on first page', () => {
    render(
      <Pagination page={1} totalPages={5} hasNext={true} hasPrev={false} onNext={vi.fn()} onPrev={vi.fn()} />
    );
    expect(screen.getByText('← Previous').closest('button')).toBeDisabled();
  });

  it('disables next on last page', () => {
    render(
      <Pagination page={5} totalPages={5} hasNext={false} hasPrev={true} onNext={vi.fn()} onPrev={vi.fn()} />
    );
    expect(screen.getByText('Next →').closest('button')).toBeDisabled();
  });

  it('calls onNext and onPrev', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <Pagination page={3} totalPages={5} hasNext={true} hasPrev={true} onNext={onNext} onPrev={onPrev} />
    );
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('← Previous'));
    expect(onNext).toHaveBeenCalled();
    expect(onPrev).toHaveBeenCalled();
  });

  it('calls onPage when page number clicked', () => {
    const onPage = vi.fn();
    render(
      <Pagination page={3} totalPages={5} hasNext={true} hasPrev={true} onNext={vi.fn()} onPrev={vi.fn()} onPage={onPage} />
    );
    const page1 = screen.getByText('1');
    fireEvent.click(page1);
    expect(onPage).toHaveBeenCalledWith(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// ConfirmDialog
// ═══════════════════════════════════════════════════════════════
describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} title="T" description="D" />
    );
    expect(screen.queryByText('T')).toBeNull();
  });

  it('renders title and description when open', () => {
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} title="Delete?" description="This cannot be undone" />
    );
    expect(screen.getByText('Delete?')).toBeDefined();
    expect(screen.getByText('This cannot be undone')).toBeDefined();
  });

  it('calls onConfirm and onClose on confirm button click', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog open={true} onClose={onClose} onConfirm={onConfirm} title="T" description="D" confirmLabel="Yes" />
    );
    fireEvent.click(screen.getByText('Yes'));
    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders custom labels', () => {
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} title="T" description="D"
        confirmLabel="Delete" cancelLabel="Keep" />
    );
    expect(screen.getByText('Delete')).toBeDefined();
    expect(screen.getByText('Keep')).toBeDefined();
  });

  it('defaults to danger variant', () => {
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} title="T" description="D" />
    );
    const button = screen.getByText('Confirm').closest('button');
    expect(button?.className).toContain('red');
  });
});

// ═══════════════════════════════════════════════════════════════
// Form components
// ═══════════════════════════════════════════════════════════════
describe('Form - Input', () => {
  it('renders an input with label', () => {
    render(<Input label="Email" placeholder="you@example.com" />);
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
  });

  it('shows error message', () => {
    render(<Input label="Email" error="Invalid email" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email');
  });

  it('shows hint', () => {
    render(<Input label="Email" hint="We will not share your email" />);
    expect(screen.getByText('We will not share your email')).toBeDefined();
  });

  it('shows required indicator', () => {
    render(<Input label="Email" required />);
    const label = screen.getByText('Email');
    expect(label.parentElement?.innerHTML).toContain('*');
  });

  it('sets aria-invalid when error is present', () => {
    render(<Input label="Email" error="Bad" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Form - Textarea', () => {
  it('renders a textarea with label', () => {
    render(<Textarea label="Notes" placeholder="Enter notes..." />);
    expect(screen.getByLabelText('Notes')).toBeDefined();
  });

  it('shows error', () => {
    render(<Textarea label="Notes" error="Too long" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});

describe('Form - Select', () => {
  const options = [
    { value: 'xlm', label: 'XLM' },
    { value: 'usdc', label: 'USDC' },
  ];

  it('renders a select with options', () => {
    render(<Select label="Asset" options={options} />);
    expect(screen.getByLabelText('Asset')).toBeDefined();
    expect(screen.getByText('XLM')).toBeDefined();
    expect(screen.getByText('USDC')).toBeDefined();
  });

  it('shows placeholder option', () => {
    render(<Select label="Asset" options={options} placeholder="Choose..." />);
    expect(screen.getByText('Choose...')).toBeDefined();
  });

  it('shows error', () => {
    render(<Select label="Asset" options={options} error="Required" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Icons
// ═══════════════════════════════════════════════════════════════
describe('Icons', () => {
  it('renders SendIcon as SVG', () => {
    const { container } = render(<SendIcon />);
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('renders WalletIcon as SVG', () => {
    const { container } = render(<WalletIcon />);
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('renders CheckIcon as SVG', () => {
    const { container } = render(<CheckIcon />);
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('accepts className', () => {
    const { container } = render(<SendIcon className="custom-icon" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('custom-icon');
  });
});
