import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

const ROLES = [
  "Admin",
  "Manager",
  "Coordinator (Dispatcher)",
  "Production Planner",
  "Shop Floor Scheduler",
];

const ACCESS_LEVELS = [
  "Full Rights",
  "Read & Write",
  "View",
];

type ItemRow = {
  item: string;
  type: "Form" | "Tab" | "Table";
  description: string;
  access: string[]; // one per role, same order as ROLES
};

type SecurityRow = {
  setting: string;
  value: string;
  notes: string;
};

type AppSection = {
  name: string;
  items: ItemRow[];
  security: SecurityRow[];
};

const F = "Full Rights";
const RW = "Read & Write";
const V = "View";

const apps: AppSection[] = [
  {
    name: "ADMIN CONSOLE (ALL APPS)",
    items: [
      { item: "User Management Tab", type: "Tab", description: "Create, edit, disable users across all apps", access: [F, V, V, V, V] },
      { item: "Roles & Permissions Tab", type: "Tab", description: "Manage roles and access grants for all apps", access: [F, V, V, V, V] },
      { item: "Security Settings Tab", type: "Tab", description: "Configure security policies per app (SSO, MFA, timeouts)", access: [F, V, V, V, V] },
      { item: "Audit Log Tab", type: "Tab", description: "Review all changes to users, roles, and permissions", access: [F, V, V, V, V] },
      { item: "New User Form", type: "Form", description: "Register a new user (name, email, status)", access: [F, V, V, V, V] },
      { item: "Role Assignment Form", type: "Form", description: "Assign one or more roles to a user (User \u00d7 Role)", access: [F, V, V, V, V] },
      { item: "Permission Grant Form", type: "Form", description: "Grant a role access to a resource at a permission level (Role \u00d7 Resource \u00d7 Level)", access: [F, V, V, V, V] },
      { item: "Security Policy Form", type: "Form", description: "Edit an app's security policy (auth, MFA, session, audit)", access: [F, V, V, V, V] },
      { item: "Users Table", type: "Table", description: "All users with status and assigned roles", access: [F, V, V, V, V] },
      { item: "Roles Table", type: "Table", description: "The five roles and their descriptions", access: [F, V, V, V, V] },
      { item: "Role Assignments Table", type: "Table", description: "User-to-role mappings (who has which role)", access: [F, V, V, V, V] },
      { item: "Access Grants Table", type: "Table", description: "Role \u00d7 Resource \u00d7 Permission Level matrix (mirrors this spreadsheet)", access: [F, V, V, V, V] },
      { item: "Resources Table", type: "Table", description: "All forms, tabs, and tables registered per app", access: [F, V, V, V, V] },
      { item: "Permission Levels Table", type: "Table", description: "Full Rights / Read & Write / View definitions", access: [F, V, V, V, V] },
      { item: "Security Policies Table", type: "Table", description: "Per-app security policy settings", access: [F, V, V, V, V] },
      { item: "Audit Log Table", type: "Table", description: "History of all admin actions (who changed what, when)", access: [F, V, V, V, V] },
    ],
    security: [
      { setting: "Who can access", value: "Admin role only (managers view-only)", notes: "All other roles: View at most; no edit rights anywhere in the console" },
      { setting: "Multi-factor authentication (MFA)", value: "Always required", notes: "No exceptions for admin console access" },
      { setting: "Session timeout", value: "15 minutes idle", notes: "Stricter than the apps it manages" },
      { setting: "Approval workflow", value: "Admin role assignment needs a second Admin", notes: "Prevents a single admin from escalating privileges alone" },
      { setting: "Audit logging", value: "Enabled - every action logged, immutable", notes: "Audit log is read-only even for Admin; retained 24 months" },
      { setting: "Scope", value: "Cross-app: governs both apps below", notes: "Changes here apply to Production Shop Floor and Field Service Calendar" },
    ],
  },
  {
    name: "PRODUCTION SHOP FLOOR",
    items: [
      { item: "Dashboard Tab", type: "Tab", description: "Overview of production status and KPIs", access: [F, RW, V, V, V] },
      { item: "Scheduling Tab", type: "Tab", description: "Production scheduling workspace", access: [F, RW, V, RW, F] },
      { item: "Reports Tab", type: "Tab", description: "Production, downtime, and quality reports", access: [F, RW, V, V, V] },
      { item: "Work Order Form", type: "Form", description: "Create and update production work orders", access: [F, RW, V, RW, RW] },
      { item: "Production Schedule Form", type: "Form", description: "Plan and adjust production runs by line/shift", access: [F, RW, V, RW, F] },
      { item: "Downtime Report Form", type: "Form", description: "Log machine downtime and causes", access: [F, RW, RW, V, RW] },
      { item: "Quality Check Form", type: "Form", description: "Record quality inspections and results", access: [F, RW, V, V, V] },
      { item: "Material Request Form", type: "Form", description: "Request materials for production jobs", access: [F, RW, RW, RW, RW] },
      { item: "Shift Handover Form", type: "Form", description: "Document shift-to-shift handover notes", access: [F, RW, RW, V, RW] },
      { item: "Work Orders Table", type: "Table", description: "Master list of all work orders and statuses", access: [F, RW, V, RW, RW] },
      { item: "Machines / Equipment Table", type: "Table", description: "Equipment registry, status, and maintenance info", access: [F, RW, V, V, V] },
      { item: "Production Schedule Table", type: "Table", description: "Scheduled runs by date, line, and shift", access: [F, RW, V, RW, F] },
      { item: "Downtime Log Table", type: "Table", description: "History of downtime events", access: [F, V, V, V, V] },
      { item: "Quality Results Table", type: "Table", description: "Inspection outcomes and defect records", access: [F, V, V, V, V] },
      { item: "Materials / Inventory Table", type: "Table", description: "Raw material stock levels and locations", access: [F, RW, V, RW, V] },
      { item: "Operators / Shifts Table", type: "Table", description: "Operator roster and shift assignments", access: [F, RW, V, V, RW] },
    ],
    security: [
      { setting: "Authentication method", value: "SSO (company login)", notes: "All users sign in with company credentials" },
      { setting: "Multi-factor authentication (MFA)", value: "Required for Admin & Manager", notes: "Optional for other roles" },
      { setting: "Session timeout", value: "30 minutes idle", notes: "Shared shop floor terminals: 10 minutes" },
      { setting: "Record-level access", value: "By plant / production line", notes: "Users only see lines they are assigned to" },
      { setting: "Field-level restrictions", value: "Cost fields hidden from non-managers", notes: "Labor and material cost columns" },
      { setting: "Approval workflow", value: "Schedule changes need Manager approval", notes: "Applies to published schedules only" },
      { setting: "Audit logging", value: "Enabled - all create/edit/delete", notes: "Retained 12 months" },
      { setting: "Data export", value: "Admin & Manager only", notes: "CSV/Excel export of tables" },
    ],
  },
  {
    name: "FIELD SERVICE CALENDAR",
    items: [
      { item: "Calendar Tab", type: "Tab", description: "Main scheduling calendar view", access: [F, RW, F, V, RW] },
      { item: "Dispatch Board Tab", type: "Tab", description: "Assign and track technician jobs", access: [F, RW, F, V, V] },
      { item: "Reports Tab", type: "Tab", description: "Service performance and history reports", access: [F, RW, V, V, V] },
      { item: "Service Request Form", type: "Form", description: "Log new customer service requests", access: [F, RW, F, V, V] },
      { item: "Appointment Booking Form", type: "Form", description: "Schedule and assign service visits", access: [F, RW, F, V, RW] },
      { item: "Job Completion Form", type: "Form", description: "Record work performed and close out jobs", access: [F, RW, RW, V, V] },
      { item: "Time & Parts Form", type: "Form", description: "Log labor hours and parts used per job", access: [F, RW, RW, V, V] },
      { item: "Customer Sign-off Form", type: "Form", description: "Capture customer approval/signature", access: [F, V, RW, V, V] },
      { item: "Service Calendar Table", type: "Table", description: "Calendar of all scheduled appointments", access: [F, RW, F, V, RW] },
      { item: "Technicians Table", type: "Table", description: "Technician roster, skills, and availability", access: [F, RW, RW, V, V] },
      { item: "Customers Table", type: "Table", description: "Customer contact and site information", access: [F, RW, RW, V, V] },
      { item: "Equipment / Assets Table", type: "Table", description: "Customer equipment under service", access: [F, RW, RW, V, V] },
      { item: "Service History Table", type: "Table", description: "Completed visits and outcomes", access: [F, V, V, V, V] },
      { item: "Parts Inventory Table", type: "Table", description: "Van and warehouse parts stock", access: [F, RW, RW, V, V] },
    ],
    security: [
      { setting: "Authentication method", value: "SSO (company login)", notes: "Field techs may use mobile app login" },
      { setting: "Multi-factor authentication (MFA)", value: "Required for Admin & Manager", notes: "Recommended for Coordinator" },
      { setting: "Session timeout", value: "60 minutes idle (mobile)", notes: "Web sessions: 30 minutes" },
      { setting: "Record-level access", value: "By service region / territory", notes: "Coordinators see their region only" },
      { setting: "Field-level restrictions", value: "Customer billing info hidden from techs", notes: "Visible to Admin & Manager only" },
      { setting: "Approval workflow", value: "Cancellations need Coordinator approval", notes: "Same-day changes flagged to Manager" },
      { setting: "Audit logging", value: "Enabled - all create/edit/delete", notes: "Retained 12 months" },
      { setting: "Data export", value: "Admin & Manager only", notes: "Customer data export requires Admin" },
    ],
  },
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Roles & Security Setup";
  const ws = wb.addWorksheet("Roles & Security Matrix", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const NUM_COLS = 3 + ROLES.length; // Item, Type, Description + roles

  ws.columns = [
    { width: 32 },
    { width: 10 },
    { width: 48 },
    ...ROLES.map(() => ({ width: 22 })),
  ];

  const navy = "FF1F3864";
  const blue = "FF2F5496";
  const lightBlue = "FFD9E2F3";
  const gray = "FFF2F2F2";
  const green = "FFC6EFCE";
  const yellow = "FFFFF2CC";
  const orange = "FFFCE4D6";
  const red = "FFF8CBAD";

  const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

  // Title row
  ws.mergeCells(1, 1, 1, NUM_COLS);
  const title = ws.getCell(1, 1);
  title.value = "Application Roles & Security Setup — Permission Matrix";
  title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // Subtitle / legend row
  ws.mergeCells(2, 1, 2, NUM_COLS);
  const legend = ws.getCell(2, 1);
  legend.value =
    "Permission levels: Full Rights = full control (create/read/update/delete & settings) · Read & Write = view and edit records · View = read-only access. Change any cell using its dropdown.";
  legend.font = { italic: true, size: 10, color: { argb: "FF595959" } };
  legend.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gray } };
  legend.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(2).height = 28;

  let row = 4;
  const accessCellRanges: string[] = [];

  const accessFill = (v: string) => {
    switch (v) {
      case "Full Rights": return green;
      case "Read & Write": return lightBlue;
      case "View": return orange;
      default: return gray;
    }
  };

  for (const app of apps) {
    // App section header
    ws.mergeCells(row, 1, row, NUM_COLS);
    const appCell = ws.getCell(row, 1);
    appCell.value = app.name;
    appCell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    appCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } };
    appCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(row).height = 24;
    row++;

    // Matrix header
    const headers = ["Form / Tab / Table", "Type", "Description", ...ROLES];
    headers.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = allBorders;
    });
    ws.getRow(row).height = 26;
    row++;

    const firstDataRow = row;
    for (const it of app.items) {
      ws.getCell(row, 1).value = it.item;
      ws.getCell(row, 2).value = it.type;
      ws.getCell(row, 3).value = it.description;
      ws.getCell(row, 1).font = { bold: true, size: 10 };
      ws.getCell(row, 2).alignment = { horizontal: "center" };
      ws.getCell(row, 2).font = { size: 10 };
      ws.getCell(row, 3).font = { size: 10, color: { argb: "FF595959" } };
      for (let i = 0; i < ROLES.length; i++) {
        const c = ws.getCell(row, 4 + i);
        c.value = it.access[i];
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.font = { size: 10 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accessFill(it.access[i]) } };
      }
      for (let col = 1; col <= NUM_COLS; col++) {
        ws.getCell(row, col).border = allBorders;
      }
      if ((row - firstDataRow) % 2 === 1) {
        for (let col = 1; col <= 3; col++) {
          ws.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: gray } };
        }
      }
      row++;
    }
    const lastDataRow = row - 1;
    accessCellRanges.push(
      `${ws.getCell(firstDataRow, 4).address}:${ws.getCell(lastDataRow, 3 + ROLES.length).address}`
    );

    row++; // spacer

    // Security setup sub-section
    ws.mergeCells(row, 1, row, NUM_COLS);
    const secHdr = ws.getCell(row, 1);
    secHdr.value = `${app.name} — SECURITY SETUP`;
    secHdr.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    secHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF548235" } };
    secHdr.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(row).height = 20;
    row++;

    const secHeaders = ["Security Setting", "", "Policy / Value"];
    ws.getCell(row, 1).value = secHeaders[0];
    ws.mergeCells(row, 3, row, 5);
    ws.getCell(row, 3).value = "Policy / Value";
    ws.mergeCells(row, 6, row, NUM_COLS);
    ws.getCell(row, 6).value = "Notes";
    for (const col of [1, 3, 6]) {
      const c = ws.getCell(row, col);
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF70AD47" } };
      c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    }
    for (let col = 1; col <= NUM_COLS; col++) ws.getCell(row, col).border = allBorders;
    row++;

    for (const s of app.security) {
      ws.mergeCells(row, 1, row, 2);
      ws.getCell(row, 1).value = s.setting;
      ws.getCell(row, 1).font = { bold: true, size: 10 };
      ws.mergeCells(row, 3, row, 5);
      ws.getCell(row, 3).value = s.value;
      ws.getCell(row, 3).font = { size: 10 };
      ws.getCell(row, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: yellow } };
      ws.mergeCells(row, 6, row, NUM_COLS);
      ws.getCell(row, 6).value = s.notes;
      ws.getCell(row, 6).font = { size: 10, italic: true, color: { argb: "FF595959" } };
      for (let col = 1; col <= NUM_COLS; col++) ws.getCell(row, col).border = allBorders;
      row++;
    }

    row += 2; // gap between apps
  }

  // Data validation dropdowns for all access cells
  const listFormula = `"${ACCESS_LEVELS.join(",")}"`;
  for (const range of accessCellRanges) {
    const [start, end] = range.split(":");
    const startCell = ws.getCell(start);
    const endCell = ws.getCell(end);
    for (let r = Number(startCell.row); r <= Number(endCell.row); r++) {
      for (let c = Number(startCell.col); c <= Number(endCell.col); c++) {
        ws.getCell(r, c).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [listFormula],
          showErrorMessage: true,
          errorTitle: "Invalid access level",
          error: "Pick one of the access levels from the dropdown.",
        };
      }
    }
  }

  // Print setup
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };

  const outDir = path.resolve("exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "apps-roles-security-setup.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`Written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
