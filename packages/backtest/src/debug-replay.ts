import { generateSeries } from "./series";
import { generateEvents } from "./fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-debug-"));
const bars = generateSeries({ startTon: 10, days: 45, barsPerDay: 48, driftPerDay: 0.02, volPerBar: 0.01, seed: 10 });
const normal = generateEvents(bars, "EQA-rr", "RR");
const tradable = generateEvents(bars, "EQA-rr", "RR", 24, "real", 0, true);
console.log("normal events", normal.length);
console.log("tradable events", tradable.length);
console.log("normal first score", JSON.stringify(normal[0]?.envelope.score));
console.log("tradable first score", JSON.stringify(tradable[0]?.envelope.score));
