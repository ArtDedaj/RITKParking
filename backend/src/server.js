import { createApp } from "./app.js";
import { config } from "./config.js";

async function main() {
  const { app } = await createApp();
  app.listen(config.port, () => {
    console.log(`AUK Smart Parking (tutorial, MySQL) backend running on http://localhost:${config.port}`);
    console.log(`Connected to MySQL database: ${config.db.database} @ ${config.db.host}:${config.db.port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
