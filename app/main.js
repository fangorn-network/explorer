// The explorer page: westmarch/explore over the live chain, rendered as the
// fangorn row shape. Each feature is one action shared by the page and its
// WebMCP tool, so a person and an agent get the same answer:
//   findApps     the ranked list        find-fangorn-apps
//   describeApp  one app's whole entry  describe-fangorn-app

import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { readDirectory, rankApps, brief } from "@fangorn-network/westmarch/explore";
import { embedQuery, warmEmbedder, EMBED_MODEL } from "@fangorn-network/westmarch/embed";

const $ = (s) => document.querySelector(s);
// Optional parts are passed as null/false and dropped here. DOM append and
// replaceChildren would print them as the text "null".
const present = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false);
const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...present(kids));
    return n;
};
const render = (...kids) => $("#view").replaceChildren(...present(kids));
const svg = (tag, attrs = {}) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
};
const ctx = { apps: [], pending: 0 };   // pending: bound apps still loading

// ── actions ─────────────────────────────────────────────────────────────────

export function findApps(ctx, { query = "", limit = 10 } = {}, qv = null) {
    const apps = rankApps(ctx.apps, query, { qv, model: EMBED_MODEL }).map(brief);
    return { query, ranked_by: apps[0]?.ranked_by ?? null, total: ctx.apps.length,
             apps: apps.slice(0, Math.min(50, Math.max(1, Number(limit) || 10))) };
}

/** One app by its slug (`app` from find), name, or appId. */
export function describeApp(ctx, { app = "" } = {}) {
    const k = String(app).trim().toLowerCase();
    const a = ctx.apps.find((x) => x.app === k || x.name.toLowerCase() === k || x.appId.toLowerCase() === k);
    if (!a) return { error: `no verified app ${JSON.stringify(app)}; ids come from find-fangorn-apps` };
    const { domains, ...rest } = a;
    return { ...rest, collections: domains.map((d) => ({ name: label(d.name), description: d.description ?? "", records: d.rows ?? null })) };
}

// The last query's vector, kept: the list re-ranks as each app lands, and must not re-embed each time.
let lastQv = { q: null, p: null };
const queryVector = (q) => {
    if (q !== lastQv.q) lastQv = { q, p: q.trim() ? embedQuery(q).catch(() => null) : Promise.resolve(null) };
    return lastQv.p;
};

function registerAgent(ctx) {
    const mc = document.modelContext;
    if (!mc) return;
    const ok = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
    mc.registerTool({
        name: "find-fangorn-apps",
        description: "Find Fangorn apps for a question, ranked by what their data is about (\"where can I learn about weather?\"). Each app has its site, agent card, ERC-8004 agent id and 8004scan link, ERC-8004 reputation (feedback count and average), and record count. `relevant: true` marks the apps worth opening. No query lists every verified app. Pass an app's `app` to describe-fangorn-app for its collections.",
        inputSchema: { type: "object", properties: {
            query: { type: "string", description: "What the person is looking for, in their words" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } } },
        execute: async (args = {}) => {
            const out = findApps(ctx, args, await queryVector(String(args.query ?? "")));
            go(out.query ? `#q=${encodeURIComponent(out.query)}` : "#");   // the person sees what the agent asked
            return ok(out);
        },
    });
    mc.registerTool({
        name: "describe-fangorn-app",
        description: "One Fangorn app in full: its collections (what each holds and how many records), tools, ERC-8004 agent and reputation, owner, and links. `app` is the `app` field from find-fangorn-apps, the app's name, or its appId.",
        inputSchema: { type: "object", properties: { app: { type: "string" } }, required: ["app"] },
        execute: async (args = {}) => {
            const out = describeApp(ctx, args);
            if (!out.error) go(`#/app/${out.app}`);
            return ok(out);
        },
    });
}

// ── rendering ───────────────────────────────────────────────────────────────
// Every value from a card or catalog can be missing: each gets a word, never
// "null", "undefined" or "NaN" on the page.

const n = (x) => (Number.isFinite(x) ? x.toLocaleString("en-US") : null);
const short = (h) => (typeof h === "string" && h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h ?? "");
// Domain names are namespaced (`30e85ae2-7a784923-us-wi-plover`): drop the app/owner prefix.
// Short tokens are codes (US, WI), the rest words: `us-wi-plover` → "US WI Plover".
const label = (name) => String(name ?? "").replace(/^[0-9a-f]{8}-[0-9a-f]{8}-/, "").split(/[-_\s]+/).filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ") || "Collection";
const ext = (href, text) => (href ? el("a", { href, target: "_blank", rel: "noopener" }, text) : null);

