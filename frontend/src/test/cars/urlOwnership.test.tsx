// URL writers and saves across a product switch (spec 025 R8, R9).

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { loadState, URL_PARAM } from "../../cars/lib/profile";
import { CarStateProvider, useCarState } from "../../cars/state";
import {
  rememberedDriveSearch,
  replaceDriveSearch,
  replaceMapSearch,
  resetProductRoutes,
} from "../../lib/productRoutes";
import "./localStoragePolyfill";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
  };
});

function TickButton() {
  const { toggleChecklist } = useCarState();
  return <button onClick={() => toggleChecklist("item")}>tick</button>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/drive-cheap/market"]}>
      <CarStateProvider>
        <TickButton />
      </CarStateProvider>
    </MemoryRouter>,
  );
}

const goTo = (url: string) => window.history.pushState(null, "", url);

describe("URL ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetProductRoutes();
    window.localStorage.clear();
    goTo("/drive-cheap/market");
  });

  afterEach(() => {
    vi.useRealTimers();
    goTo("/");
  });

  it("map writer leaves other routes alone", () => {
    goTo("/drive-cheap?c=keep");
    replaceMapSearch("?state=OH");
    expect(window.location.search).toBe("?c=keep");
    goTo("/live-near");
    replaceMapSearch("?state=OH");
    expect(window.location.search).toBe("?state=OH");
  });

  it("car writer leaves other routes alone", () => {
    goTo("/live-near?state=OH");
    replaceDriveSearch("?c=x");
    expect(window.location.search).toBe("?state=OH");
  });

  it("a car save pending during a route change keeps off the new URL", () => {
    mount();
    act(() => screen.getByText("tick").click());
    goTo("/live-near?state=OH");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(window.location.search).toBe("?state=OH");
    expect(loadState()?.checklist).toEqual(["item"]);
    expect(new URLSearchParams(rememberedDriveSearch()).get(URL_PARAM)).toBeTruthy();
  });

  it("flushes a pending car save when leaving DriveCheap", () => {
    const { unmount } = mount();
    act(() => screen.getByText("tick").click());
    goTo("/live-near");
    unmount();
    expect(loadState()?.checklist).toEqual(["item"]);
    expect(window.location.search).toBe("");
  });

  it("remembers an unedited ?c= link for the way back", () => {
    goTo("/drive-cheap/market?c=abc");
    mount();
    expect(rememberedDriveSearch()).toBe("?c=abc");
  });
});
