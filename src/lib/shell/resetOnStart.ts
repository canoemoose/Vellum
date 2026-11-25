// Imported first in main.ts, for its effect: a reset asked for in the last run (reset.ts)
// happens before any other module reads what's stored.
import { clearIfMarked } from "./reset";

clearIfMarked();
