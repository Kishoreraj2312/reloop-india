import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DemoBadge } from "./demo/DemoBadge";
import "./ui/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <DemoBadge />
  </StrictMode>,
);
