import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLocaleStore } from '@/i18n';
import { useI18n } from '@/i18n/useI18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ResumeEditorPanel } from './ResumeEditorPanel';
import { ResumePreviewPanel } from './ResumePreviewPanel';
import { ToasterComponent } from '@/components/ui/toast';

const COACH_MARKS_STORAGE_KEY = 'resume-generator-coach-marks-dismissed-v1';
const COACH_MARK_CARD_WIDTH = 240;
const COACH_MARK_CARD_HEIGHT = 132;
const COACH_MARK_GAP = 14;
const COACH_MARK_MARGIN = 16;

type CoachTargetId = 'start' | 'preview-rail' | 'export-actions';
type CoachPlacement = 'right' | 'left' | 'above' | 'below';
type CoachMarkRect = {
  id: CoachTargetId;
  target: DOMRect;
  card: {
    left: number;
    top: number;
  };
};

export function ResumeGeneratorPage() {
  const { t } = useI18n();
  const [isCoachMarksOpen, setCoachMarksOpen] = useState(false);

  useEffect(() => {
    trackAnalyticsEvent('page_viewed', {
      path: typeof window !== 'undefined' ? window.location.pathname : '/',
      locale: useLocaleStore.getState().locale,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    if (window.localStorage.getItem(COACH_MARKS_STORAGE_KEY) === '1') return;

    const timeoutId = window.setTimeout(() => {
      setCoachMarksOpen(true);
      trackAnalyticsEvent('onboarding_viewed', { surface: 'coach_marks' });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const openCoachMarks = useCallback(() => {
    setCoachMarksOpen(true);
    trackAnalyticsEvent('onboarding_viewed', { surface: 'coach_marks_reopen' });
  }, []);

  const dismissCoachMarks = useCallback(() => {
    setCoachMarksOpen(false);
    try {
      window.localStorage.setItem(COACH_MARKS_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures; the guide can harmlessly reappear next visit.
    }
    trackAnalyticsEvent('onboarding_dismissed', { surface: 'coach_marks' });
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#f3f5f8] text-slate-900 lg:flex-row">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-none">
        <ResumeEditorPanel />
      </main>
      <aside aria-label={t('a11y.previewPanel')} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ResumePreviewPanel onOpenCoachMarks={openCoachMarks} />
      </aside>
      <CoachMarksLayer isOpen={isCoachMarksOpen} onDismiss={dismissCoachMarks} />
      <ToasterComponent />
    </div>
  );
}

function CoachMarksLayer({ isOpen, onDismiss }: { isOpen: boolean; onDismiss: () => void }) {
  const { t } = useI18n();
  const definitions = useMemo<Array<{
    id: CoachTargetId;
    title: string;
    description: string;
    placement: CoachPlacement;
  }>>(() => [
    {
      id: 'start',
      title: t('coachMarks.start.title'),
      description: t('coachMarks.start.description'),
      placement: 'above',
    },
    {
      id: 'preview-rail',
      title: t('coachMarks.previewRail.title'),
      description: t('coachMarks.previewRail.description'),
      placement: 'left',
    },
    {
      id: 'export-actions',
      title: t('coachMarks.exportActions.title'),
      description: t('coachMarks.exportActions.description'),
      placement: 'below',
    },
  ], [t]);
  const [marks, setMarks] = useState<CoachMarkRect[]>([]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      setMarks([]);
      return;
    }
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      setMarks([]);
      return;
    }

    let frameId = 0;
    const updateMarks = () => {
      frameId = window.requestAnimationFrame(() => {
        const nextMarks: CoachMarkRect[] = [];

        definitions.forEach(definition => {
          const target = document.querySelector<HTMLElement>(`[data-coach-target="${definition.id}"]`);
          if (!target || !isElementVisible(target)) return;

          const rect = target.getBoundingClientRect();
          const card = getCoachCardPosition(rect, definition.placement, nextMarks);
          nextMarks.push({ id: definition.id, target: rect, card });
        });

        setMarks(nextMarks);
      });
    };

    updateMarks();
    window.addEventListener('resize', updateMarks);
    window.addEventListener('scroll', updateMarks, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updateMarks);
      window.removeEventListener('scroll', updateMarks, true);
    };
  }, [definitions, isOpen]);

  if (!isOpen || marks.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {marks.map(mark => {
        const definition = definitions.find(item => item.id === mark.id);
        if (!definition) return null;

        return (
          <div key={mark.id}>
            <div
              className="absolute rounded-xl border-2 border-blue-500 shadow-[0_0_0_4px_rgba(37,99,235,0.14),0_16px_44px_rgba(37,99,235,0.18)] transition-all"
              style={{
                left: mark.target.left - 6,
                top: mark.target.top - 6,
                width: mark.target.width + 12,
                height: mark.target.height + 12,
              }}
            />
            <div
              className="pointer-events-auto absolute w-[240px] rounded-lg border border-blue-200 bg-white p-3 text-slate-900 shadow-xl shadow-slate-900/12"
              style={{
                left: mark.card.left,
                top: mark.card.top,
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">{t('coachMarks.eyebrow')}</p>
              <p className="mt-1 text-sm font-semibold leading-5 text-slate-900">{definition.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{definition.description}</p>
            </div>
          </div>
        );
      })}

      <div className="pointer-events-auto fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-xl shadow-slate-900/15">
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 hover:text-slate-900" onClick={onDismiss}>
          <X className="h-4 w-4" />
          {t('coachMarks.skip')}
        </Button>
        <Button type="button" size="sm" className={cn('h-8 rounded-full px-4', 'app-primary-btn')} onClick={onDismiss}>
          {t('coachMarks.gotIt')}
        </Button>
      </div>
    </div>
  );
}

function isElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth
    && style.display !== 'none'
    && style.visibility !== 'hidden';
}

function getCoachCardPosition(rect: DOMRect, placement: CoachPlacement, existingMarks: CoachMarkRect[]): CoachMarkRect['card'] {
  const placements = uniquePlacements([placement, 'right', 'left', 'above', 'below']);
  const candidates = placements.map(candidatePlacement => getCoachCardCandidate(rect, candidatePlacement));
  const nonOverlappingCandidate = candidates.find(candidate => !existingMarks.some(mark => doRectsOverlap(getCardRect(candidate), getCardRect(mark.card))));
  return nonOverlappingCandidate || candidates[0];
}

function getCoachCardCandidate(rect: DOMRect, placement: CoachPlacement): CoachMarkRect['card'] {
  let left = rect.right + COACH_MARK_GAP;
  let top = rect.top;

  if (placement === 'left') {
    left = rect.left - COACH_MARK_CARD_WIDTH - COACH_MARK_GAP;
    top = rect.top;
  } else if (placement === 'above') {
    left = rect.right - COACH_MARK_CARD_WIDTH;
    top = rect.top - COACH_MARK_CARD_HEIGHT - COACH_MARK_GAP;
  } else if (placement === 'below') {
    left = rect.right - COACH_MARK_CARD_WIDTH;
    top = rect.bottom + COACH_MARK_GAP;
  } else {
    left = rect.right + COACH_MARK_GAP;
  }

  return {
    left: clamp(left, COACH_MARK_MARGIN, window.innerWidth - COACH_MARK_CARD_WIDTH - COACH_MARK_MARGIN),
    top: clamp(top, COACH_MARK_MARGIN, window.innerHeight - COACH_MARK_CARD_HEIGHT - COACH_MARK_MARGIN),
  };
}

function uniquePlacements(placements: CoachPlacement[]): CoachPlacement[] {
  return placements.filter((placement, index) => placements.indexOf(placement) === index);
}

function getCardRect(card: CoachMarkRect['card']): DOMRect {
  return new DOMRect(card.left, card.top, COACH_MARK_CARD_WIDTH, COACH_MARK_CARD_HEIGHT);
}

function doRectsOverlap(first: DOMRect, second: DOMRect): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
