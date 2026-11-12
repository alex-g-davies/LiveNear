// Catalogue for "nb" (spec 028), loaded on demand. Typed against English, so a
// missing key fails the type check (R13).
import type { Dict } from "../en";
import common from "./common";
import landing from "./landing";
import map from "./map";
import carsPlan from "./carsPlan";
import carsCompare from "./carsCompare";
import backend from "./backend";

const dict: Dict = {
  ...common,
  ...landing,
  ...map,
  ...carsPlan,
  ...carsCompare,
  ...backend,
};

export default dict;
