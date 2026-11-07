import { Link, useLocation } from '@tanstack/react-router';
import { Building2, ChevronsUpDown, KeyRound, LogOut, UserRound } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from '@/components/common/sidebar';
import { useInboxCount } from '@/features/approvals';
import { useChatUnread } from '@/features/chat';
import { useLogout, useMe } from '@/features/auth';
import { PATHS } from '@/config/paths';
import type { NavItem } from './navigation';
import { useNavigation } from './useNavigation';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { useMyProfile } from '@/features/profile';

const isActive = (pathname: string, to: string) => (to === PATHS.dashboard ? pathname === to : pathname === to || pathname.startsWith(`${to}/`));

function AppTitle() {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" asChild>
          <Link to={PATHS.dashboard} onClick={() => setOpenMobile(false)}>
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Building2 className="size-4" />
            </div>
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-semibold">OfficeHub</span>
              <span className="truncate text-xs text-muted-foreground">Văn phòng ảo &amp; nhân sự</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge?: number }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(pathname, item.to)} tooltip={item.label}>
        <Link to={item.to} onClick={() => setOpenMobile(false)}>
          <item.icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {!!badge && <SidebarMenuBadge className="rounded-full bg-destructive text-white peer-hover/menu-button:text-white" data-testid="inbox-badge">{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function NavUser() {
  const { data: me } = useMe();
  const logout = useLogout();
  const { isMobile } = useSidebar();
  const { data: profile } = useMyProfile();
  const who = (
    <>
      <PersonAvatar name={me?.fullName} url={profile?.avatarUrl} className="rounded-lg" fallbackClassName="rounded-lg" />
      <div className="grid flex-1 text-start text-sm leading-tight">
        <span className="truncate font-semibold">{me?.fullName}</span>
        <span className="truncate text-xs text-muted-foreground">{me?.email ?? me?.userName}</span>
      </div>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              {who}
              <ChevronsUpDown className="ms-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">{who}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to={PATHS.office}><Building2 /> Vào văn phòng 3D</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={PATHS.changePassword}><KeyRound /> Đổi mật khẩu</Link>
              </DropdownMenuItem>
              {profile && <DropdownMenuItem asChild>
                <Link to={PATHS.profile}><UserRound /> Hồ sơ cá nhân</Link>
              </DropdownMenuItem>}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={logout}>
              <LogOut /> Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Sidebar kiểu shadcn-admin: thu gọn thành icon (Ctrl/⌘ + B), trên mobile là ngăn kéo. */
export function AppSidebar() {
  const groups = useNavigation();
  const pathname = useLocation({ select: (l) => l.pathname });
  const { data: inboxCount = 0 } = useInboxCount();
  const chatUnread = useChatUnread();
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.title}>
            <SidebarGroupLabel>{g.title}</SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((item) => (
                <NavLink key={item.to} item={item} pathname={pathname} badge={item.to === PATHS.approvals ? inboxCount : item.to === PATHS.chat ? chatUnread : undefined} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
