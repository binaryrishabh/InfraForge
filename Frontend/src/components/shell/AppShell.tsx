import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Network, FileText, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/auth.store';

export function AppShell() {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();

  const handleSignOut = async () => {
    await signOut();
    navigate('/signin');
  };

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/design', icon: Network, label: 'Designer' },
    { to: '/reports', icon: FileText, label: 'Reports', soon: true },
    { to: '/settings', icon: Settings, label: 'Settings', soon: true },
  ];

  return (
    <div className="flex h-screen bg-[#14161A] text-[#EDEEF0] overflow-hidden">
      {/* Left Rail */}
      <aside className="w-14 bg-[#1C1F26] border-r border-[#2A2E37] flex flex-col items-center py-4 shrink-0">
        <div className="flex flex-col items-center gap-2 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `w-10 h-10 rounded-lg flex items-center justify-center relative transition-colors duration-150 group ${
                  isActive
                    ? 'bg-[rgba(79,168,155,0.10)] text-[#4FA89B]'
                    : 'text-[#5A5F6B] hover:bg-[#2A2E37]/50 hover:text-[#8B909C]'
                }`
              }
              title={item.label}
            >
              <item.icon size={20} strokeWidth={1.75} />
              {item.soon && (
                <span className="absolute -top-1 -right-1 text-[8px] bg-[#2A2E37] text-[#8B909C] px-1 rounded uppercase tracking-wide">
                  soon
                </span>
              )}
            </NavLink>
          ))}
        </div>
        {/* User Chip */}
        {user && (
          <button
            onClick={handleSignOut}
            className="w-10 h-10 rounded-full bg-[#2A2E37]/60 border border-[#2A2E37] flex items-center justify-center text-[#4FA89B] font-semibold text-sm hover:bg-[#2A2E37] hover:border-[#3A3F4A] transition-colors duration-150 relative group"
            title={`Sign out ${user.name}`}
          >
            {user.name.charAt(0).toUpperCase()}
            <div className="absolute left-12 bg-[#1C1F26] border border-[#2A2E37] px-2 py-1 rounded text-xs text-[#EDEEF0] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 flex items-center gap-1.5">
              <LogOut size={12} /> Sign out
            </div>
          </button>
        )}
      </aside>
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}