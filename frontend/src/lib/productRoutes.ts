// Product URLs and the little state that crosses between products (spec 025).
// Last-used searches stay in module memory on purpose: map URLs contain work
// coordinates, so they are never written to storage (R8).

import { BRAND_NAME } from "../config";

export const LANDING_PATH = "/";
export const MAP_PATH = "/live-near";
export const DRIVE_PATH = "/drive-cheap";

export const MAP_NAME = BRAND_NAME;
export const DRIVE_NAME = "DriveCheap";
export const SITE_NAME = `${MAP_NAME} & ${DRIVE_NAME}`;

export function drivePath(sub = ""): string {
  return `${DRIVE_PATH}${sub}`;
}

// Case-insensitive, matching how the router itself matches paths.
export const isMapPath = (pathname: string): boolean => /^\/live-near\/?$/i.test(pathname);
export const isDrivePath = (pathname: string): boolean => /^\/drive-cheap(\/|$)/i.test(pathname);
export const isDriveForm = (pathname: string): boolean => /^\/drive-cheap\/?$/i.test(pathname);

/** Old `/cars` location under its new base; encoding is left untouched (R3). */
export function legacyCarsPath(pathname: string): string {
  return pathname.replace(/^\/cars(?=\/|$)/i, DRIVE_PATH);
}

export function titleForPath(pathname: string): string {
  if (isMapPath(pathname)) return MAP_NAME;
  if (isDrivePath(pathname)) return DRIVE_NAME;
  return SITE_NAME;
}

let lastMapSearch = "";
let lastDriveSearch = "";
let mapMounted = false;

export function rememberMapSearch(search: string): void {
  lastMapSearch = search;
}

export function rememberDriveSearch(search: string): void {
  lastDriveSearch = search;
}

export function rememberedDriveSearch(): string {
  return lastDriveSearch;
}

export const mapHref = (): string => `${MAP_PATH}${lastMapSearch}`;
export const driveHref = (): string => `${DRIVE_PATH}${lastDriveSearch}`;

/** True once the map has mounted in this page load (R10). Read during render,
 * set from an effect, so StrictMode's double render can't consume it. */
export const mapHasMounted = (): boolean => mapMounted;

export function markMapMounted(): void {
  mapMounted = true;
}

// A route change can land while the old screen is still mounted (the next
// product's chunk is loading), so URL writers check they still own the URL (R9).
function replaceSearch(search: string): void {
  try {
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  } catch {
    /* history unavailable */
  }
}

export function replaceMapSearch(search: string): void {
  if (isMapPath(window.location.pathname)) replaceSearch(search);
}

export function replaceDriveSearch(search: string): void {
  if (isDrivePath(window.location.pathname)) replaceSearch(search);
}

export const loadMapApp = () => import("../App");
export const loadDriveApp = () => import("../cars/CarsApp");

/** Tests only: module state outlives a single render. */
export function resetProductRoutes(): void {
  lastMapSearch = "";
  lastDriveSearch = "";
  mapMounted = false;
}
