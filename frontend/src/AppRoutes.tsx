// Site routes (spec 025): landing page at `/`, each product on its own path
// and loaded on demand, and redirects that keep every older link working.

import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import Landing from "./components/Landing";
import {
  DRIVE_PATH,
  LANDING_PATH,
  MAP_PATH,
  legacyCarsPath,
  loadDriveApp,
  loadMapApp,
  titleForPath,
} from "./lib/productRoutes";
import { parseAppUrl } from "./lib/urlState";

const MapApp = lazy(loadMapApp);
const DriveApp = lazy(loadDriveApp);

/** `/` is the landing page unless it carries an older shared map link (R2). */
function Home() {
  const { search, hash } = useLocation();
  if (Object.keys(parseAppUrl(search)).length > 0) {
    return <Navigate to={{ pathname: MAP_PATH, search, hash }} replace />;
  }
  return <Landing />;
}

/** Rewrites the raw pathname, not the decoded splat, to keep encoding (R3). */
function LegacyCars() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={{ pathname: legacyCarsPath(pathname), search, hash }} replace />;
}

export default function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);

  return (
    <Suspense
      fallback={
        <div className="route-loading" role="status">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route path={LANDING_PATH} element={<Home />} />
        <Route path={MAP_PATH} element={<MapApp />} />
        <Route path={`${DRIVE_PATH}/*`} element={<DriveApp />} />
        <Route path="/cars/*" element={<LegacyCars />} />
        <Route path="*" element={<Navigate to={LANDING_PATH} replace />} />
      </Routes>
    </Suspense>
  );
}
