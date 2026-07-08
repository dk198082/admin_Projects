import { defineConfig } from "drizzle-kit";
import path from "path";
import { getDbUrlForTooling } from "./src/poolConfig";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: getDbUrlForTooling(),
  },
});
