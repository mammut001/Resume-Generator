import { ResumeEditorPanel } from './ResumeEditorPanel';
import { ResumePreviewPanel } from './ResumePreviewPanel';
import { ToasterComponent } from '@/components/ui/toast';

export function ResumeGeneratorPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden lg:flex-row">
      <ResumeEditorPanel />
      <ResumePreviewPanel />
      <ToasterComponent />
    </div>
  );
}