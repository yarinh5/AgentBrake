import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env"))
  console.log(".env already exists; keeping your settings.");
else {
  writeFileSync(
    ".env",
    `ADMIN_KEY=${randomBytes(32).toString("hex")}\nPORT=4310\nGITHUB_TOKEN=\nGITHUB_REPOSITORY=\nDATABASE_URL=\n`,
    { mode: 0o600 },
  );
  console.log(
    "Created .env. Use ADMIN_KEY to unlock the local dashboard. Keep this file outside agent workspaces.",
  );
}
