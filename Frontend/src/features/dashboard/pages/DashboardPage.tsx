import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, ArrowRight, Server, Activity } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { getAllInfrastructure } from '@/api/infrastructure.api';
import type { Infrastructure } from '@shared/types/Infrastructure.types';

export function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const [infrastructures, setInfrastructures] = useState<Infrastructure[]>([]);
  const [loadingInfra, setLoadingInfra] = useState(true);

  useEffect(() => {
    getAllInfrastructure()
      .then(setInfrastructures)
      .catch(() => setInfrastructures([])) // Catches NotFoundError when empty
      .finally(() => setLoadingInfra(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  return (
    <div className="flex-1 overflow-y-auto bg-[#0f1117] p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-semibold text-[#EDF1F7]">
            Good {greeting}, {user?.name.split(' ')[0]}.
          </h1>
          <p className="text-sm text-[#677185] mt-1">Ready to simulate some infrastructure?</p>
        </div>

        {/* Top Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Open Designer */}
          <Link 
            to="/design" 
            className="group block bg-[#12161F] border border-[#273042] rounded-xl p-6 hover:border-[#5B8CFF] transition-colors duration-150"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-[rgba(91,140,255,0.10)] flex items-center justify-center text-[#5B8CFF]">
                <Network size={20} />
              </div>
              <ArrowRight size={16} className="text-[#677185] group-hover:text-[#5B8CFF] transition-colors duration-150" />
            </div>
            <h3 className="text-lg font-medium text-[#EDF1F7] mb-1">Open the designer</h3>
            <p className="text-sm text-[#AAB4C5]">Drag, connect, and deploy your next architecture.</p>
          </Link>

          {/* Live Environment */}
          <div className="bg-[#12161F] border border-[#273042] rounded-xl p-6 relative overflow-hidden">
            <div className="absolute inset-0 border-2 border-green-500/20 rounded-xl animate-pulse pointer-events-none" />
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-[rgba(74,222,128,0.10)] flex items-center justify-center text-green-400">
                <Activity size={20} />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Live</span>
            </div>
            <h3 className="text-lg font-medium text-[#EDF1F7] mb-1">Live Environments</h3>
            <p className="text-sm text-[#677185]">No live environments right now.</p>
          </div>
        </div>

        {/* Infrastructures List */}
        <div className="bg-[#12161F] border border-[#273042] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#1F2633] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#EDF1F7]">Saved Infrastructures</h2>
          </div>
          <div className="divide-y divide-[#1F2633]">
            {loadingInfra ? (
              <div className="p-8 text-center text-sm text-[#677185]">Loading...</div>
            ) : infrastructures.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#677185]">
                No infrastructures saved yet. <Link to="/design" className="text-[#5B8CFF] hover:underline">Open the designer</Link> to build your first.
              </div>
            ) : (
              infrastructures.map(infra => (
                <Link 
                  key={infra.id} 
                  to="/design" 
                  className="flex items-center justify-between p-4 hover:bg-[#171C27] transition-colors duration-150 group"
                >
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-[#677185]" />
                    <div>
                      <p className="text-sm font-medium text-[#EDF1F7] group-hover:text-[#5B8CFF] transition-colors duration-150">{infra.name}</p>
                      <p className="text-xs text-[#677185]">{new Date(infra.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className="text-xs text-[#AAB4C5] bg-[#0B0E14] px-2 py-1 rounded">
                    {(infra.layout as any)?.resources?.length || 0} resources
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}