import React from 'react';
import { Copy, FilePlus2, Files, Pencil, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';
import { useResumeGeneratorStore } from '../store/resumeGeneratorStore';

const compactButtonClass = 'h-8 w-8 shrink-0 border-slate-200 bg-slate-50 px-0 text-slate-700 hover:bg-slate-100 hover:text-slate-900';
const inputClass = 'h-8 min-w-0 border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500';

export function ResumeDocumentSwitcher({ className }: { className?: string }) {
  const {
    documents,
    activeDocumentId,
    createDocument,
    duplicateDocument,
    renameDocument,
    deleteDocument,
    switchDocument,
  } = useResumeGeneratorStore();
  const { t } = useI18n();
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
  const [draftTitle, setDraftTitle] = React.useState(activeDocument?.title || '');
  const [isManageOpen, setIsManageOpen] = React.useState(false);

  React.useEffect(() => {
    setDraftTitle(activeDocument?.title || '');
  }, [activeDocument?.id, activeDocument?.title]);

  const handleRename = () => {
    if (!activeDocument) return;
    renameDocument(activeDocument.id, draftTitle);
  };

  const canDelete = documents.length > 1;

  return (
    <section className={cn('space-y-2', className)} aria-label={t('documents.managerLabel')}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">
          <Files className="h-3.5 w-3.5 shrink-0" />
          {t('documents.label')}
        </p>
        <span className="shrink-0 text-[10px] text-slate-500">{t('documents.count', { count: documents.length })}</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Select value={activeDocumentId} onValueChange={switchDocument}>
          <SelectTrigger aria-label={t('documents.switchLabel')} className="h-8 min-w-0 border-slate-200 bg-white px-2.5 text-xs text-slate-900 ring-offset-0 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0 [&>span]:truncate">
            <SelectValue placeholder={t('documents.switchPlaceholder')} />
          </SelectTrigger>
          <SelectContent className="border-slate-200 bg-white text-slate-900">
            {documents.map(document => (
              <SelectItem key={document.id} value={document.id} className="max-w-[min(360px,calc(100vw-2rem))] truncate focus:bg-slate-100 focus:text-slate-900">
                {document.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="button" variant="outline" className={compactButtonClass} onClick={createDocument} title={t('documents.create')}>
          <FilePlus2 className="h-4 w-4" />
          <span className="sr-only">{t('documents.create')}</span>
        </Button>
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-8 w-full justify-center gap-1.5 border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 sm:hidden"
        onClick={() => setIsManageOpen(previous => !previous)}
        aria-expanded={isManageOpen}
        aria-controls="resume-document-manage-controls"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {isManageOpen ? t('documents.manageHide') : t('documents.manageShow')}
      </Button>

      <div
        id="resume-document-manage-controls"
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2',
          isManageOpen ? 'grid' : 'hidden sm:grid',
        )}
      >
        <Input
          className={inputClass}
          value={draftTitle}
          onChange={event => setDraftTitle(event.target.value)}
          onBlur={handleRename}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          aria-label={t('documents.renameLabel')}
          placeholder={t('documents.renamePlaceholder')}
        />
        <Button type="button" variant="outline" className={compactButtonClass} onClick={handleRename} title={t('documents.rename')}>
          <Pencil className="h-4 w-4" />
          <span className="sr-only">{t('documents.rename')}</span>
        </Button>
        <Button type="button" variant="outline" className={compactButtonClass} onClick={duplicateDocument} title={t('documents.duplicate')}>
          <Copy className="h-4 w-4" />
          <span className="sr-only">{t('documents.duplicate')}</span>
        </Button>
        {canDelete && activeDocument ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className={compactButtonClass} title={t('documents.delete')}>
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">{t('documents.delete')}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('documents.deleteDialogTitle', { title: activeDocument.title })}</AlertDialogTitle>
                <AlertDialogDescription>{t('documents.deleteDialogDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('documents.deleteDialogCancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteDocument(activeDocument.id)}>{t('documents.deleteDialogConfirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button type="button" variant="outline" className={compactButtonClass} disabled title={t('documents.deleteDisabled')}>
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">{t('documents.delete')}</span>
          </Button>
        )}
      </div>

      <p className="break-words text-[11px] leading-4 text-slate-500">{t('documents.helper')}</p>
      <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-4 text-slate-500">
        <p className="flex items-center gap-1.5 font-medium text-slate-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          {t('documents.localOnlyLabel')}
        </p>
        <p className="mt-1 break-words">{t('documents.localOnlyDescription')}</p>
      </div>
    </section>
  );
}
