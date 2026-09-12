import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Network, ArrowRight, Server, Activity } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { getAllInfrastructure, getSpecificInfrastructure } from '@/api/infrastructure.api';
import { getLiveDeployments, syncDeploymentTopology, type LiveDeploymentSummary } from '@/api/deployment.api';
import { useCanvasStore } from '@/features/canvas/store/canvasStore';
import { migrateLayoutToCardScale } from '@/features/canvas/utils/layoutMigration';
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
      const infrastructure = await getSpecificInfrastructure(deployment.infrastructureId);
      const layout = infrastructure.layout as {
        resources?: any[];
        connectionLines?: any[];
        layoutVersion?: number;
      };
      
      // Migrate legacy coordinates if the saved layout is old
      const migratedResources = migrateLayoutToCardScale(
        layout.resources ?? [],
        layout.layoutVersion,
      );
      const connectionLines = layout.connectionLines ?? [];
      
      const store = useCanvasStore.getState();
      store.loadLayout(migratedResources, connectionLines, infrastructure.id, infrastructure.name);
      store.setIsInitialized(true);
      store.setUndoStack([]);
      store.setRedoStack([]);
      store.setIsDeploying(false);
      store.setActiveDeploymentId(deployment.id);
      
      navigate("/design");
      
      // Best effort sync to the simulator so the live state resumes smoothly
      syncDeploymentTopology(deployment.id, migratedResources, connectionLines)
        .catch(() => toast.error("Reattached, but topology sync to the simulator failed"));
        
    } catch (err) {
      toast.error("Failed to fetch infrastructure layout");
    } finally {
      setReattachingId(null);
    }
  };

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

          {/* Live Environment Reattach */}
          <div className="bg-[#12161F] border border-[#273042] rounded-xl p-6 relative overflow-hidden">
            <div className="absolute inset-0 border-2 border-green-500/20 rounded-xl animate-pulse pointer-events-none" />
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-[rgba(74,222,128,0.10)] flex items-center justify-center text-green-400">
                <Activity size={20} />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Live</span>
            </div>
            <h3 className="text-lg font-medium text-[#EDF1F7] mb-3">Live Environments</h3>
            
            {loadingLive ? (
              <p className="text-sm text-[#677185]">Checking…</p>
            ) : liveDeployments.length === 0 ? (
              <p className="text-sm text-[#677185]">No live environments right now.</p>
            ) : (
              <div className="space-y-3">
                {liveDeployments.map((dep) => (
                  <div key={dep.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0B0E14] border border-[#1F2633]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#EDF1F7] truncate">{dep.infrastructureName}</p>
                      <p className="text-xs text-[#677185]">
                        {dep.resourceCount} resources · live since {new Date(dep.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleReattach(dep)}
                      disabled={reattachingId === dep.id}
                      className="h-8 px-3 rounded-lg bg-[#5B8CFF] text-[12px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                    >
                      {reattachingId === dep.id && (
                        <span className="w-3 h-3 border-2 border-[#081018]/30 border-t-[#081018] rounded-full animate-spin" />
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