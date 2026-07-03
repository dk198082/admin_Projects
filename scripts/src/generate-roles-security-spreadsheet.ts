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
  "Full (CRUD)",
  "Create/Edit",
  "Edit Own",
  "Read Only",
  "No Access",
];

type ItemRow = {
  item: string;
  type: "Form" | "Table";
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

const F = "Full (CRUD)";
const CE = "Create/Edit";
const EO = "Edit Own";
const RO = "Read Only";
const NA = "No Access";

const apps: AppSection[] = [
  {
    name: "PRODUCTION SHOP FLOOR",
    items: [
      { item: "Work Order Form", type: "Form", description: "Create and update production work orders", access: [F, CE, RO, CE, CE] },
      { item: "Production Schedule Form", type: "Form", description: "Plan and adjust production runs by line/shift", access: [F, CE, RO, CE, F] },
      { item: "Downtime Report Form", type: "Form", description: "Log machine downtime and causes", access: [F, CE, CE, RO, CE] },
      { item: "Quality Check Form", type: "Form", description: "Record quality inspections and results", access: [F, CE, RO, RO, RO] },
      { item: "Material Request Form", type: "Form", description: "Request materials for production jobs", access: [F, CE, CE, CE, CE] },
      { item: "Shift Handover Form", type: "Form", description: "Document shift-to-shift handover notes", access: [F, CE, CE, RO, CE] },
      { item: "Work Orders Table", type: "Table", description: "Master list of all work orders and statuses", access: [F, CE, RO, CE, CE] },
      { item: "Machines / Equipment Table", type: "Table", description: "Equipment registry, status, and maintenance info", access: [F, CE, RO, RO, RO] },
      { item: "Production Schedule Table", type: "Table", description: "Scheduled runs by date, line, and shift", access: [F, CE, RO, CE, F] },
      { item: "Downtime Log Table", type: "Table", description: "History of downtime events", access: [F, RO, RO, RO, RO] },
      { item: "Quality Results Table", type: "Table", description: "Inspection outcomes and defect records", access: [F, RO, RO, RO, RO] },
      { item: "Materials / Inventory Table", type: "Table", description: "Raw material stock levels and locations", access: [F, CE, RO, CE, RO] },
      { item: "Operators / Shifts Table", type: "Table", description: "Operator roster and shift assignments", access: [F, CE, RO, RO, CE] },
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
      { item: "Service Request Form", type: "Form", description: "Log new customer service requests", access: [F, CE, F, RO, RO] },
      { item: "Appointment Booking Form", type: "Form", description: "Schedule and assign service visits", access: [F, CE, F, RO, CE] },
      { item: "Job Completion Form", type: "Form", description: "Record work performed and close out jobs", access: [F, CE, CE, RO, RO] },
      { item: "Time & Parts Form", type: "Form", description: "Log labor hours and parts used per job", access: [F, CE, CE, RO, RO] },
      { item: "Customer Sign-off Form", type: "Form", description: "Capture customer approval/signature", access: [F, RO, CE, NA, NA] },
      { item: "Service Calendar Table", type: "Table", description: "Calendar of all scheduled appointments", access: [F, CE, F, RO, CE] },
      { item: "Technicians Table", type: "Table", description: "Technician roster, skills, and availability", access: [F, CE, CE, RO, RO] },
      { item: "Customers Table", type: "Table", description: "Customer contact and site information", access: [F, CE, CE, RO, RO] },
      { item: "Equipment / Assets Table", type: "Table", description: "Customer equipment under service", access: [F, CE, CE, RO, RO] },
      { item: "Service History Table", type: "Table", description: "Completed visits and outcomes", access: [F, RO, RO, RO, RO] },
      { item: "Parts Inventory Table", type: "Table", description: "Van and warehouse parts stock", access: [F, CE, CE, RO, NA] },
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
    "Access levels: Full (CRUD) = create/read/update/delete · Create/Edit = add & modify · Edit Own = modify own records only · Read Only · No Access. Change any cell using its dropdown.";
  legend.font = { italic: true, size: 10, color: { argb: "FF595959" } };
  legend.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gray } };
  legend.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(2).height = 28;

  let row = 4;
  const accessCellRanges: string[] = [];

  const accessFill = (v: string) => {
    switch (v) {
      case "Full (CRUD)": return green;
      case "Create/Edit": return lightBlue;
      case "Edit Own": return yellow;
      case "Read Only": return orange;
      case "No Access": return red;
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
    const headers = ["Form / Table", "Type", "Description", ...ROLES];
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
