import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import Permissions from "@/pages/Permissions";
import Security from "@/pages/Security";
import Audit from "@/pages/Audit";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  id: number;
  entraObjectId: string;
  email: string;
  name: string;
}

export function useAuthUser() {
  return useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/me`, {
        credentials: "include",
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to load session");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useAuthUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(220,50%,10%)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[hsl(223,100%,50%)]" />
      </div>
    );
  }
  if (!user) {
    return <Landing />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <AuthGate>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/users" component={Users} />
          <Route path="/permissions" component={Permissions} />
          <Route path="/security" component={Security} />
          <Route path="/audit" component={Audit} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
