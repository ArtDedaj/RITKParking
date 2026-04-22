import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.js";
import { config } from "./config.js";

const { app } = createApp();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// must respect environment: Railpack requirement
const PORT = process.env.PORT || config.port || 4000;

/**
Prod is conditional
 */
if (process.env.NODE_ENV === "production") {
  const frontendPath = path.join(__dirname, "../../frontend/dist");

  app.use(express.static(frontendPath));

  // SPA fallback (React Router support)
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(
    `AUK Smart Parking backend running on http://localhost:${PORT}`
  );
});