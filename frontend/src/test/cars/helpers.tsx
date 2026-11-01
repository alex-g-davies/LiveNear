// Shared harness for the cars screen tests: CarsApp inside a MemoryRouter
// with a seeded state. The api module is mocked per test file (vi.mock must
// live in the test file to be hoisted), always with the fixture builder.

import "./localStoragePolyfill";

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import CarsApp from "../../cars/CarsApp";
import { DEFAULT_STATE, type CarState } from "../../cars/lib/profile";

export const SELECTION = [
  { variant_id: "tesla-model3-lr-rwd", year_from: 2021, year_to: 2026 },
  { variant_id: "renault-5-52", year_from: 2025, year_to: 2026 },
];

export const BASE_STATE: CarState = { ...DEFAULT_STATE, selection: SELECTION };

export function renderCars(path: string, state: CarState = BASE_STATE) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cars/*" element={<CarsApp initialState={state} />} />
      </Routes>
    </MemoryRouter>,
  );
}

export const WAIT = { timeout: 4000 };
