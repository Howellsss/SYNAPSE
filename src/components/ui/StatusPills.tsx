import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { AppointmentStatus, WorkflowStatus, FormStatus, MessageStatus } from '@/types';

interface StatusPillProps {
  status: string;
  className?: string;
}

const appointmentStatusConfig: Record<AppointmentStatus, { label: string; bg: string; text: string; dot: string }> = {
  confirmed: { label: 'Confirmed', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  pending: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  rescheduled: { label: 'Rescheduled', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  completed: { label: 'Completed', bg: 'bg-navy-50', text: 'text-navy-600', dot: 'bg-navy-400' },
  no_show: { label: 'No-show', bg: 'bg-burgundy-400/10', text: 'text-burgundy-600', dot: 'bg-burgundy-500' },
};

const workflowStatusConfig: Partial<Record<WorkflowStatus, { label: string; bg: string; text: string; dot: string }>> = {
  active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  draft: { label: 'Draft', bg: 'bg-ivory-100', text: 'text-ivory-700', dot: 'bg-ivory-600' },
  paused: { label: 'Paused', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
};

const formStatusConfig: Record<FormStatus, { label: string; bg: string; text: string; dot: string }> = {
  published: { label: 'Published', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  draft: { label: 'Draft', bg: 'bg-ivory-100', text: 'text-ivory-700', dot: 'bg-ivory-600' },
  inactive: { label: 'Inactive', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  archived: { label: 'Archived', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

const messageStatusConfig: Record<MessageStatus, { label: string; bg: string; text: string; dot: string }> = {
  queued: { label: 'Queued', bg: 'bg-ivory-100', text: 'text-ivory-700', dot: 'bg-ivory-600' },
  sending: { label: 'Sending', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  sent: { label: 'Sent', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  delivered: { label: 'Delivered', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  bounced: { label: 'Bounced', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', bg: 'bg-ivory-100', text: 'text-ivory-700', dot: 'bg-ivory-600' },
};

export function AppointmentStatusPill({ status, className }: StatusPillProps) {
  const config = appointmentStatusConfig[status as AppointmentStatus];
  if (!config) return null;
  return (
    <span className={cn('status-pill', config.bg, config.text, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export function WorkflowStatusPill({ status, className }: StatusPillProps) {
  const config = workflowStatusConfig[status as WorkflowStatus];
  if (!config) return null;
  return (
    <span className={cn('status-pill', config.bg, config.text, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export function FormStatusPill({ status, className }: StatusPillProps) {
  const config = formStatusConfig[status as FormStatus];
  if (!config) return null;
  return (
    <span className={cn('status-pill', config.bg, config.text, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export function MessageStatusPill({ status, className }: StatusPillProps) {
  const config = messageStatusConfig[status as MessageStatus];
  if (!config) return null;
  return (
    <span className={cn('status-pill', config.bg, config.text, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export function TagPill({ name, color, className }: { name: string; color?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md whitespace-nowrap',
        className
      )}
      style={{
        backgroundColor: color ? `${color}15` : '#39456015',
        color: color || '#394560',
      }}
    >
      {name}
    </span>
  );
}

export function GenericPill({
  children,
  color = 'navy',
  className,
}: {
  children: ReactNode;
  color?: 'navy' | 'gold' | 'green' | 'blue' | 'red' | 'ivory';
  className?: string;
}) {
  const configs = {
    navy: 'bg-navy-50 text-navy-600',
    gold: 'bg-gold-50 text-gold-700',
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    ivory: 'bg-ivory-100 text-ivory-700',
  };
  return <span className={cn('status-pill', configs[color], className)}>{children}</span>;
}
