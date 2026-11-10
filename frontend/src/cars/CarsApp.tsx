// DriveCheap root (spec 022 R1, 023, 025 R1): routes under /drive-cheap/* plus
// the state provider. Mounted from AppRoutes and loaded on demand.

import { Navigate, Route, Routes } from "react-router-dom";

import { DRIVE_PATH } from "../lib/productRoutes";
import CarsHeader from "./components/CarsHeader";
import type { CarState } from "./lib/profile";
import Checklist from "./screens/Checklist";
import CompareCurves from "./screens/CompareCurves";
import CompareTable from "./screens/CompareTable";
import MarketMap from "./screens/MarketMap";
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
            <Route path="market" element={<MarketMap />} />
            <Route path="checklist" element={<Checklist />} />
            <Route path="compare" element={<CompareTable />} />
            <Route path="compare/curves" element={<CompareCurves />} />
            <Route path="option/:optionId" element={<OptionDetail />} />
            <Route path="*" element={<Navigate to={DRIVE_PATH} replace />} />
          </Routes>
        </main>
      </div>
    </CarStateProvider>
  );
}
