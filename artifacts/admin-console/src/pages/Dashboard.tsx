import { useGetSummary, useListAuditLog, getGetSummaryQueryKey, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Key, AppWindow, Shield } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetSummary({
    query: { queryKey: getGetSummaryQueryKey() }
  });
  
  const { data: auditLogs, isLoading: loadingAudit } = useListAuditLog(
    { limit: 10 },
    { query: { queryKey: getListAuditLogQueryKey({ limit: 10 }) } }
  );

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Security overview and system health.</p>
        </div>
      </div>

      {loadingSummary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse bg-muted/50 border-0 shadow-none h-[120px]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard 
            title="Total Users" 
            value={summary.users} 
            subtitle={`${summary.activeUsers} active`} 
            icon={Users} 
          />
          <StatCard 
            title="Applications" 
            value={summary.apps} 
            subtitle={`${summary.resources} protected resources`} 
            icon={AppWindow} 
          />
          <StatCard 
            title="Access Grants" 
            value={summary.grants} 
            subtitle={`Across ${summary.roles} roles`} 
            icon={Key} 
          />
          <StatCard 
            title="Audit Events" 
            value={summary.auditEntries} 
            subtitle="Recorded operations" 
            icon={Activity} 
          />
        </div>
      ) : null}

      <Card className="border-card-border shadow-sm">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Recent Security Events</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingAudit ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading audit logs...</div>
          ) : auditLogs && auditLogs.length > 0 ? (
            <div className="divide-y divide-border/50">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold font-mono">
                      {log.actor.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        <span className="text-primary font-mono text-xs mr-2 px-1.5 py-0.5 bg-primary/10 rounded">{log.action}</span>
                        {log.detail}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.actor} on <span className="font-mono">{log.entity}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">No recent audit events.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon }: { title: string, value: number, subtitle: string, icon: any }) {
  return (
    <Card className="border-card-border shadow-sm overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 group-hover:scale-110 transition-all duration-500">
        <Icon className="h-16 w-16 text-primary" />
      </div>
      <CardHeader className="pb-2 relative z-10">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="relative z-10">
        <div className="text-3xl font-bold font-mono text-foreground">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
