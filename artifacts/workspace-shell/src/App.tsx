import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Landing } from "@/pages/Landing";
import { Workspace } from "@/pages/Workspace";

const queryClient = new QueryClient();

export interface AuthUser {
  id: number;
  entraObjectId: string;
  email: string;
  name: string;
}

/**
 * Same shape/contract as every other app in this workspace's /api/auth/me —
 * a 401 here just means "not signed in," not an error. Each app checks this
 * independently against its OWN session; there is no shared/global session
 * across apps. What makes clicking a tile feel like "no re-login" is Entra
 * ID's own SSO session in the browser (see docs/workspace/TECHNICAL_DESIGN.md,
 * "Single sign-on design") — when the target app redirects to Entra ID to
 * establish its own session, Entra ID recognizes the user is already signed
 * in tenant-wide and returns immediately without a visible prompt.
 */
export function useAuthUser() {
  return useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to load session");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function AuthGate() {
  const { data: user, isLoading } = useAuthUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b1b3a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-blue-400" />
      </div>
    );
  }
  if (!user) {
    return <Landing />;
  }
  return <Workspace user={user} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

export default App;
