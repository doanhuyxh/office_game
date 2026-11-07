import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Building2, Check, KeyRound, Laptop, LogOut, Moon, SearchIcon, Share, Smartphone, Sun, UserRound } from 'lucide-react';
import { Button } from '@/components/common/button';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/common/command';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Separator } from '@/components/common/separator';
import { SidebarTrigger } from '@/components/common/sidebar';
import { useLogout, useMe } from '@/features/auth';
import { ChatButton } from '@/features/chat';
import { NotificationBell } from '@/features/notifications';
import { useSearch } from '@/context/search-provider';
import { useTheme, type Theme } from '@/context/theme-provider';
import { PATHS } from '@/config/paths';
import { cn } from '@/utils/cn';
import { usePwaInstall } from '@/pwa';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { useNavigation } from './useNavigation';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { useMyProfile } from '@/features/profile';

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Sáng', icon: Sun },
  { value: 'dark', label: 'Tối', icon: Moon },
  { value: 'system', label: 'Theo hệ thống', icon: Laptop },
];

function SearchButton() {
  const { setOpen } = useSearch();
  return (
    <Button
      variant="outline"
      className="relative h-8 flex-1 justify-start rounded-md bg-muted/25 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:w-40 sm:flex-none sm:pe-12 lg:w-56 xl:w-64"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => setOpen(true)}
    >
      <SearchIcon className="absolute inset-s-1.5 top-1/2 -translate-y-1/2" />
      <span className="ms-4">Tìm nhanh…</span>
      <kbd className="pointer-events-none absolute inset-e-[0.3rem] top-[0.3rem] hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium select-none sm:flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </Button>
  );
}

/** Hộp tìm nhanh Ctrl/⌘ + K: nhảy tới màn hình, đổi theme. */
function CommandMenu() {
  const { open, setOpen } = useSearch();
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const groups = useNavigation();
  const run = (fn: () => unknown) => {
    setOpen(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Tìm nhanh" description="Tìm màn hình hoặc lệnh">
      <CommandInput placeholder="Gõ tên màn hình hoặc lệnh…" />
      <CommandList>
        <CommandEmpty>Không tìm thấy.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.title} heading={g.title}>
            {g.items.map((n) => (
              <CommandItem key={n.to} value={n.label} onSelect={() => run(() => navigate({ to: n.to }))}>
                <ArrowRight className="text-muted-foreground/80" />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Giao diện">
          {THEMES.map((t) => (
            <CommandItem key={t.value} value={`Giao diện ${t.label}`} onSelect={() => run(() => setTheme(t.value))}>
              <t.icon /> {t.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Sun className="size-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute size-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Đổi giao diện sáng / tối</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.value} onClick={() => setTheme(t.value)}>
            <t.icon /> {t.label}
            <Check className={cn('ms-auto', theme !== t.value && 'invisible')} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileDropdown() {
  const { data: me } = useMe();
  const logout = useLogout();
  const pwa = usePwaInstall();
  const { data: profile } = useMyProfile();
  const [iosHelp, setIosHelp] = useState(false);
  return (
    <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative size-8 rounded-full">
          <PersonAvatar name={me?.fullName} url={profile?.avatarUrl} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm leading-none font-medium">{me?.fullName}</p>
            <p className="text-xs leading-none text-muted-foreground">{me?.email ?? me?.userName}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {profile && <DropdownMenuItem asChild>
            <Link to={PATHS.profile}><UserRound /> Hồ sơ cá nhân</Link>
          </DropdownMenuItem>}
          <DropdownMenuItem asChild>
            <Link to={PATHS.office}><Building2 /> Vào văn phòng 3D</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={PATHS.changePassword}><KeyRound /> Đổi mật khẩu</Link>
          </DropdownMenuItem>
          {pwa.state === 'prompt' && <DropdownMenuItem onClick={() => void pwa.install()}><Smartphone /> Cài ứng dụng</DropdownMenuItem>}
          {pwa.state === 'ios' && <DropdownMenuItem onClick={() => setIosHelp(true)}><Smartphone /> Cài lên iPhone / iPad</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}>
          <LogOut /> Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={iosHelp} onOpenChange={setIosHelp}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cài OfficeHub lên iPhone / iPad</DialogTitle>
          <DialogDescription>Mở OfficeHub bằng Safari rồi làm theo 3 bước:</DialogDescription>
        </DialogHeader>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>Bấm nút <Share className="inline size-4" /> <b>Chia sẻ</b> ở thanh dưới (hoặc trên) Safari.</li>
          <li>Chọn <b>Thêm vào Màn hình chính</b>.</li>
          <li>Bấm <b>Thêm</b> — biểu tượng OfficeHub xuất hiện như một ứng dụng.</li>
        </ol>
      </DialogContent>
    </Dialog>
    </>
  );
}

/** Thanh trên cùng (dính khi cuộn): nút thu gọn sidebar, tìm nhanh, thông báo, theme, tài khoản. */
export function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled((document.body.scrollTop || document.documentElement.scrollTop) > 10);
    document.addEventListener('scroll', onScroll, { passive: true });
    return () => document.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('sticky top-0 z-40 h-16 rounded-t-[inherit]', scrolled ? 'shadow-lg' : 'shadow-sm')}>
      <div
        className={cn(
          'relative flex h-full items-center gap-3 p-4 sm:gap-4',
          scrolled && 'after:absolute after:inset-0 after:-z-10 after:rounded-t-[inherit] after:bg-background/60 after:backdrop-blur-lg',
        )}
      >
        <SidebarTrigger variant="outline" className="max-md:scale-125" />
        <Separator orientation="vertical" className="h-6!" />
        <SearchButton />
        <div className="ms-auto flex items-center gap-2">
          <ChatButton />
          <NotificationBell />
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </div>
      <CommandMenu />
    </header>
  );
}
