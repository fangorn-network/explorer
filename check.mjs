// The explorer's gate, against the live chain: every question in
// eval/questions.jsonl, and the shape of every listed app.
//
//   node check.mjs        exit 1 on any miss
//
// `top`: that app ranks first and is relevant. `none`: no app is relevant.
// Grow the file when a new kind of app registers; a question that fails after
// a new app arrives is either a real miss or MIN_AFFINITY needing a re-measure.

import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { readDirectory, rankApps } from "@fangorn-network/westmarch/explore";
import { embedQueryDirect, EMBED_MODEL } from "@fangorn-network/westmarch/embed";

const { apps, dropped } = await readDirectory(createPublicClient({ chain: arbitrumSepolia, transport: http() }));
let bad = 0;
const fail = (m) => { console.log(`✗ ${m}`); bad++; };

// A public card that fails is a real app hidden from everyone. Local test cards are expected.
for (const d of dropped) if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(d.card)) fail(`dropped ${d.card}: ${d.why}`);
for (const a of apps) {
    const miss = [!/^https:/.test(a.site) && "site", !a.agent && "8004 agent", !a.rows && "rows", a.reputation?.error && "reputation"].filter(Boolean);
    if (miss.length) fail(`${a.name}: no ${miss.join(", ")}`);
}
console.log(`${apps.length} apps listed`);

for (const line of readFileSync(new URL("./eval/questions.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean)) {
    const t = JSON.parse(line);
    const r = rankApps(apps, t.q, { qv: await embedQueryDirect(t.q), model: EMBED_MODEL });
    const hits = r.filter((a) => a.relevant).map((a) => a.name);
    const ok = t.none ? !hits.length : r[0]?.name === t.top && r[0].relevant;
    const got = `${hits.join(", ") || "none"} (top ${r[0]?.name} ${r[0]?.score?.toFixed(3)})`;
    if (ok) console.log(`✓ ${t.q} → ${got}`); else fail(`${t.q} → ${got}, want ${t.none ? "none" : t.top}`);
}
process.exit(bad ? 1 : 0);
