// English catalogue (spec 028): the source of truth for every key.
import common from "./common";
import landing from "./landing";
import map from "./map";
import carsPlan from "./carsPlan";
import carsCompare from "./carsCompare";
import backend from "./backend";

const en = {
  ...common,
  ...landing,
  ...map,
  ...carsPlan,
  ...carsCompare,
  ...backend,
} as const;

export default en;
export type Key = keyof typeof en;
/** Every language defines every key (R13). */
export type Dict = Record<Key, string>;
