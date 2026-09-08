# Digital Workspace — Workflows & Architecture Mapping

This document has two parts: (1) how what was built maps against the
reference architecture picture supplied for this project, box by box, so
it's clear what's a direct match versus a documented gap; and (2) the
actual end-to-end workflows — as diagrams, not prose — for every process a
user or administrator goes through.

## Part 1 — Architecture mapping

Reference architecture: **Digital Workspace Shell → Independent Business
Applications → Shared Services Layer → ERP/Data Foundation.**

```mermaid
flowchart TB
    subgraph L1["1. Digital Workspace Shell"]
        direction LR
        L1a["App shell / portal<br/>✅ BUILT"]
        L1b["SSO (Entra ID)<br/>✅ BUILT"]
        L1c["Role Based Access<br/>✅ BUILT"]
        L1d["Global Navigation<br/>✅ BUILT"]
        L1e["Global Search<br/>⚠️ PARTIAL — filters your own tiles only"]
        L1f["Notifications / My Profile /<br/>Themes & Branding / User Prefs<br/>❌ NOT BUILT"]
    end

    subgraph L2["2. Independent Business Applications"]
        direction LR
        L2a["Field Service Schedule<br/>✅ Field Service Calendar"]
        L2b["Admin / Configuration<br/>✅ Admin Console"]
        L2c["Case Mgmt / Sales-Orders /<br/>Customer Assets / Reporting<br/>❌ DON'T EXIST YET"]
    end

    subgraph L3["3. Shared Services Layer"]
        direction LR
        L3a["Auth & Identity<br/>✅ BUILT — Entra ID + entitlement API"]
        L3b["Data Services<br/>⚠️ PARTIAL — each app has its own DB,<br/>no shared data-access layer"]
        L3c["API Gateway / Business Rules &<br/>Workflows / Notifications /<br/>Search Service<br/>❌ NOT BUILT"]
        L3d["Service Discovery / Centralized<br/>Logging / Monitoring / Security &<br/>Compliance / Secrets Mgmt<br/>❌ NOT BUILT as a unified layer"]
    end

    subgraph L4["4. ERP / Data Foundation"]
        direction LR
        L4a["Dynamics 365 F&O<br/>✅ Already integrated (pre-existing)"]
        L4b["Microsoft Graph<br/>✅ Already integrated (pre-existing)"]
        L4c["Dataverse / Azure SQL /<br/>External Systems<br/>❌ N/A — this workspace uses<br/>Azure Postgres, not these"]
    end

    L1 --> L2 --> L3 --> L4
```

### What this means in practice

- **What you can rely on today:** sign in once, see only your apps, open
  any of them without a second login. That's the whole top-of-picture
  promise, delivered and verified (see `TECHNICAL_DESIGN.md` §9).
- **What's a real, called-out gap, not an oversight:** there is no API
  gateway, no shared workflow/notification/search engine, and no unified
  logging/monitoring/secrets platform. Every app still talks to its own
  database and exposes its own API directly. If any of the Shared Services
  Layer boxes are needed for a later phase, they're additive on top of what
  exists — nothing built here would need to be redone.
- **The app tiles in the picture are illustrative**, not literal — "Case
  Management," "Sales/Orders," and "Customer Assets" don't exist as
  applications in this workspace. The three real apps are Field Service
  Calendar, Production Calendar, and the Admin Console.

## Part 2 — End-to-end workflows

### 2.1 First-time user sign-in and app launch

