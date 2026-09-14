import React from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={t(isOpen ? 'a11y.collapseSection' : 'a11y.expandSection', { title })}
          onClick={() => setIsOpen(open => !open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          {typeof count === 'number' && (
            <Badge className="h-5 rounded bg-slate-200 px-1.5 text-[10px] text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800">{count}</Badge>
          )}
          {meta && <span className="hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">{meta}</span>}
        </button>
        {action}
      </div>
      {isOpen && (
        <div id={panelId} className="space-y-3 p-3.5 dark:bg-slate-900">
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
      <Label htmlFor={inputId} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</Label>
      {control}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">{label}</div>;
}

export function ItemShell({
  title,
  subtitle,
  summaryTitle,
  pill,
  isCollapsed = false,
  onToggleCollapse,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onRemove,
  children,
}: {
  title: string;
  subtitle?: string;
  summaryTitle?: string;
  pill?: React.ReactNode;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div
        className={cn(
          'flex items-center justify-between gap-2 bg-slate-50/80 px-3 py-2 transition-colors dark:bg-slate-900/80',
          !isCollapsed && 'border-b border-slate-100 dark:border-slate-800',
          onToggleCollapse && 'cursor-pointer select-none hover:bg-slate-100/60 dark:hover:bg-slate-800/60',
        )}
        onClick={onToggleCollapse}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onToggleCollapse && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={e => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              aria-expanded={!isCollapsed}
              aria-label={t(isCollapsed ? 'common.expand' : 'common.collapse')}
              title={t(isCollapsed ? 'common.expand' : 'common.collapse')}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
          {isCollapsed ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{summaryTitle || title}</p>
              {pill ? (
                <Badge variant="outline" className="shrink-0 rounded border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                  {pill}
                </Badge>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
              {subtitle && <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={t('common.moveUp')}
              aria-label={t('common.moveUp')}
              disabled={!canMoveUp}
              className="h-7 w-7 shrink-0 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={e => {
                e.stopPropagation();
                onMoveUp();
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
          {onMoveDown && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={t('common.moveDown')}
              aria-label={t('common.moveDown')}
              disabled={!canMoveDown}
              className="h-7 w-7 shrink-0 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={e => {
                e.stopPropagation();
                onMoveDown();
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title={t('actions.delete')}
            aria-label={t('actions.delete')}
            className="h-7 w-7 shrink-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {!isCollapsed && <div className="space-y-3 p-3 dark:bg-slate-900">{children}</div>}
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
      className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950"
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
              isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            )}
          >
            <span className="block text-xs font-semibold">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
