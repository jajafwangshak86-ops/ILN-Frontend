import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoiceNotificationPrompt } from '../InvoiceNotificationPrompt';

// Stub the browser notifications hook so tests don't depend on the
// Notifications API (unavailable in jsdom).
const mockRequestPermission = vi.fn();
const mockShowNotification = vi.fn();
let mockPermission: NotificationPermission = 'default';

vi.mock('@/hooks/useBrowserNotifications', () => ({
  useBrowserNotifications: () => ({
    get permission() {
      return mockPermission;
    },
    requestPermission: mockRequestPermission,
    showNotification: mockShowNotification,
  }),
}));

const baseProps = {
  invoiceId: 'inv-001',
  dueDate: Math.floor(Date.now() / 1000) + 48 * 60 * 60, // 48 hours from now
  isPartyToInvoice: true,
};

describe('InvoiceNotificationPrompt', () => {
  beforeEach(() => {
    mockPermission = 'default';
    mockRequestPermission.mockReset();
    mockShowNotification.mockReset();
    localStorage.clear();
  });

  it('renders the opt-in prompt when the user is a party and has not opted in', () => {
    render(<InvoiceNotificationPrompt {...baseProps} />);
    expect(
      screen.getByText(/Get notified 24 hours before this invoice expires/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable Notifications' })).toBeInTheDocument();
  });

  it('renders nothing when the user is not a party to the invoice', () => {
    const { container } = render(
      <InvoiceNotificationPrompt {...baseProps} isPartyToInvoice={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the permission has been denied', () => {
    mockPermission = 'denied';
    const { container } = render(<InvoiceNotificationPrompt {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user has already opted in (stored in localStorage)', () => {
    localStorage.setItem('iln_invoice_reminders', JSON.stringify({ 'inv-001': true }));
    const { container } = render(<InvoiceNotificationPrompt {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the prompt when the dismiss button is clicked', async () => {
    render(<InvoiceNotificationPrompt {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(
        screen.queryByText(/Get notified 24 hours before this invoice expires/i)
      ).not.toBeInTheDocument();
    });
  });

  it('requests permission and stores the opt-in when "Enable Notifications" is clicked', async () => {
    mockRequestPermission.mockResolvedValue('granted');
    render(<InvoiceNotificationPrompt {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });

    const stored = JSON.parse(localStorage.getItem('iln_invoice_reminders') ?? '{}');
    expect(stored['inv-001']).toBe(true);
  });

  it('does not store the opt-in when permission is denied by the browser', async () => {
    mockRequestPermission.mockResolvedValue('denied');
    render(<InvoiceNotificationPrompt {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });

    const stored = JSON.parse(localStorage.getItem('iln_invoice_reminders') ?? '{}');
    expect(stored['inv-001']).toBeUndefined();
  });
});