function reputation(r) {
    if (!r) return "no ERC-8004 agent found";
    if (r.error) return "reputation unavailable";
    if (!r.feedback) return "no feedback yet";
    const avg = Number.isFinite(r.average) ? `${Math.round(r.average)} avg · ` : "";
    return `${avg}${n(r.feedback)} feedback`;
}
const records = (a) => (n(a.rows) ? `${n(a.rows)} records` : "records unavailable");

/** A 5×5 mirrored identicon from the appId: the app's own hash, drawn. */
function identicon(appId, size = 44) {
    const hex = String(appId ?? "").replace(/^0x/, "").padEnd(64, "0");
    const hue = parseInt(hex.slice(0, 4), 16) % 360;
    const g = svg("svg", { viewBox: "0 0 5 5", width: size, height: size, class: "identicon", "aria-hidden": "true", "shape-rendering": "crispEdges" });
    g.style.setProperty("--hue", hue);
    g.append(svg("rect", { width: 5, height: 5, class: "id-bg" }));
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
        if (parseInt(hex[4 + y * 3 + x], 16) % 2) continue;
        for (const cx of new Set([x, 4 - x])) g.append(svg("rect", { x: cx, y, width: 1, height: 1, class: "id-fg" }));
    }
    return g;
}

function row(a) {
    const more = `#/app/${a.app}`;
    return el("li", { className: "row" },
        el("a", { href: more, className: "pic", tabIndex: -1, ariaHidden: "true" }, identicon(a.appId)),
        el("div", { className: "main" },
            el("div", { className: "head" },
                el("a", { className: "title", href: more }, a.name),
                a.relevant ? el("span", { className: "badge" }, "match") : null),
            el("span", { className: "meta" },
                [records(a), a.agent ? `ERC-8004 #${a.agent.id}` : null, reputation(a.reputation)].filter(Boolean).join(" · ")),
            a.description ? el("p", { className: "detail" }, a.description) : null,
            el("div", { className: "acts" },
                el("a", { href: more }, "Details"),
                ext(a.site, "Open app ↗"),
                a.agent ? ext(a.agent.scan, "8004scan ↗") : null)));
}

/** A grey stand-in for an app still loading, the shape of `row`. */
const placeholder = () => el("li", { className: "row skel", ariaHidden: "true" },
    el("div", { className: "pic" }), el("div", { className: "main" }, el("i", { className: "w40" }), el("i", { className: "w60" }), el("i", {})));
const placeholders = () => (ctx.pending ? el("ul", { className: "list" }, Array.from({ length: ctx.pending }, placeholder)) : null);

let lastList = "#";
function showList(out, loading = false) {
    const { query, apps, ranked_by, total } = out;
    if (document.activeElement !== $("#q input")) $("#q input").value = query;
    const hits = apps.filter((a) => a.relevant), rest = query ? apps.filter((a) => !a.relevant) : apps;
    render(
        el("div", { className: "resultsbar" },
            el("span", {}, !total && ctx.pending ? `Loading ${ctx.pending} apps…`
                : (query ? `${hits.length} of ${total} apps match` : `${total} verified apps on Fangorn`)
                    + (ctx.pending ? `, ${ctx.pending} more loading…` : "")),
            query ? el("span", {}, loading ? "ranked by words, loading meaning…" : `ranked by ${ranked_by ?? "words"}`) : null),
        hits.length ? el("ul", { className: "list" }, hits.map(row)) : null,
        query && rest.length ? el("h2", {}, hits.length ? "Other apps, less related" : "Nothing clearly matches. Every app, closest first") : null,
        rest.length ? el("ul", { className: "list" }, rest.map(row)) : null,
        placeholders(),
        !total && !ctx.pending ? el("p", { id: "status" }, "No verified apps could be read right now. Reload to retry.") : null);
}

