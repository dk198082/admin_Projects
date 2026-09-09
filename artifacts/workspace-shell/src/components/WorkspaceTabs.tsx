import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, AlertTriangle, LayoutGrid } from "lucide-react";
import type { SidebarApp } from "@/components/Sidebar";

export interface OpenTab {
  app: SidebarApp;
}

const IFRAME_LOAD_TIMEOUT_MS = 12_000;
const WORKSPACE_ORIGIN = window.location.origin;

interface WorkspaceTabsProps {
  openTabs: OpenTab[];
  activeAppId: number | null;
  onActivate: (appId: number) => void;
  onClose: (appId: number) => void;
}

/**
 * Renders every open app as a tab, with each tab's content as a same-DOM
 * iframe kept alive (display:none, not unmounted) while inactive — so
 * switching tabs preserves the embedded app's in-page state instead of
 * reloading it from scratch, the same way real browser tabs behave.
 *
 * READ THIS BEFORE ASSUMING EVERY APP WILL EMBED CLEANLY — see
 * docs/workspace/TECHNICAL_DESIGN.md, "Embedding apps as tabs (iframe
 * design and its real limits)":
 *
 *   1. The satellite app must explicitly allow being framed by this
 *      Shell's origin (Content-Security-Policy: frame-ancestors, or by not
 *      sending X-Frame-Options: DENY/SAMEORIGIN). If it doesn't, the
 *      browser blocks the frame SILENTLY — no JS-observable error, just a
 *      blank rectangle. Cross-origin browser security deliberately
 *      prevents this Shell from detecting that from JavaScript.
 *   2. Entra ID's own login pages often refuse to render inside an iframe
 *      (anti-clickjacking) — if the embedded app's OWN session has expired
 *      and it tries to silently redirect through Entra ID to re-establish
 *      one, that redirect can fail inside the iframe even though the exact
 *      same redirect works fine in a normal browser tab.
 *   3. Because of #1 and #2, this component can only ever offer a
 *      best-effort heuristic (a load timeout — see IFRAME_LOAD_TIMEOUT_MS)
 *      and an always-visible "Open in new tab" escape hatch per tab, not a
 *      guaranteed detection of every failure mode.
 */
export function WorkspaceTabs({ openTabs, activeAppId, onActivate, onClose }: WorkspaceTabsProps) {
  if (openTabs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <LayoutGrid className="h-8 w-8 text-white/20" />
        <h3 className="mt-4 text-lg font-semibold text-white">Nothing open yet</h3>
        <p className="mt-1 max-w-sm text-sm text-ws-text-secondary">
          Choose an app from the menu on the left to open it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-white/10 bg-ws-bg px-2">
        {openTabs.map(({ app }) => (
          <Tab
            key={app.id}
            app={app}
            active={app.id === activeAppId}
            onActivate={() => onActivate(app.id)}
            onClose={() => onClose(app.id)}
          />
        ))}
      </div>
      <div className="relative flex-1 bg-white">
        {openTabs.map(({ app }) => (
          <AppFrame key={app.id} app={app} visible={app.id === activeAppId} />
        ))}
      </div>
    </div>
  );
}

function Tab({
  app,
  active,
  onActivate,
  onClose,
}: {
  app: SidebarApp;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      data-testid={`tab-${app.id}`}
      className={`group flex max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${
        active
          ? "border-ws-accent font-medium text-white"
          : "border-transparent text-ws-text-secondary hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="truncate">{app.name}</span>
      <a
        href={app.launchUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open in a new browser tab"
        data-testid={`button-open-new-tab-${app.id}`}
        className="rounded p-0.5 text-ws-text-secondary opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
        data-testid={`button-close-tab-${app.id}`}
        className="rounded p-0.5 text-ws-text-secondary hover:bg-white/10 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AppFrame({
  app,
  visible,
}: {
  app: SidebarApp;
  visible: boolean;
}) {
  const [suspectedBlocked, setSuspectedBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authPopup, setAuthPopup] = useState<Window | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isFieldService = app.name === "Field Service Calendar";

  const iframeSrc = isFieldService
  ? `${app.launchUrl}${app.launchUrl.includes("?") ? "&" : "?"}embedded=1`
  : app.launchUrl;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (!loaded) {
        setSuspectedBlocked(true);
      }
    }, IFRAME_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timerRef.current);
  }, [loaded]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "http://localhost:5177") {
        return;
      }

      if (
        event.data?.type === "FIELD_SERVICE_AUTH_COMPLETE"
      ) {
        setAuthPopup(null);

        // Give the browser a moment to commit the Field Service
        // session cookie before reloading the iframe.
        setTimeout(() => {
           iframeRef.current?.contentWindow?.location.reload();
         }, 100);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const startEmbeddedLogin = () => {
    const loginUrl = `${app.launchUrl.replace(/\/$/, "")}/api/login?embedded=1`;

    const popup = window.open(
      loginUrl,
      "fieldservice-sso",
      "width=600,height=700,resizable=yes,scrollbars=yes",
    );

    if (popup) {
      setAuthPopup(popup);
      popup.focus();
    } else {
      window.open(loginUrl, "_blank");
    }
  };

  return (
    <div
      className="absolute inset-0"
      style={{ display: visible ? "block" : "none" }}
      data-testid={`frame-container-${app.id}`}
    >
      {suspectedBlocked && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <strong>{app.name}</strong> is taking a while to load — it may not
            allow opening inside the Workspace.
          </span>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={startEmbeddedLogin}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
            >
              Sign in
            </button>

            <a
              href={app.launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in new tab
            </a>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title={app.name}
        data-testid={`iframe-app-${app.id}`}
        className="h-full w-full border-0"
        onLoad={() => {
            setLoaded(true);
            setSuspectedBlocked(false);
        }}
        allow="clipboard-write"
      />
    </div>
  );
}

// function AppFrame({ app, visible }: { app: SidebarApp; visible: boolean }) {
//   const [suspectedBlocked, setSuspectedBlocked] = useState(false);
//   const [loaded, setLoaded] = useState(false);
//   const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

//   useEffect(() => {
//     timerRef.current = setTimeout(() => {
//       if (!loaded) setSuspectedBlocked(true);
//     }, IFRAME_LOAD_TIMEOUT_MS);
//     return () => clearTimeout(timerRef.current);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   return (
//     <div
//       className="absolute inset-0"
//       style={{ display: visible ? "block" : "none" }}
//       data-testid={`frame-container-${app.id}`}
//     >
//       {suspectedBlocked && (
//         <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
//           <span className="flex items-center gap-2">
//             <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
//             <strong>{app.name}</strong> is taking a while to load — it may not
//             allow opening inside the Workspace.
//           </span>
//           <a
//             href={app.launchUrl}
//             target="_blank"
//             rel="noopener noreferrer"
//             className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
//           >
//             <ExternalLink className="h-3.5 w-3.5" />
//             Open in new tab instead
//           </a>
//         </div>
//       )}
//       <iframe
//         src={app.launchUrl}
//         title={app.name}
//         data-testid={`iframe-app-${app.id}`}
//         className="h-full w-full border-0"
//         onLoad={() => {
//           setLoaded(true);
//           setSuspectedBlocked(false);
//         }}
//         // Deliberately no `sandbox` attribute: these are trusted, first-party
//         // organizational apps (not arbitrary third-party content), and they
//         // need normal cookie/storage/navigation behavior for their own
//         // Entra ID session to work — sandboxing would break that.
//         allow="clipboard-write"
//       />
//     </div>
//   );
// }