```mermaid
flowchart TD
    A["User navigates to the workspace URL"] --> B{"Signed in already?"}
    B -->|No| C["Shell shows Landing page"]
    C --> D["User clicks 'Sign in with Microsoft'"]
    D --> E["Redirect to Entra ID"]
    E --> F{"Existing Entra SSO<br/>session in this browser?"}
    F -->|No| G["Real Microsoft login form<br/>(+ MFA if tenant requires it)"]
    F -->|Yes| H["Entra returns immediately —<br/>no form shown"]
    G --> I["Entra sets its own tenant-wide<br/>session cookie"]
    H --> J
    I --> J["Redirect back to the Shell<br/>with an auth code"]
    J --> K["Shell exchanges the code,<br/>sets its OWN session cookie"]
    K --> L["Shell calls GET /api/my-apps"]
    L --> M{"Any apps returned?"}
    M -->|No| N["Empty state:<br/>'No applications yet'"]
    M -->|Yes| O["Tiles rendered,<br/>grouped by category"]
    B -->|Yes| O
    O --> P["User clicks a tile"]
    P --> Q["Browser navigates to that<br/>app's own URL"]
    Q --> R{"Local session for<br/>THIS app already valid?"}
    R -->|Yes| S["App's home page loads —<br/>no redirect at all"]
    R -->|No| T["App redirects to ITS OWN<br/>/api/auth/login"]
    T --> F2{"Existing Entra SSO<br/>session? (see F above)"} 
    F2 -->|Yes, still valid| U["Silent redirect back —<br/>no visible login form"]
    F2 -->|Expired/revoked| G
    U --> V["App establishes its own<br/>session, shows its home page"]
```

### 2.2 Administrator onboards a new application

(Full step-by-step detail lives in `ADDING_NEW_APPS.md` — this is the same
process as a flow.)

```mermaid
flowchart TD
    A["New app is built with its own<br/>Entra ID login + /api/access-check<br/>integration"] --> B["Register the app in Entra ID<br/>— SAME tenant as every other app"]
    B --> C["Deploy the app to Azure<br/>(its own resource)"]
    C --> D["Admin Console → Security →<br/>Add App"]
    D --> E["App row created —<br/>NOT visible in Workspace yet<br/>(no launchUrl set)"]
    E --> F["Permissions → create role(s)<br/>for the new app"]
    F --> G["Assign the role to users<br/>who should have access"]
    G --> H["Still not visible —<br/>role assignment alone isn't enough"]
    H --> I["Security → Workspace Tiles →<br/>Edit tile → set Launch URL,<br/>icon, category, description"]
    I --> J["Save"]
    J --> K["Tile now appears for every user<br/>with a role assignment,<br/>next time they load the Workspace —<br/>NO Shell redeploy needed"]
```

### 2.3 Revoking a user's access

```mermaid
flowchart TD
    A["Administrator removes a user's<br/>role assignment for App X"] --> B["User's role_assignments row<br/>for App X is deleted"]
    B --> C{"User reloads<br/>the Workspace?"}
    C -->|Yes| D["GET /api/my-apps no longer<br/>includes App X — tile disappears"]
    C -->|"No — session<br/>still open"| E["Tile may still be visible in<br/>an already-loaded browser tab<br/>until the next reload"]
    D --> F["User navigates directly to<br/>App X's URL anyway (bookmark, etc.)"]
    E --> F
    F --> G["App X calls its OWN<br/>/api/access-check"]
    G --> H["Admin Console reports:<br/>no active role for this user"]
    H --> I["App X denies access —<br/>this is the REAL security boundary,<br/>independent of the Shell's tile list"]
```

### 2.4 Tile visibility decision (what determines whether a tile shows)

```mermaid
flowchart TD
    A["Does the app have a<br/>launchUrl set?"] -->|No| Z["Never shown to anyone,<br/>regardless of role assignments"]
    A -->|Yes| B["Does the signed-in user<br/>hold at least one role<br/>for this app?"]
    B -->|No| Z2["Not shown to this user"]
    B -->|Yes| C["Is the user's directory<br/>record status = active?"]
    C -->|No| Z3["Not shown — empty apps list<br/>returned, not an error"]
    C -->|Yes| Y["Tile shown, grouped by<br/>the app's category"]
```

### 2.5 What happens if `/api/my-apps` fails

```mermaid
flowchart TD
    A["Shell calls GET /api/my-apps"] --> B{"Response"}
    B -->|"401 — no session"| C["Show Landing page<br/>(user isn't actually signed in)"]
    B -->|"200, apps: []"| D["Show 'No applications yet' —<br/>legitimate, expected state"]
    B -->|"200, apps: [...]"| E["Render tiles"]
    B -->|"Network error / 5xx"| F["Show explicit error message —<br/>never a blank or silently<br/>broken page (per NFR-3)"]
```
