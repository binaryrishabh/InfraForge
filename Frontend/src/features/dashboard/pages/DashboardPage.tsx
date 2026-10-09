import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Network, ArrowRight, Server, Activity } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { getAllInfrastructure } from '@/api/infrastructure.api';
import { getLiveDeployments, getSpecificDeployment, type LiveDeploymentSummary } from '@/api/deployment.api';
import { useCanvasStore } from '@/features/canvas/store/canvasStore';
import type { Infrastructure } from '@shared/interface/Infrastructure.interface';

export function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [infrastructures, setInfrastructures] = useState<Infrastructure[]>([]);
  const [loadingInfra, setLoadingInfra] = useState(true);
  const [liveDeployments, setLiveDeployments] = useState<LiveDeploymentSummary[]>([]);
  const [loadingLive, setLoadingLive] = useState(true);
  const [reattachingId, setReattachingId] = useState<string | null>(null);

  useEffect(() => {
    getAllInfrastructure()
      .then(setInfrastructures)
      .catch(() => setInfrastructures([])) // Catches NotFoundError when empty
      .finally(() => setLoadingInfra(false));
    // Fetch live deployments for the reattach card
    getLiveDeployments()
      .then(setLiveDeployments)
      .catch(() => setLiveDeployments([]))
      .finally(() => setLoadingLive(false));
  }, []);

  const handleReattach = async (deployment: LiveDeploymentSummary) => {
    setReattachingId(deployment.id);
    try {
      const run = await getSpecificDeployment(deployment.id);
      if (run.status !== "live" || !run.liveTopology) throw new Error("This environment is no longer live");
      const store = useCanvasStore.getState();
      store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, deployment.infrastructureName);
      navigate("/design");
    } catch {
      toast.error("Failed to re-enter the live environment");
    } finally {
      setReattachingId(null);
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  return (
    <div className="flex-1 overflow-y-auto bg-[#14161A] p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-semibold text-[#EDEEF0]">
            Good {greeting}, {user?.name.split(' ')[0]}.
          </h1>
          <p className="text-sm text-[#5A5F6B] mt-1">Ready to simulate some infrastructure?</p>
        </div>

        {/* Top Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Open Designer */}
          <Link
            to="/design"
            className="group block bg-[#1C1F26] border border-[#2A2E37] rounded-xl p-6 hover:border-[#4FA89B] transition-colors duration-150"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-[rgba(79,168,155,0.10)] flex items-center justify-center text-[#4FA89B]">
                <Network size={20} />
              </div>
              <ArrowRight size={16} className="text-[#5A5F6B] group-hover:text-[#4FA89B] transition-colors duration-150" />
            </div>
            <h3 className="text-lg font-medium text-[#EDEEF0] mb-1">Open the designer</h3>
            <p className="text-sm text-[#8B909C]">Drag, connect, and deploy your next architecture.</p>
          </Link>

          {/* Live Environment Reattach */}
          <div className="bg-[#1C1F26] border border-[#2A2E37] rounded-xl p-6 relative overflow-hidden">
            <div className="absolute inset-0 border-2 border-[#4FA89B]/20 rounded-xl animate-pulse pointer-events-none" />
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-[rgba(79,168,155,0.10)] flex items-center justify-center text-[#4FA89B]">
                <Activity size={20} />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[#4FA89B] font-semibold">Live</span>
            </div>
            <h3 className="text-lg font-medium text-[#EDEEF0] mb-3">Live Environments</h3>
            {loadingLive ? (
              <p className="text-sm text-[#5A5F6B]">Checking…</p>
            ) : liveDeployments.length === 0 ? (
              <p className="text-sm text-[#5A5F6B]">No live environments right now.</p>
            ) : (
              <div className="space-y-3">
                {liveDeployments.map((dep) => (
                  <div key={dep.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#14161A] border border-[#2A2E37]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#EDEEF0] truncate">{dep.infrastructureName}</p>
                      <p className="text-xs text-[#5A5F6B]">
                        {dep.resourceCount} resources · live since {new Date(dep.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleReattach(dep)}
                      disabled={reattachingId === dep.id}
                      className="h-8 px-3 rounded-lg bg-[#4FA89B] text-[12px] font-medium text-[#14161A] hover:bg-[#5FBBA9] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                    >
                      {reattachingId === dep.id && (
                        <span className="w-3 h-3 border-2 border-[#14161A]/30 border-t-[#14161A] rounded-full animate-spin" />
                      )}
                      Re-enter environment
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Infrastructures List */}
        <div className="bg-[#1C1F26] border border-[#2A2E37] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#2A2E37] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#EDEEF0]">Saved Infrastructures</h2>
          </div>
          <div className="divide-y divide-[#2A2E37]">
            {loadingInfra ? (
              <div className="p-8 text-center text-sm text-[#5A5F6B]">Loading...</div>
            ) : infrastructures.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#5A5F6B]">
                No infrastructures saved yet. <Link to="/design" className="text-[#4FA89B] hover:underline">Open the designer</Link> to build your first.
              </div>
            ) : (
              infrastructures.map(infra => (
                <Link
                  key={infra.id}
                  to="/design"
                  className="flex items-center justify-between p-4 hover:bg-[#2A2E37]/40 transition-colors duration-150 group"
                >
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-[#5A5F6B]" />
                    <div>
                      <p className="text-sm font-medium text-[#EDEEF0] group-hover:text-[#4FA89B] transition-colors duration-150">{infra.name}</p>
                      <p className="text-xs text-[#5A5F6B]">{new Date(infra.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className="text-xs text-[#8B909C] bg-[#14161A] px-2 py-1 rounded">
                    {infra.layout?.resources?.length || 0} resources
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
