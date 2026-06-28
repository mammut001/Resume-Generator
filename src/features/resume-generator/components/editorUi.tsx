import React from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ghostButtonClass } from './editorStyles';

export function ControlGroup({
  title,
  icon: Icon,
  count,
  meta,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  meta?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const sectionId = React.useId();
  const panelId = `${sectionId}-panel`;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={t(isOpen ? 'a11y.collapseSection' : 'a11y.expandSection', { title })}
          onClick={() => setIsOpen(open => !open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
          {typeof count === 'number' && (
            <Badge className="h-5 rounded bg-slate-200 px-1.5 text-[10px] text-slate-700 hover:bg-slate-200">{count}</Badge>
          )}
          {meta && <span className="hidden truncate text-xs text-slate-500 sm:block">{meta}</span>}
        </button>
        {action}
      </div>
      {isOpen && (
        <div id={panelId} className="space-y-3 p-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const inputId = React.useId();
  const child = React.Children.only(children);
  const control = React.isValidElement(child)
    ? React.cloneElement(child as React.ReactElement<{ id?: string }>, {
        id: (child as React.ReactElement<{ id?: string }>).props.id ?? inputId,
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={inputId} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
      {control}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">{label}</div>;
}

export function ItemShell({
  title,
  subtitle,
  onRemove,
  children,
}: {
  title: string;
  subtitle: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{title}</p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          title={t('actions.delete')}
          aria-label={t('actions.delete')}
          className="h-8 w-8 shrink-0 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="outline" className={cn('h-7 px-2 text-xs', ghostButtonClass)} onClick={onClick}>
      <Plus className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function SegmentedControl<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: Array<{ id: TValue; label: string; description?: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  const groupId = React.useId();

  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(option => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            id={`${groupId}-${option.id}`}
            type="button"
            title={option.description}
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              'min-h-10 rounded px-2 py-1.5 text-center transition',
              isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-700',
            )}
          >
            <span className="block text-xs font-semibold">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}