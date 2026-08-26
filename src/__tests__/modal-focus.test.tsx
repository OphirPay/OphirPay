// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { Modal } from '@/components/ui/Modal';

// jsdom has no rAF scheduling tied to paint, so drive it directly and keep the
// initial-focus assertions deterministic.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  return render(
    <Modal open onClose={vi.fn()} title="Confirm" {...props}>
      <button type="button">first</button>
      <button type="button">second</button>
    </Modal>
  );
}

describe('Modal focus management', () => {
  it('moves initial focus to the first interactive element', () => {
    open();
    // The close button is the first control in DOM order.
    expect(document.activeElement).toBe(screen.getByLabelText('Close dialog'));
  });

  it('falls back to the dialog when there is nothing to focus', () => {
    const { container } = render(
      <Modal open onClose={vi.fn()}>
        <p>nothing interactive here</p>
      </Modal>
    );
    const dialog = container.ownerDocument.querySelector<HTMLElement>('[aria-modal="true"] [tabindex="-1"]');
    expect(document.activeElement).toBe(dialog);
  });

  it('wraps Tab from the last control back to the first', () => {
    open();
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-modal="true"] button')
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    open();
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-modal="true"] button')
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back when it has escaped the dialog', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    open();

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    const first = document.querySelector<HTMLElement>('[aria-modal="true"] button');
    expect(document.activeElement).toBe(first);
    outside.remove();
  });

  it('restores focus to the control that opened it', () => {
    function Harness() {
      const [isOpen, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            trigger
          </button>
          <Modal open={isOpen} onClose={() => setOpen(false)} title="Confirm">
            <button type="button">inside</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus back when the parent re-renders', () => {
    // A parent passing an inline arrow gives `onClose` a new identity on every
    // render. While the focus effect depended on it, every unrelated parent state
    // change tore the effect down and set it up again - and the teardown calls
    // `previouslyFocused.focus()`. Focus was therefore yanked out of whatever the
    // user was typing in and thrown back at the trigger, on every re-render.
    function Harness() {
      const [isOpen, setOpen] = useState(false);
      const [count, force] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            trigger
          </button>
          <button type="button" onClick={() => force((n) => n + 1)}>
            rerender {count}
          </button>
          <Modal open={isOpen} onClose={() => setOpen(false)} title="Confirm">
            <input aria-label="amount" />
          </Modal>
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText('trigger'));

    const input = screen.getByLabelText('amount');
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => {
      fireEvent.click(screen.getByText(/rerender/));
    });

    expect(document.activeElement).toBe(input);
  });

  it('restores focus to the trigger after an unrelated re-render', () => {
    function Harness() {
      const [isOpen, setOpen] = useState(false);
      const [count, force] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            trigger
          </button>
          <button type="button" onClick={() => force((n) => n + 1)}>
            rerender {count}
          </button>
          <Modal open={isOpen} onClose={() => setOpen(false)} title="Confirm">
            <button type="button">inside</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);

    act(() => {
      fireEvent.click(screen.getByText(/rerender/));
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape using the current handler', () => {
    const onClose = vi.fn();
    const { rerender } = open({ onClose });

    const replacement = vi.fn();
    rerender(
      <Modal open onClose={replacement} title="Confirm">
        <button type="button">first</button>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps focus on the dialog when Tab is pressed with nothing focusable', () => {
    const { container } = render(
      <Modal open onClose={vi.fn()}>
        <p>nothing interactive here</p>
      </Modal>
    );
    const dialog = container.ownerDocument.querySelector<HTMLElement>('[aria-modal="true"] [tabindex="-1"]');

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });
});
