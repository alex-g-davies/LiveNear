// DriveCheap's English strings, registered when its chunk loads (spec 028).
import { registerEnglish } from "./core";
import backend from "./en/backend";
import carsCompare from "./en/carsCompare";
import carsPlan from "./en/carsPlan";

registerEnglish({ ...carsPlan, ...carsCompare, ...backend });
