import ExcelJS from "exceljs";
import { asc } from "drizzle-orm";
import {
  db,
  appsTable,
  rolesTable,
  resourcesTable,
  accessGrantsTable,
  securityPoliciesTable,
} from "@workspace/db";

const ACCESS_LEVELS = ["Full Rights", "Read & Write", "View"];

type ItemRow = {
  item: string;
  type: string;
  description: string;
  access: string[];
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

async function loadData(): Promise<{ roles: string[]; apps: AppSection[] }> {
  const [appRows, roleRows, resourceRows, grantRows, policyRows] = await Promise.all([
    db.select().from(appsTable).orderBy(asc(appsTable.id)),
    db.select().from(rolesTable).orderBy(asc(rolesTable.id)),
    db.select().from(resourcesTable).orderBy(asc(resourcesTable.id)),
    db.select().from(accessGrantsTable),
    db.select().from(securityPoliciesTable),
  ]);

  const grantByResourceRole = new Map<string, string>();
  for (const g of grantRows) {
    grantByResourceRole.set(`${g.resourceId}:${g.roleId}`, g.level);
  }
  const policyByAppId = new Map(policyRows.map((p) => [p.appId, p]));

  const apps: AppSection[] = appRows.map((app) => {
    const items: ItemRow[] = resourceRows
      .filter((r) => r.appId === app.id)
      .map((r) => ({
        item: r.name,
        type: r.type,
        description: r.description,
        access: roleRows.map(
          (role) => grantByResourceRole.get(`${r.id}:${role.id}`) ?? "No Access",
        ),
      }));

    const p = policyByAppId.get(app.id);
    const security: SecurityRow[] = p
      ? [
          { setting: "Authentication method", value: p.authMethod, notes: "" },
          { setting: "Multi-factor authentication (MFA)", value: p.mfaRequired, notes: "" },
          {
            setting: "Session timeout",
            value: `${p.sessionTimeoutMinutes} minutes idle`,
            notes: "",
          },
          { setting: "Record-level access", value: p.recordLevelScope, notes: "" },
          { setting: "Field-level restrictions", value: p.fieldLevelRules, notes: "" },
          {
            setting: "Audit logging",
            value: p.auditLogging ? "Enabled - all create/edit/delete" : "Disabled",
            notes: "",
          },
          { setting: "Data export", value: p.dataExportPolicy, notes: "" },
        ]
      : [];

    return { name: app.name.toUpperCase(), items, security };
  });

  return { roles: roleRows.map((r) => r.name), apps };
}

export async function buildPermissionMatrixWorkbook(): Promise<ExcelJS.Workbook> {
  const { roles: ROLES, apps } = await loadData();

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

    if (app.items.length === 0) {
      ws.mergeCells(row, 1, row, NUM_COLS);
      const c = ws.getCell(row, 1);
      c.value = "No resources registered yet — add Forms/Tabs/Tables via Manage Resources in the Admin Console.";
      c.font = { italic: true, size: 10, color: { argb: "FF595959" } };
      c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      for (let col = 1; col <= NUM_COLS; col++) ws.getCell(row, col).border = allBorders;
      row++;
    }

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
    if (lastDataRow >= firstDataRow) {
      accessCellRanges.push(
        `${ws.getCell(firstDataRow, 4).address}:${ws.getCell(lastDataRow, 3 + ROLES.length).address}`
      );
    }

    row++; // spacer

    // Security setup sub-section
    if (app.security.length > 0) {
      ws.mergeCells(row, 1, row, NUM_COLS);
      const secHdr = ws.getCell(row, 1);
      secHdr.value = `${app.name} — SECURITY SETUP`;
      secHdr.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      secHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF548235" } };
      secHdr.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(row).height = 20;
      row++;

      ws.getCell(row, 1).value = "Security Setting";
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

  return wb;
}

export async function buildPermissionMatrixBuffer(): Promise<Buffer> {
  const wb = await buildPermissionMatrixWorkbook();
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

export const PERMISSION_MATRIX_FILENAME = "apps-roles-security-setup.xlsx";
