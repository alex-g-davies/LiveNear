import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "./App";
import CarsApp from "./cars/CarsApp";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// Two product surfaces (spec 022 R1): the map app owns `/` exactly as before;
// the Norway car TCO module lives under `/cars/*`.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/cars/*" element={<CarsApp />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
