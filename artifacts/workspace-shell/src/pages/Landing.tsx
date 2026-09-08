import { LayoutGrid, ShieldCheck, KeyRound, Users } from "lucide-react";

function signIn() {
  const target = window.top ?? window;
  try {
    target.location.href = "/api/auth/login";
  } catch {
    window.open("/api/auth/login", "_blank");
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

const points = [
  { icon: LayoutGrid, title: "One workspace", text: "Every app you're entitled to, in one place." },
  { icon: ShieldCheck, title: "Single sign-on", text: "Sign in once with your Microsoft account." },
  { icon: KeyRound, title: "Entitlement-aware", text: "You only ever see apps you actually have access to." },
  { icon: Users, title: "Managed centrally", text: "Access is granted and revoked from the Admin Console." },
];

/**
 * This IS the front door for the SSO experience: the workspace shell's own
 * login uses the exact same /api/auth/login → Entra ID → /api/auth/callback
 * flow as every other app in the workspace. The first time a user signs in
 * anywhere (here or directly on a satellite app), Entra ID establishes its
 * own tenant-wide SSO session in the browser — every subsequent app they
 * open (including this shell, on a later visit) authenticates silently
 * against that session instead of prompting again. See
 * docs/workspace/TECHNICAL_DESIGN.md, "Single sign-on design".
 */
export function Landing() {
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <div className="min-h-[100dvh] bg-[#0b1b3a] text-white flex flex-col">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <span className="font-bold tracking-tight text-lg">Workspace</span>
        </div>
        <button
          onClick={signIn}
          className="flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-[#0b1b3a] hover:bg-white/90"
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </button>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight max-w-2xl">
          One digital workspace. All your applications.
        </h1>
        <p className="mt-4 max-w-xl text-white/60 text-lg">
          Sign in once with your organization account to see every application
          you have access to — and open any of them without signing in again.
        </p>
        {authError === "not_authorized" ? (
          <div className="mt-6 rounded-md border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 max-w-md">
            <p className="font-semibold">Access not granted</p>
            <p className="mt-1 text-amber-200/80">
              Your Microsoft account was recognised but you haven't been given
              access to the Workspace yet. Contact an administrator to be
              added under <strong>Map User Security Access</strong> in the
              Admin Console.
            </p>
          </div>
        ) : authError ? (
          <div className="mt-6 rounded-md border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            Sign-in didn't complete ({authError.replaceAll("_", " ")}). Please try again.
          </div>
        ) : null}
        <div className="mt-8">
          <button
            onClick={signIn}
            className="flex items-center gap-2 rounded-md bg-white px-6 py-3 text-base font-medium text-[#0b1b3a] hover:bg-white/90"
          >
            <MicrosoftLogo />
            Sign in with Microsoft
          </button>
        </div>
        <p className="mt-3 text-sm text-white/40">
          Sign-in is restricted to your organization's Microsoft Entra ID accounts.
        </p>
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl w-full pb-16">
          {points.map((f) => (
            <div key={f.title} className="rounded-lg border border-white/10 bg-white/5 p-5 text-left">
              <f.icon className="h-5 w-5 text-blue-400" />
              <div className="mt-3 font-semibold">{f.title}</div>
              <div className="mt-1 text-sm text-white/55">{f.text}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
