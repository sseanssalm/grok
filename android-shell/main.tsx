import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BudgetApp } from "@/components/budget-app";
import "./fonts.css";
import "@/styles.css";
import "./native.css";

const root = document.getElementById("root");
if (!root) throw new Error("Keel is missing its root element.");

createRoot(root).render(
  <StrictMode>
    <BudgetApp />
  </StrictMode>,
);
