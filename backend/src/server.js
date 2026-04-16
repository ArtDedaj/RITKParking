import { createApp } from "./app.js";
import { config } from "./config.js";

const { app } = createApp();

app.listen(config.port, () => {
  console.log(`AUK Smart Parking backend running on http://localhost:${config.port}`);
});
