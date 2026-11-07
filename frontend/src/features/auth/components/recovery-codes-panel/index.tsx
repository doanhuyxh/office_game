import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';

/** Mã dự phòng chỉ hiện MỘT lần (server không trả lại) → sao chép / tải về ngay. */
export function RecoveryCodesPanel({ codes, userName }: { codes: string[]; userName?: string }) {
  const text = codes.join('\n');
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => toast.success('Đã sao chép mã dự phòng'), () => toast.error('Không sao chép được, hãy chép tay'));
  const download = () => {
    const header = `Mã dự phòng OfficeHub${userName ? ` — ${userName}` : ''}\nMỗi mã dùng được một lần khi không có điện thoại.\n\n`;
    const url = URL.createObjectURL(new Blob([header + text + '\n'], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'officehub-ma-du-phong.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Lưu các mã dưới đây ở nơi an toàn. Mỗi mã dùng <b className="text-foreground">một lần</b> để đăng nhập khi mất điện thoại. Mã chỉ hiện lúc này.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => <li key={c} className="text-center tracking-wider">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}><Copy className="size-4" /> Sao chép</Button>
        <Button type="button" variant="outline" size="sm" onClick={download}><Download className="size-4" /> Tải tệp .txt</Button>
      </div>
    </div>
  );
}
