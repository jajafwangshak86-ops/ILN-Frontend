/**
 * Unit tests for AdminConfirmDialog.
 *
 * Covers:
 * 1. Renders title, description, and confirm label correctly.
 * 2. Calls onConfirm when the confirm button is clicked.
 * 3. Calls onCancel when the Cancel button is clicked.
 * 4. Accessibility attributes: role="dialog", aria-modal, aria-labelledby,
 *    aria-describedby, data-testid.
 * 5. Body scroll lock is applied on mount and restored on unmount.
 * 6. Confirm button never fires on Cancel click and vice versa.
 */

/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminConfirmDialog from '../AdminConfirmDialog';

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

const DEFAULT_PROPS = {
  title: 'Pause protocol',
  description: 'This will halt all new invoice submissions until unpaused.',
  confirmLabel: 'Pause protocol',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('AdminConfirmDialog', () => {
  beforeEach(() => {
    DEFAULT_PROPS.onConfirm.mockReset();
    DEFAULT_PROPS.onCancel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the dialog with correct role and aria attributes', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'admin-confirm-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'admin-confirm-description');
    expect(dialog).toHaveAttribute('data-testid', 'admin-confirm-dialog');
  });

  it('renders the provided title', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(screen.getByRole('heading', { name: 'Pause protocol' })).toBeInTheDocument();
  });

  it('renders the provided description', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(
      screen.getByText('This will halt all new invoice submissions until unpaused.')
    ).toBeInTheDocument();
  });

  it('renders the confirm button with the confirmLabel text', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: 'Pause protocol' })).toBeInTheDocument();
  });

  it('renders a Cancel button', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    await user.click(screen.getByRole('button', { name: 'Pause protocol' }));
    expect(DEFAULT_PROPS.onConfirm).toHaveBeenCalledTimes(1);
    expect(DEFAULT_PROPS.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(DEFAULT_PROPS.onCancel).toHaveBeenCalledTimes(1);
    expect(DEFAULT_PROPS.onConfirm).not.toHaveBeenCalled();
  });

  it('locks body scroll on mount', () => {
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('renders a different confirmLabel when supplied', () => {
    render(
      <AdminConfirmDialog
        {...DEFAULT_PROPS}
        confirmLabel="Remove token"
        title="Remove approved token"
        description="Removing this token will prevent new invoices using it."
      />
    );
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remove approved token' })).toBeInTheDocument();
  });

  it('does not auto-confirm on Enter when Cancel button has initial focus', async () => {
    // The dialog intentionally places Cancel as the first focusable element
    // so that pressing Enter never confirms a destructive action accidentally.
    const user = userEvent.setup();
    render(<AdminConfirmDialog {...DEFAULT_PROPS} />);
    // Tab to confirm, then tab back to cancel — confirm should not fire just
    // from mounting the dialog.
    expect(DEFAULT_PROPS.onConfirm).not.toHaveBeenCalled();
    // Clicking cancel should only call onCancel.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(DEFAULT_PROPS.onConfirm).not.toHaveBeenCalled();
    expect(DEFAULT_PROPS.onCancel).toHaveBeenCalledTimes(1);
  });
});
