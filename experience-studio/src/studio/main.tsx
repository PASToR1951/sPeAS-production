import "@uppy/dashboard/css/style.min.css";
import React from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import App from "./App";

const root = document.getElementById("experience-studio-root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
