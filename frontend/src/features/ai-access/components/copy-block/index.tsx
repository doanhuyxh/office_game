import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { cn } from '@/utils/cn';

/** Khối mã có nút chép (lệnh, file cấu hình, token). */
export function CopyBlock({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Không chép được, hãy bôi đen và chép tay');
    }
  };
  return (
    <div className={cn('relative rounded-md border bg-muted/50', className)}>
      {label && <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{label}</div>}
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-xs leading-relaxed whitespace-pre">{value}</pre>
      <Button type="button" size="icon" variant="ghost" className="absolute right-1.5 bottom-1.5 size-8" onClick={copy} aria-label="Chép">
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
