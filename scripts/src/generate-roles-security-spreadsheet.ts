import path from "path";
import fs from "fs";
import { pool } from "@workspace/db";
import {
  buildPermissionMatrixWorkbook,
  PERMISSION_MATRIX_FILENAME,
} from "@workspace/permission-matrix";

async function main() {
  const wb = await buildPermissionMatrixWorkbook();
  const outDir = path.resolve("exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, PERMISSION_MATRIX_FILENAME);
  await wb.xlsx.writeFile(outPath);
  console.log(`Written: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
