import {
  useGetSummary,
  useListAuditLog,
  useGetDeniedAccessSummary,
  useListApiKeys,
  useRevokeApiKey,
  getGetSummaryQueryKey,
  getListAuditLogQueryKey,
  getGetDeniedAccessSummaryQueryKey,
  getListApiKeysQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Key, AppWindow, Shield, AlertTriangle, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const { data: summary, isLoading: loadingSummary } = useGetSummary({
    query: { queryKey: getGetSummaryQueryKey() }
  });

  const { data: auditLogs, isLoading: loadingAudit } = useListAuditLog(
    { limit: 10 },
    { query: { queryKey: getListAuditLogQueryKey({ limit: 10 }) } }
  );

  const { data: deniedSummary } = useGetDeniedAccessSummary(
    {},
    { query: { queryKey: getGetDeniedAccessSummaryQueryKey({}) } }
  );

  const { data: apiKeys } = useListApiKeys({
    query: { queryKey: getListApiKeysQueryKey() }
  });

  const { mutate: revokeApiKey, isPending: isRevoking } = useRevokeApiKey({
    mutation: {
      onSuccess: () => {
        setConfirmingRevoke(null);
        queryClient.invalidateQueries({ queryKey: getGetDeniedAccessSummaryQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
      },
    },
  });

  /**
   * Actor strings from ACCESS_DENIED audit events have two forms:
   *   - Valid key denied:   "API Key: <keyPrefix>"   ← primary revokable case
   *   - Invalid/revoked key: "key fingerprint: <first10>"
   *   - No key at all:      "unknown"
   * We strip the "API Key: " prefix to get the bare keyPrefix for DB lookup.
   */
  const extractKeyPrefix = (actor: string): string | null => {
    const API_KEY_PREFIX = "API Key: ";
    if (actor.startsWith(API_KEY_PREFIX)) {
      return actor.slice(API_KEY_PREFIX.length);
    }
    return null;
  };

  const handleRevokeConfirm = (actor: string) => {
    const keyPrefix = extractKeyPrefix(actor);
    if (!keyPrefix) return;
    const match = apiKeys?.find(
      (k) => k.keyPrefix === keyPrefix && !k.revoked
    );
    if (match) {
      revokeApiKey({ id: match.id });
    }
  };

  const hasWarnings = deniedSummary && deniedSummary.hotKeys.length > 0;

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Security overview and system health.</p>
        </div>
      </div>

      {/* Denied access warning banner */}
      {deniedSummary && deniedSummary.total24h > 0 && (
        <div
          className={`mb-6 rounded-lg border p-4 ${
            hasWarnings
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                hasWarnings ? "text-destructive" : "text-amber-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p
                className={`font-semibold text-sm ${
                  hasWarnings ? "text-destructive" : "text-amber-600"
                }`}
              >
                {hasWarnings
                  ? `${deniedSummary.hotKeys.length} API key${deniedSummary.hotKeys.length > 1 ? "s" : ""} with repeated access denials`
                  : "Access denials in the last 24 hours"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {deniedSummary.total24h} ACCESS_DENIED event
                {deniedSummary.total24h !== 1 ? "s" : ""} in the last 24 hours.
                {hasWarnings &&
                  ` Keys exceeding the threshold of ${deniedSummary.threshold} denials are highlighted below.`}
              </p>

              {hasWarnings && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {deniedSummary.hotKeys.map((hk: import("@workspace/api-client-react").DeniedAccessHotKey) => {
                    const isConfirming = confirmingRevoke === hk.actor;
                    const keyPrefix = extractKeyPrefix(hk.actor);
                    const keyExists = keyPrefix != null && apiKeys?.some(
                      (k) => k.keyPrefix === keyPrefix && !k.revoked
                    );
                    return (
                      <div
                        key={hk.actor}
                        className="inline-flex items-center gap-0 rounded border border-destructive/30 bg-destructive/10 text-xs font-mono text-destructive overflow-hidden"
                      >
                        {/* Badge info — navigates to audit log */}
                        <button
                          onClick={() =>
                            navigate(
                              `/audit?action=ACCESS_DENIED&actor=${encodeURIComponent(hk.actor)}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 hover:bg-destructive/20 transition-colors cursor-pointer"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          <span className="truncate max-w-[200px]">{hk.actor}</span>
                          <span className="font-sans font-semibold">{hk.count}×</span>
                        </button>

                        {/* Revoke action — only shown when key still exists */}
                        {keyExists && !isConfirming && (
                          <button
                            onClick={() => setConfirmingRevoke(hk.actor)}
                            title="Revoke this API key"
                            className="flex items-center gap-1 px-2 py-1 border-l border-destructive/30 hover:bg-destructive/30 transition-colors cursor-pointer font-sans"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Revoke</span>
                          </button>
                        )}

                        {/* Inline confirmation */}
                        {isConfirming && (
                          <div className="flex items-center gap-1 px-2 py-1 border-l border-destructive/30 font-sans">
                            <span className="text-destructive font-semibold">Revoke?</span>
                            <button
                              onClick={() => handleRevokeConfirm(hk.actor)}
                              disabled={isRevoking}
                              className="ml-1 px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 text-xs font-semibold"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmingRevoke(null)}
                              disabled={isRevoking}
                              className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {deniedSummary.topEntities && deniedSummary.topEntities.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Most-denied entities (last 24 h):</p>
                  <div className="flex flex-wrap gap-2">
                    {deniedSummary.topEntities.map((te: import("@workspace/api-client-react").DeniedAccessTopEntity) => (
                      <button
                        key={te.entity}
                        onClick={() =>
                          navigate(
                            `/audit?action=ACCESS_DENIED&entity=${encodeURIComponent(te.entity)}`
                          )
                        }
                        title={te.displayName ? te.entity : undefined}
                        className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-mono text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                      >
                        <span className="truncate max-w-[200px]">
                          {te.displayName ?? te.entity}
                        </span>
                        <span className="font-sans font-semibold">{te.count}×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => navigate("/audit?action=ACCESS_DENIED")}
                className="mt-2 text-xs underline text-muted-foreground hover:text-foreground transition-colors"
              >
                View all denied attempts →
              </button>
            </div>
          </div>
        </div>
      )}

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
