// Site routing and redirects (spec 025 R1-R4, R12).

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import AppRoutes from "../AppRoutes";
import ProductSwitcher from "../components/ProductSwitcher";
import { rememberDriveSearch, rememberMapSearch, resetProductRoutes } from "../lib/productRoutes";

vi.mock("../App", () => ({ default: () => <div>map app</div> }));
vi.mock("../cars/CarsApp", () => ({ default: () => <div>drive app</div> }));

function CurrentUrl() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="url">{`${pathname}${search}${hash}`}</output>;
}

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <CurrentUrl />
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId("url").textContent;

describe("site routes", () => {
  beforeEach(() => resetProductRoutes());

  it("shows the landing page at / with one h1 and both products", () => {
    open("/");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Explore the map/ })).toHaveAttribute("href", "/live-near");
    expect(screen.getByRole("link", { name: /Compare car costs/ })).toHaveAttribute("href", "/drive-cheap");
    expect(document.title).toBe("LiveNear & DriveCheap");
  });

  it("sends an old shared map link to the map with its query", async () => {
    open("/?state=WA&min=30");
    expect(await screen.findByText("map app")).toBeInTheDocument();
    expect(url()).toBe("/live-near?state=WA&min=30");
    expect(document.title).toBe("LiveNear");
  });

  it("keeps the landing page when no map parameter is valid", () => {
    open("/?state=XXX&utm_source=mail");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(url()).toBe("/?state=XXX&utm_source=mail");
  });

  it("serves each product on its own path", async () => {
    open("/drive-cheap/market");
    expect(await screen.findByText("drive app")).toBeInTheDocument();
    expect(document.title).toBe("DriveCheap");
  });

  it.each([
    ["/cars", "/drive-cheap"],
    ["/cars/compare/curves", "/drive-cheap/compare/curves"],
    ["/cars/option/a%2Fb?c=x#y", "/drive-cheap/option/a%2Fb?c=x#y"],
    ["/cars/market?mock=1", "/drive-cheap/market?mock=1"],
    ["/CARS/market", "/drive-cheap/market"],
  ])("redirects %s to %s", async (from, to) => {
    open(from);
    expect(await screen.findByText("drive app")).toBeInTheDocument();
    expect(url()).toBe(to);
  });

  it("sends unknown paths home", async () => {
    open("/nope/deeper");
    await waitFor(() => expect(url()).toBe("/"));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("does not treat /carsharing as an old car link", async () => {
    open("/carsharing");
    await waitFor(() => expect(url()).toBe("/"));
  });
});

describe("ProductSwitcher", () => {
  beforeEach(() => resetProductRoutes());

  it("marks the current product and links to the other", () => {
    render(
      <MemoryRouter>
        <ProductSwitcher current="map" />
      </MemoryRouter>,
    );
    expect(screen.getByText("LiveNear")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "DriveCheap" })).toHaveAttribute("href", "/drive-cheap");
  });

  it("returns to where the user left each product", () => {
    rememberMapSearch("?state=OH");
    rememberDriveSearch("?c=token");
    const { unmount } = render(
      <MemoryRouter>
        <ProductSwitcher current="map" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "DriveCheap" })).toHaveAttribute("href", "/drive-cheap?c=token");
    unmount();
    render(
      <MemoryRouter>
        <ProductSwitcher current="drive" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "LiveNear" })).toHaveAttribute("href", "/live-near?state=OH");
  });
});
