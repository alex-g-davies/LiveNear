import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import AppRoutes from "./AppRoutes";
import ErrorBoundary from "./components/ErrorBoundary";
import { initLanguage, subscribe, t } from "./i18n/core";
import "./styles.css";

function syncMetaDescription(): void {
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("common.meta.description"));
}

// Load the visitor's language before the first paint (spec 028 R2), so a
// Norwegian or Turkish page never flashes English. English needs no load.
void initLanguage().finally(() => {
  syncMetaDescription();
  subscribe(syncMetaDescription);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
});
