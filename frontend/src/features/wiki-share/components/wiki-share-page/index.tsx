import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, Clock, KeyRound, Link2Off, ListTree, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { Markdown } from '@/components/common/markdown';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { useTheme } from '@/context/theme-provider';
import { ApiError } from '@/services/api-client';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { wikiShareApi, wikiShareKeys } from '../../api/wiki-share.api';
import type { IPublicWikiShare } from '../../types/wiki-share.types';
import { buildShareTree, formatRemaining, type IShareNode } from '../../utils/remaining';

const route = getRouteApi('/s/$token');

/** Thẻ `<meta name="robots" content="noindex">` khi đang ở trang công khai (server cũng gửi `X-Robots-Tag`). */
function useNoIndex() {
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    return () => m.remove();
  }, []);
}

function useIsDark() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}

/** Thanh đầu trang công khai: logo + tên dự án + "Hết hạn sau …" + nút sáng / tối. */
function TopBar({ projectName, remaining, onMenu }: { projectName?: string; remaining?: number; onMenu?: () => void }) {
  const { dark, toggle } = useIsDark();
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:px-5">
        {onMenu && (
          <Button type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Mục lục trang" onClick={onMenu} data-testid="wiki-share-menu"><ListTree /></Button>
        )}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Building2 className="size-4" /></div>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-semibold" data-testid="wiki-share-project">{projectName ?? 'OfficeHub'}</span>
          {remaining != null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="wiki-share-countdown">
              <Clock className="size-3" /> Hết hạn sau <span className="font-medium text-foreground tabular-nums">{formatRemaining(remaining)}</span>
            </span>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={dark ? 'Giao diện sáng' : 'Giao diện tối'} onClick={toggle} data-testid="wiki-share-theme">
          {dark ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

function Centered({ children, projectName }: { children: ReactNode; projectName?: string }) {
  return (
    <div className="min-h-svh bg-background">
      <TopBar projectName={projectName} />
      <div className="mx-auto grid w-full max-w-md gap-4 px-4 py-8 sm:py-14">{children}</div>
    </div>
  );
}

function Gone({ notFound }: { notFound: boolean }) {
  return (
    <Centered>
      <Card data-testid="wiki-share-gone">
        <CardContent className="grid justify-items-center gap-3 py-8 text-center">
          <Link2Off className="size-10 text-muted-foreground" />
          <p className="text-base font-medium">{notFound ? 'Link không tồn tại' : 'Link đã hết hạn hoặc bị thu hồi'}</p>
          <p className="text-sm text-muted-foreground">Liên hệ người đã gửi link để nhận link mới.</p>
        </CardContent>
      </Card>
    </Centered>
  );
}

/** Ô nhập mật khẩu (link có mật khẩu, chưa mở khoá). Sai → báo dưới ô; sai quá nhiều (429) → báo chờ. */
function PasswordGate({ token, info, onUnlocked }: { token: string; info: IPublicWikiShare; onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const unlock = useMutation({ mutationFn: (p: string) => wikiShareApi.unlock(token, p) });
  const err = unlock.error;
  const msg = !err ? null
    : err instanceof ApiError && err.status === 429 ? 'Nhập sai quá nhiều lần — vui lòng chờ 15 phút rồi thử lại.'
      : err instanceof ApiError && err.status === 400 ? 'Mật khẩu không đúng.'
        : errorMessage(err, 'Không mở được — thử lại');
  return (
    <Centered projectName={info.projectName}>
      <Card data-testid="wiki-share-password">
        <CardContent className="grid gap-3 py-6">
          <div className="grid justify-items-center gap-2 text-center">
            <KeyRound className="size-9 text-primary" />
            <p className="text-base font-medium">Trang này cần mật khẩu</p>
            <p className="text-sm text-muted-foreground">Nhập mật khẩu người gửi link đã cung cấp{info.recipientName ? ` cho ${info.recipientName}` : ''}.</p>
          </div>
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (pw) unlock.mutate(pw, { onSuccess: onUnlocked }); }}>
            <Input type="password" autoComplete="current-password" aria-label="Mật khẩu" placeholder="Mật khẩu" value={pw} maxLength={100} autoFocus
              aria-invalid={!!msg} onChange={(e) => { setPw(e.target.value); if (unlock.isError) unlock.reset(); }} data-testid="wiki-share-password-input" />
            {msg && <p className="text-sm text-destructive" role="alert" data-testid="wiki-share-password-error">{msg}</p>}
            <Button type="submit" disabled={!pw} loading={unlock.isPending} loadingText="Đang mở…" data-testid="wiki-share-unlock">Xem trang</Button>
          </form>
        </CardContent>
      </Card>
    </Centered>
  );
}

function TreeList({ nodes, current, onSelect }: { nodes: IShareNode[]; current: string; onSelect: (id: string) => void }) {
  return (
    <ul className="grid gap-0.5">
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onSelect(n.id)} aria-current={n.id === current ? 'page' : undefined} data-testid="wiki-share-tree-item"
            style={{ paddingLeft: `${0.5 + Math.min(n.depth, 6) * 0.875}rem` }}
            className={cn('w-full rounded-md py-1.5 pr-2 text-left text-sm wrap-anywhere transition-colors hover:bg-muted',
              n.id === current ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/90')}>
            {n.title}
          </button>
          {n.children.length > 0 && <TreeList nodes={n.children} current={current} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );
}

/** Watermark mờ "Bản xem trước cho <người nhận>" phủ cả trang (không chặn chuột, không chọn được chữ). */
function Watermark({ recipient }: { recipient: string | null }) {
  const text = recipient ? `Bản xem trước cho ${recipient}` : 'Bản xem trước';
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none print:fixed" data-testid="wiki-share-watermark">
      <div className="absolute -inset-1/2 grid rotate-[-24deg] content-start gap-x-24 gap-y-28 text-lg font-semibold whitespace-nowrap text-foreground/[0.05]"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))' }}>
        {Array.from({ length: 90 }, (_, i) => <span key={i}>{text}</span>)}
      </div>
    </div>
  );
}

/**
 * Trang công khai `/s/$token` (TEST-229, API TEST-228): khách xem trang sổ tay được chia sẻ, KHÔNG cần đăng nhập. Luôn là bản mới nhất.
 * Link có mật khẩu → ô nhập trước (sai báo lỗi, 429 báo chờ). Từ 2 trang trở lên → mục lục cây bên trái (điện thoại: ngăn kéo), chọn trang bằng `?page=`;
 * phạm vi toàn bộ sổ tay mà sổ tay trống → "Chưa có trang nào" (TEST-230).
 * Markdown dùng chung bộ hiển thị với sổ tay; link tới trang trong bản chia sẻ mở ngay tại đây, link tới trang ngoài hiện chữ thường + "không thuộc bản xem trước".
 * Watermark "Bản xem trước cho …"; 404 → "Link không tồn tại"; 410 hoặc đếm ngược về 0 → "Link đã hết hạn hoặc bị thu hồi". Thêm `<meta robots noindex>`.
 */
export function WikiSharePage() {
  useNoIndex();
  const { token } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Mỗi lần gọi info server ghi nhật ký mở → không tự gọi lại (staleTime vô hạn), chỉ gọi lại sau khi mở khoá.
  const info = useQuery({ queryKey: wikiShareKeys.info(token), queryFn: () => wikiShareApi.info(token), retry: false, staleTime: Infinity, gcTime: Infinity });
  const data = info.data;
  const pageIds = useMemo(() => new Set(data?.pages.map((p) => p.id)), [data]);
  const current = data && !data.locked ? (search.page && pageIds.has(search.page) ? search.page : data.rootPageId) : null;
  const page = useQuery({
    queryKey: wikiShareKeys.page(token, current ?? ''), queryFn: () => wikiShareApi.page(token, current!), enabled: !!current, retry: false,
  });
  const tree = useMemo(() => (data ? buildShareTree(data.pages, data.rootPageId) : []), [data]);

  const select = useCallback((id: string) => {
    setDrawer(false);
    void navigate({ search: { page: id === data?.rootPageId ? undefined : id } });
    window.scrollTo({ top: 0 });
  }, [navigate, data?.rootPageId]);

  const prefix = `/s/${token}?page=`;
  const renderLink = useCallback((href: string | undefined, children: ReactNode) => {
    if (!href || !data) return undefined;
    if (href === data.notSharedHref)
      return <span className="text-foreground" title="Trang này không thuộc bản xem trước">{children} <span className="text-xs text-muted-foreground">(không thuộc bản xem trước)</span></span>;
    if (href.startsWith(prefix)) {
      const id = new URLSearchParams(href.slice(href.indexOf('?'))).get('page') ?? '';
      return <a href={href} className="text-primary underline underline-offset-2" onClick={(e) => { e.preventDefault(); select(id); }}>{children}</a>;
    }
    return undefined;
  }, [data, prefix, select]);
  const keepUrl = useCallback((u: string) => !!data && u === data.notSharedHref, [data]);

  // Cookie mở khoá hết hạn giữa chừng (trang trả 401) → hỏi lại mật khẩu.
  useEffect(() => {
    if (page.data?.locked && data && !data.locked) qc.setQueryData(wikiShareKeys.info(token), { ...data, locked: true, pages: [], rootPageId: null });
  }, [page.data, data, qc, token]);

  const remaining = data ? new Date(data.expiresAt).getTime() - now : 0;
  const status = (e: unknown) => (e instanceof ApiError ? e.status : 0);
  if (info.isPending) return <Centered><p className="py-10 text-center text-sm text-muted-foreground">Đang mở link…</p></Centered>;
  if (info.isError) {
    const s = status(info.error);
    if (s === 404 || s === 410) return <Gone notFound={s === 404} />;
    return <Centered><p className="py-10 text-center text-sm text-destructive">{errorMessage(info.error, 'Không mở được link — kiểm tra mạng rồi tải lại trang.')}</p></Centered>;
  }
  if (!data) return null;
  if (remaining <= 0 || status(page.error) === 410) return <Gone notFound={false} />;
  if (data.locked) return <PasswordGate token={token} info={data} onUnlocked={() => void qc.invalidateQueries({ queryKey: ['wiki-share', token] })} />;

  // Phạm vi "toàn bộ sổ tay" mà sổ tay chưa có trang (TEST-230) — link vẫn hiệu lực, trang tạo sau sẽ tự hiện.
  if (data.pages.length === 0) return (
    <Centered projectName={data.projectName}>
      <Card data-testid="wiki-share-empty">
        <CardContent className="grid justify-items-center gap-3 py-8 text-center">
          <BookOpen className="size-10 text-muted-foreground" />
          <p className="text-base font-medium">Chưa có trang nào</p>
          <p className="text-sm text-muted-foreground">Sổ tay được chia sẻ hiện chưa có trang. Quay lại sau — trang mới sẽ tự hiện ở link này.</p>
          <p className="text-xs text-muted-foreground">Hết hạn lúc {formatDateTime(data.expiresAt)}</p>
        </CardContent>
      </Card>
    </Centered>
  );

  const hasTree = data.pages.length > 1;
  const p = page.data && !page.data.locked ? page.data.page : null;
  return (
    <div className="min-h-svh bg-background" data-testid="wiki-share-page">
      <TopBar projectName={data.projectName} remaining={remaining} onMenu={hasTree ? () => setDrawer(true) : undefined} />
      <Watermark recipient={data.recipientName} />
      <div className={cn('mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 sm:px-5 sm:py-8', hasTree && 'lg:grid-cols-[16rem_minmax(0,1fr)]')}>
        {hasTree && (
          <aside className="hidden lg:block">
            <nav aria-label="Mục lục trang" className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto" data-testid="wiki-share-tree">
              <p className="mb-2 flex items-center gap-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"><BookOpen className="size-3.5" /> Trang ({data.pages.length})</p>
              <TreeList nodes={tree} current={current ?? ''} onSelect={select} />
            </nav>
          </aside>
        )}
        <main className="min-w-0">
          {page.isPending ? <p className="py-10 text-center text-sm text-muted-foreground">Đang tải trang…</p>
            : page.isError || !p ? (
              <p className="py-10 text-center text-sm text-muted-foreground" data-testid="wiki-share-page-missing">
                {status(page.error) === 404 ? 'Trang này không còn trong bản chia sẻ.' : errorMessage(page.error, 'Không tải được trang — thử tải lại.')}
              </p>
            ) : (
              <article className="grid min-w-0 gap-3" data-testid="wiki-share-article">
                {p.path.length > 0 && (
                  <nav aria-label="Trang cha" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {p.path.map((c) => <span key={c.id} className="flex items-center gap-1">
                      <button type="button" className="hover:text-foreground hover:underline" onClick={() => select(c.id)}>{c.title}</button> /</span>)}
                  </nav>
                )}
                <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere" data-testid="wiki-share-title">{p.title}</h1>
                {p.summary && <p className="text-sm text-muted-foreground">{p.summary}</p>}
                <p className="text-xs text-muted-foreground">Cập nhật lúc {formatDateTime(p.updatedAt)}</p>
                <div className="min-w-0 rounded-lg border bg-card p-4 wrap-anywhere sm:p-6" data-testid="wiki-share-content">
                  {p.content.trim() ? <Markdown text={p.content} renderLink={renderLink} keepUrl={keepUrl} className="text-[15px]" />
                    : <p className="text-sm text-muted-foreground">Trang chưa có nội dung.</p>}
                </div>
                <p className="pt-2 text-center text-xs text-muted-foreground">Bản xem trước chia sẻ từ OfficeHub{data.recipientName ? ` cho ${data.recipientName}` : ''} · hết hạn lúc {formatDateTime(data.expiresAt)}</p>
              </article>
            )}
        </main>
      </div>
      {hasTree && (
        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="left" className="w-[85vw] max-w-xs overflow-y-auto p-0" data-testid="wiki-share-drawer">
            <SheetHeader className="border-b">
              <SheetTitle>Mục lục</SheetTitle>
              <SheetDescription>{data.pages.length} trang</SheetDescription>
            </SheetHeader>
            <nav aria-label="Mục lục trang" className="p-2"><TreeList nodes={tree} current={current ?? ''} onSelect={select} /></nav>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
