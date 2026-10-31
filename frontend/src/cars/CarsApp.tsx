// Cars module root (spec 022 R1): routes under /cars/* plus the state
// provider. Mounted from main.tsx; the map app at / is untouched.

import { Navigate, Route, Routes } from "react-router-dom";

import CarsHeader from "./components/CarsHeader";
import type { CarState } from "./lib/profile";
import CompareCurves from "./screens/CompareCurves";
import CompareTable from "./screens/CompareTable";
import OptionDetail from "./screens/OptionDetail";
import Situation from "./screens/Situation";
import { CarStateProvider } from "./state";
import "./cars.css";

interface Props {
  /** Tests only: seed the provider instead of reading URL / localStorage. */
  initialState?: CarState;
}

export default function CarsApp({ initialState }: Props) {
  return (
    <CarStateProvider initialState={initialState}>
      <div className="cars">
        <CarsHeader />
        <main className="cars__main">
          <Routes>
            <Route index element={<Situation />} />
            <Route path="compare" element={<CompareTable />} />
            <Route path="compare/curves" element={<CompareCurves />} />
            <Route path="option/:optionId" element={<OptionDetail />} />
            <Route path="*" element={<Navigate to="/cars" replace />} />
          </Routes>
        </main>
      </div>
    </CarStateProvider>
  );
}
