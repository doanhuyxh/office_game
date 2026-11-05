import { Link, Outlet } from '@tanstack/react-router';
import { Badge } from '@/components/common/badge';
import { Button, buttonVariants } from '@/components/common/button';
import { useInboxCount } from '@/features/approvals';
import { hasRole, useLogout, useMe } from '@/features/auth';
import { PATHS } from '@/config/paths';
import { cn } from '@/utils/cn';
import { NAVIGATION } from './navigation';

export function MainLayout() {
  const { data: me } = useMe(); // route _protected đã đảm bảo đã đăng nhập
  const logout = useLogout();
  const { data: inboxCount = 0 } = useInboxCount();
  const items = NAVIGATION.filter((n) => !n.roles || hasRole(me, ...n.roles));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6 px-2 text-lg font-bold">🏢 OfficeHub</div>
        <nav className="flex-1 space-y-1">
          {items.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: 'bg-sidebar-accent font-semibold !text-sidebar-primary' }}
              activeOptions={{ exact: n.to === PATHS.dashboard }}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.to === PATHS.approvals && inboxCount > 0 && (
                <Badge variant="destructive" className="ml-auto" data-testid="inbox-badge">{inboxCount}</Badge>
              )}
            </Link>
          ))}
        </nav>
        <Link to={PATHS.office} className={cn(buttonVariants(), 'mb-3')}>
          Vào văn phòng 3D →
        </Link>
        <div className="border-t pt-3 text-sm">
          <div className="font-semibold">{me?.fullName}</div>
          <div className="text-xs text-muted-foreground">{me?.roles.join(', ')}</div>
          <Button variant="link" size="sm" onClick={logout} className="mt-2 h-auto p-0 text-xs text-destructive">
            Đăng xuất
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
