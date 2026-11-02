import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// The app is light-only: clear dark-mode state saved by earlier versions
document.documentElement.classList.remove("dark");
try {
  localStorage.removeItem("sc-theme");
} catch {}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
