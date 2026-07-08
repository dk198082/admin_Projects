import { 
  useListSecurityPolicies, getListSecurityPoliciesQueryKey,
  useUpdateSecurityPolicy,
  useListApps, getListAppsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, Server, Clock, Save, ShieldAlert, KeyRound, DownloadCloud, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SecurityPolicy } from "@workspace/api-client-react";

export default function Security() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: policies, isLoading: loadingPolicies } = useListSecurityPolicies({
    query: { queryKey: getListSecurityPoliciesQueryKey() }
  });
  
  const { data: apps } = useListApps({
    query: { queryKey: getListAppsQueryKey() }
  });

  const [activeTab, setActiveTab] = useState<string>("");
  const updatePolicy = useUpdateSecurityPolicy();

  // Set default tab when apps load
  if (apps?.length && !activeTab) {
    setActiveTab(apps[0].id.toString());
  }

  const handleUpdate = (id: number, data: Partial<SecurityPolicy>) => {
    updatePolicy.mutate({ id, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSecurityPoliciesQueryKey() });
        toast({ title: "Security policy updated successfully" });
      }
    });
  };

  if (loadingPolicies) {
    return <div className="p-8 max-w-4xl mx-auto"><div className="h-64 animate-pulse bg-muted rounded-md" /></div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Security Policies</h1>
        <p className="text-muted-foreground mt-1">Configure global and app-specific security parameters.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 w-full justify-start h-auto p-1 bg-muted/50 overflow-x-auto">
          {apps?.map(app => (
            <TabsTrigger 
              key={app.id} 
              value={app.id.toString()}
              className="data-[state=active]:bg-card data-[state=active]:shadow-sm py-2 px-4"
            >
              {app.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {apps?.map(app => {
          const policy = policies?.find(p => p.appId === app.id);
          if (!policy) return null;

          return (
            <TabsContent key={app.id} value={app.id.toString()} className="space-y-6 outline-none">
              
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" />
                    Authentication
                  </CardTitle>
                  <CardDescription>Configure how users authenticate to {app.name}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Auth Method</Label>
                      <Select 
                        value={policy.authMethod}
                        onValueChange={(val) => handleUpdate(policy.id, { authMethod: val })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SSO">SSO (SAML 2.0)</SelectItem>
                          <SelectItem value="OAuth">OAuth2</SelectItem>
                          <SelectItem value="Local">Local Database</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>MFA Requirement</Label>
                      <Select 
                        value={policy.mfaRequired}
                        onValueChange={(val) => handleUpdate(policy.id, { mfaRequired: val })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Always">Always Required</SelectItem>
                          <SelectItem value="Off-Network">Off-Network Only</SelectItem>
                          <SelectItem value="Never">Never (Not Recommended)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="flex justify-between">
                      Session Timeout (Minutes)
                      <span className="text-muted-foreground font-mono">{policy.sessionTimeoutMinutes}m</span>
                    </Label>
                    <Input 
                      type="number" 
                      min={5} max={1440} 
                      value={policy.sessionTimeoutMinutes}
                      onChange={(e) => handleUpdate(policy.id, { sessionTimeoutMinutes: parseInt(e.target.value) || 60 })}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-primary" />
                    Data Access & Logging
                  </CardTitle>
                  <CardDescription>Rules for data visibility and audit trails.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Record Level Scope</Label>
                      <Select 
                        value={policy.recordLevelScope}
                        onValueChange={(val) => handleUpdate(policy.id, { recordLevelScope: val })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Tenant">Entire Tenant</SelectItem>
                          <SelectItem value="Department">Department Only</SelectItem>
                          <SelectItem value="Owned">Owned Records Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Data Export Policy</Label>
                      <Select 
                        value={policy.dataExportPolicy}
                        onValueChange={(val) => handleUpdate(policy.id, { dataExportPolicy: val })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Allowed">Allowed</SelectItem>
                          <SelectItem value="Restricted">Restricted (Admin Only)</SelectItem>
                          <SelectItem value="Blocked">Blocked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Field Level Rules</Label>
                    <Input 
                      value={policy.fieldLevelRules}
                      onChange={(e) => handleUpdate(policy.id, { fieldLevelRules: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">JSON or descriptive rules for PII/PHI masking.</p>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/10">
                    <div className="space-y-0.5">
                      <Label className="text-base flex items-center gap-2">
                        <Eye className="h-4 w-4" /> Comprehensive Audit Logging
                      </Label>
                      <div className="text-sm text-muted-foreground">
                        Record all read/write events for this application in the global audit log.
                      </div>
                    </div>
                    <Switch 
                      checked={policy.auditLogging}
                      onCheckedChange={(c) => handleUpdate(policy.id, { auditLogging: c })}
                    />
                  </div>
                </CardContent>
              </Card>

            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}