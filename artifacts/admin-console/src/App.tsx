import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
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

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(223 100% 33%)",
    colorForeground: "hsl(220 50% 10%)",
    colorMutedForeground: "hsl(220 10% 45%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(220 50% 10%)",
    colorNeutral: "hsl(220 50% 10%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl w-[440px] max-w-full overflow-hidden shadow-lg border border-[hsl(220,15%,90%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(220,50%,10%)] font-bold",
    headerSubtitle: "text-[hsl(220,10%,45%)]",
    socialButtonsBlockButtonText: "text-[hsl(220,50%,10%)]",
    formFieldLabel: "text-[hsl(220,50%,10%)] font-medium",
    footerActionLink: "text-[hsl(223,100%,33%)] font-medium",
    footerActionText: "text-[hsl(220,10%,45%)]",
    dividerText: "text-[hsl(220,10%,45%)]",
    identityPreviewEditButton: "text-[hsl(223,100%,33%)]",
    formFieldSuccessText: "text-[hsl(160,100%,30%)]",
    alertText: "text-[hsl(220,50%,10%)]",
    logoBox: "justify-center",
    logoImage: "h-10 w-10",
    socialButtonsBlockButton: "border border-[hsl(220,15%,85%)] hover:bg-[hsl(220,15%,96%)]",
    formButtonPrimary: "bg-[hsl(223,100%,33%)] hover:bg-[hsl(223,100%,28%)] text-white font-semibold",
    formFieldInput: "border border-[hsl(220,15%,85%)]",
    footerAction: "justify-center",
    dividerLine: "bg-[hsl(220,15%,88%)]",
    alert: "border border-[hsl(220,15%,88%)]",
    otpCodeFieldInput: "border border-[hsl(220,15%,85%)]",
    formFieldRow: "gap-2",
    main: "gap-5",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedPage({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function HomePage() {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Dashboard />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/users">{() => <ProtectedPage component={Users} />}</Route>
      <Route path="/permissions">{() => <ProtectedPage component={Permissions} />}</Route>
      <Route path="/security">{() => <ProtectedPage component={Security} />}</Route>
      <Route path="/audit">{() => <ProtectedPage component={Audit} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to the Admin Console",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Request access to the Admin Console",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
