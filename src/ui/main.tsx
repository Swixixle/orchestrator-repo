import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReceiptInspector } from "./ReceiptInspector.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root mount node");
}

createRoot(container).render(
  <StrictMode>
    <ReceiptInspector />
  </StrictMode>
);
