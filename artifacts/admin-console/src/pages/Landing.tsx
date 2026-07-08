import { ShieldCheck, Users, Key, ActivitySquare } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  { icon: Users, title: "User Management", text: "Create users and assign roles across applications." },
  { icon: Key, title: "Permission Matrix", text: "Configure access levels per role and resource." },
  { icon: ShieldCheck, title: "Security Policies", text: "SSO, MFA, session and export controls per app." },
  { icon: ActivitySquare, title: "Audit Log", text: "Every administrative action is recorded." },
];

function signIn() {
  const url = `${import.meta.env.BASE_URL}api/auth/login`;
  const target = window.top ?? window;
  try {
    target.location.href = url;
  } catch {
    window.open(url, "_blank");
  }
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Landing() {
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <div className="min-h-[100dvh] bg-[hsl(220,50%,10%)] text-white flex flex-col">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-8 w-8" />
          <span className="font-bold tracking-tight">Admin Console</span>
        </div>
        <Button onClick={signIn} className="gap-2 bg-white text-[hsl(220,50%,10%)] hover:bg-white/90">
          <MicrosoftLogo />
          Sign in with Microsoft
        </Button>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight max-w-2xl">
          Role-based security for your internal apps
        </h1>
        <p className="mt-4 max-w-xl text-white/60 text-lg">
          Manage users, roles, permissions, and security policies for Production
          Shop Floor and Field Service Calendar — with a full audit trail.
        </p>
        {authError && (
          <div className="mt-6 rounded-md border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            Sign-in didn't complete ({authError.replaceAll("_", " ")}). Please try again.
          </div>
        )}
        <div className="mt-8">
          <Button size="lg" onClick={signIn} className="gap-2 bg-white text-[hsl(220,50%,10%)] hover:bg-white/90">
            <MicrosoftLogo />
            Sign in with Microsoft
          </Button>
        </div>
        <p className="mt-3 text-sm text-white/40">
          Sign-in is restricted to your organization's Microsoft Entra ID accounts.
        </p>
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl w-full pb-16">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg border border-white/10 bg-white/5 p-5 text-left">
              <f.icon className="h-5 w-5 text-[hsl(223,100%,60%)]" />
              <div className="mt-3 font-semibold">{f.title}</div>
              <div className="mt-1 text-sm text-white/55">{f.text}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
