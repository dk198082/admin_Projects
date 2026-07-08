import { Link } from "wouter";
import { ShieldCheck, Users, Key, ActivitySquare } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  { icon: Users, title: "User Management", text: "Create users and assign roles across applications." },
  { icon: Key, title: "Permission Matrix", text: "Configure access levels per role and resource." },
  { icon: ShieldCheck, title: "Security Policies", text: "SSO, MFA, session and export controls per app." },
  { icon: ActivitySquare, title: "Audit Log", text: "Every administrative action is recorded." },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-[hsl(220,50%,10%)] text-white flex flex-col">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-8 w-8" />
          <span className="font-bold tracking-tight">Admin Console</span>
        </div>
        <Link href="/sign-in">
          <Button className="bg-[hsl(223,100%,50%)] hover:bg-[hsl(223,100%,44%)] text-white">
            Sign in
          </Button>
        </Link>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight max-w-2xl">
          Role-based security for your internal apps
        </h1>
        <p className="mt-4 max-w-xl text-white/60 text-lg">
          Manage users, roles, permissions, and security policies for Production
          Shop Floor and Field Service Calendar — with a full audit trail.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/sign-in">
            <Button size="lg" className="bg-[hsl(223,100%,50%)] hover:bg-[hsl(223,100%,44%)] text-white">
              Sign in to console
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="lg" variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10">
              Request access
            </Button>
          </Link>
        </div>
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
