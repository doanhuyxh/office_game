import { Link, Outlet } from '@tanstack/react-router';
import { buttonVariants } from '@/components/common/button';
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
      <aside className="hidden w-60 flex-col border-r bg-card p-4 md:flex">
        <div className="mb-6 px-2 text-lg font-bold">🏢 OfficeHub</div>
        <nav className="flex-1 space-y-1">
          {items.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: 'bg-accent font-semibold !text-primary' }}
              activeOptions={{ exact: n.to === PATHS.dashboard }}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.to === PATHS.approvals && inboxCount > 0 && (
                <span className="ml-auto rounded-full bg-destructive px-2 text-xs font-semibold text-white" data-testid="inbox-badge">{inboxCount}</span>
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
          <button onClick={logout} className="mt-2 text-xs text-destructive hover:underline">
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