function showApp(slugOrId) {
    const a = describeApp(ctx, { app: slugOrId });
    if (a.error && ctx.pending) return render(el("a", { href: lastList, className: "back" }, "← All apps"), el("ul", { className: "list" }, placeholder()));
    if (a.error) return render(el("p", { id: "status" }, "No verified app by that name. ", el("a", { href: "#" }, "See every app")));
    $("#q input").value = "";
    const facts = [
        ["Records", records(a)],
        ["ERC-8004 agent", a.agent ? ext(a.agent.scan, `#${a.agent.id} on 8004scan ↗`) : "none found"],
        ["Reputation", reputation(a.reputation)],
        ["Owner", a.owner ? ext(`https://sepolia.arbiscan.io/address/${a.owner}`, `${short(a.owner)} ↗`) : "unknown"],
        ["Bound at block", n(a.boundAt) ? ext(`https://sepolia.arbiscan.io/block/${a.boundAt}`, `${n(a.boundAt)} ↗`) : "unknown"],
        ["Agent card", ext(a.card, "agent-card.json ↗")],
        ["App id", el("code", { title: a.appId }, short(a.appId))],
    ];
    const preview = a.site ? el("div", { className: "preview" },
        el("button", { type: "button", onclick: (e) => {
            e.currentTarget.parentElement.replaceChildren(el("iframe", { src: a.site, title: `${a.name}, live preview`,
                sandbox: "allow-scripts allow-same-origin allow-popups allow-forms" }));
        } }, "Load a live preview"),
        el("small", {}, "Loads the app's own page and its data in your browser.")) : el("p", { className: "hint" }, "This app lists no https site.");
    render(
        el("a", { href: lastList, className: "back" }, "← All apps"),
        el("header", { className: "apphead" }, identicon(a.appId, 64),
            el("div", {}, el("h1", {}, a.name),
                el("div", { className: "acts" }, ext(a.site, "Open app ↗"), a.agent ? ext(a.agent.scan, "8004scan ↗") : null))),
        a.description ? el("p", { className: "about" }, a.description) : null,
        el("dl", { className: "facts" }, facts.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v ?? "unknown")])),
        a.unreachable ? el("p", { className: "hint" }, `${a.unreachable} of its catalogs did not answer, so counts may be low.`) : null,
        el("h2", {}, "Preview"), preview,
        el("h2", {}, `Collections (${a.collections.length})`),
        a.collections.length
            ? el("ul", { className: "list colls" }, a.collections.map((c) => el("li", { className: "row" },
                el("div", { className: "main" },
                    el("div", { className: "head" }, el("strong", {}, c.name), n(c.records) ? el("small", {}, `${n(c.records)} records`) : null),
                    c.description ? el("p", { className: "detail" }, c.description) : null))))
            : el("p", { className: "hint" }, "Its catalog did not answer."),
        a.tools.length ? [el("h2", {}, `Tools for agents (${a.tools.length})`),
            el("p", { className: "tools" }, a.tools.map((t) => [el("code", {}, t), " "]))] : null);
    scrollTo(0, 0);
}

// ── routing: #q=<query> for a search, #/app/<slug> for one app ──────────────

let seq = 0;
async function results(query) {
    const mine = ++seq;
    // Words answer at once; meaning replaces them when the model is ready (131 MB, first search only).
    const vec = queryVector(query);
    const qv = await Promise.race([vec, new Promise((ok) => setTimeout(() => ok(undefined), 400))]);
    if (mine !== seq) return;
    if (qv === undefined) vec.then((v) => { if (v && mine === seq) showList(findApps(ctx, { query, limit: 50 }, v)); });
    showList(findApps(ctx, { query, limit: 50 }, qv ?? null), qv === undefined);
}

function route() {
    const h = location.hash;
    if (h.startsWith("#/app/")) { seq++; return showApp(decodeURIComponent(h.slice(6))); }
    lastList = h || "#";
    results(new URLSearchParams(h.slice(1)).get("q") ?? "");
}
const go = (hash) => { if (location.hash !== hash && !(hash === "#" && !location.hash)) location.hash = hash; else route(); };

$("#q").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q input").value.trim();
    go(q ? `#q=${encodeURIComponent(q)}` : "#");
});
$("#q input").addEventListener("focus", warmEmbedder, { once: true });
addEventListener("hashchange", route);

// Apps appear as they load. An app page already showing stays put: re-rendering
// it would scroll to the top and drop a loaded preview.
function update({ apps, pending }) {
    Object.assign(ctx, { apps, pending });
    Object.assign($("#q input"), { disabled: false, placeholder: "What are you looking for? e.g. weather, music, clinical trials" });
    if (!(location.hash.startsWith("#/app/") && $(".apphead"))) route();
}

try {
    const dir = await readDirectory(createPublicClient({ chain: arbitrumSepolia, transport: http() }), { onUpdate: update });
    if (dir.dropped.length) console.info("explorer: not listed (card did not verify)", JSON.stringify(dir.dropped));
    registerAgent(ctx);   // after every app has settled: an agent's answer should be the whole directory
} catch (e) {
    $("#status").textContent = `Could not read the app registry (${e?.shortMessage ?? e?.message ?? "network error"}). Reload to retry.`;
}
