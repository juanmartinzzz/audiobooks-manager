#!/usr/bin/env node
/**
 * Compare this account's R2 usage to the Standard free-tier monthly limits.
 *
 *   npm run r2:usage
 *   npm run r2:usage -- --from 2026-08-01 --to 2026-08-31
 *   npm run r2:usage -- --json
 *
 * Object counts come from a live R2 list. Class A/B come from GraphQL
 * analytics for the selected window. Needs CLOUDFLARE_API_TOKEN.
 */
const API = "https://api.cloudflare.com/client/v4";

const FREE = {
  storageBytes: 10 * 1e9,
  classA: 1_000_000,
  classB: 10_000_000,
};

const CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

const FREE_OPS = new Set([
  "DeleteObject",
  "DeleteBucket",
  "AbortMultipartUpload",
]);

function parseArgs(argv) {
  const out = { json: false, from: null, to: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function monthStartUtc(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

function parseInstant(value, label) {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value}T00:00:00Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function formatBytes(bytes) {
  if (bytes == null) return "—";
  const gb = bytes / 1e9;
  if (gb >= 0.01) return `${gb.toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}

function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function formatPct(used, limit) {
  if (!limit) return "—";
  const pct = (used / limit) * 100;
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

function classify(action) {
  if (CLASS_A.has(action)) return "A";
  if (CLASS_B.has(action)) return "B";
  if (FREE_OPS.has(action)) return "free";
  return "other";
}

function printTable(headers, rows) {
  const cols = headers.map((header, i) => [
    header,
    ...rows.map((row) => String(row[i] ?? "")),
  ]);
  const widths = cols.map((col) => Math.max(...col.map((cell) => cell.length)));
  const line = (cells) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
  const rule = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  console.log(line(headers));
  console.log(rule);
  for (const row of rows) console.log(line(row.map(String)));
}

function usageHelp() {
  console.log(`Compare R2 usage to the Standard free-tier monthly limits.

Usage:
  npm run r2:usage
  npm run r2:usage -- --from 2026-08-01 --to 2026-08-31
  npm run r2:usage -- --json

Requires CLOUDFLARE_API_TOKEN in .env (npm run r2:usage loads it).
`);
}

async function cfGet(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function gql(token, query, variables) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json;
}

async function resolveAccountId(token, configured) {
  if (configured) return configured;
  const { status, json } = await cfGet(token, "/accounts");
  if (!json.success) {
    throw new Error(
      `Could not list accounts (${status}): ${json.errors?.[0]?.message ?? "unknown error"}`,
    );
  }
  const accounts = json.result ?? [];
  if (accounts.length === 1) return accounts[0].id;
  if (accounts.length === 0) {
    throw new Error("Token cannot see any Cloudflare accounts.");
  }
  const names = accounts.map((a) => a.name).join(", ");
  throw new Error(
    `Set CLOUDFLARE_ACCOUNT_ID; token sees multiple accounts: ${names}`,
  );
}

async function listBucketNames(token, accountId) {
  const { json } = await cfGet(token, `/accounts/${accountId}/r2/buckets`);
  if (!json.success) {
    throw new Error(
      `Could not list buckets: ${json.errors?.[0]?.message ?? "unknown error"}`,
    );
  }
  const buckets = json.result?.buckets ?? json.result ?? [];
  if (!Array.isArray(buckets)) return [];
  return buckets.map((b) => b.name).filter(Boolean);
}

async function listBucketStorage(token, accountId, bucketName) {
  let cursor = null;
  let objectCount = 0;
  let payloadSize = 0;
  do {
    const params = new URLSearchParams({ per_page: "1000" });
    if (cursor) params.set("cursor", cursor);
    const path = `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects?${params}`;
    const { status, json } = await cfGet(token, path);
    if (!json.success) {
      throw new Error(
        `Could not list objects in ${bucketName} (${status}): ${json.errors?.[0]?.message ?? "unknown error"}`,
      );
    }
    const objects = Array.isArray(json.result) ? json.result : [];
    for (const object of objects) {
      objectCount += 1;
      payloadSize += Number(object.size ?? 0);
    }
    const info = json.result_info ?? {};
    cursor = info.is_truncated ? info.cursor || null : null;
    if (!objects.length) break;
  } while (cursor);
  return { objectCount, payloadSize };
}

const OPS_QUERY = `
query R2Ops($accountTag: string!, $startDate: Time, $endDate: Time) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_leq: $endDate }
      ) {
        sum { requests }
        dimensions { actionType bucketName }
      }
    }
  }
}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usageHelp();
    return;
  }

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error("CLOUDFLARE_API_TOKEN is missing. Run: npm run r2:usage");
  }

  const now = new Date();
  const from = parseInstant(args.from, "--from") ?? monthStartUtc(now);
  const to = parseInstant(args.to, "--to") ?? now;
  if (to < from) throw new Error("--to must be after --from");

  const accountId = await resolveAccountId(
    token,
    process.env.CLOUDFLARE_ACCOUNT_ID,
  );
  const startDate = from.toISOString();
  const endDate = to.toISOString();

  const [opsBody, billing, bucketNames] = await Promise.all([
    gql(token, OPS_QUERY, { accountTag: accountId, startDate, endDate }),
    cfGet(token, `/accounts/${accountId}/billable-usage`).catch((err) => ({
      status: 0,
      json: { success: false, errors: [{ message: err.message }] },
    })),
    listBucketNames(token, accountId),
  ]);

  const liveByBucket = {};
  for (const name of bucketNames) {
    liveByBucket[name] = await listBucketStorage(token, accountId, name);
  }

  const opGroups =
    opsBody.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups ?? [];

  const byClass = { A: 0, B: 0, free: 0, other: 0 };
  const byAction = {};
  const byBucket = {};

  for (const group of opGroups) {
    const action = group.dimensions?.actionType || "(unknown)";
    const bucket = group.dimensions?.bucketName || "(account)";
    const n = group.sum?.requests || 0;
    const kind = classify(action);
    byClass[kind] += n;
    byAction[action] = (byAction[action] || 0) + n;
    byBucket[bucket] ??= { A: 0, B: 0, free: 0, other: 0, total: 0 };
    byBucket[bucket][kind] += n;
    byBucket[bucket].total += n;
  }

  const storageBytes = Object.values(liveByBucket).reduce(
    (sum, row) => sum + (row.payloadSize || 0),
    0,
  );

  const report = {
    accountId,
    window: { from: startDate, to: endDate },
    free: {
      storage: "10 GB-month",
      classA: FREE.classA,
      classB: FREE.classB,
      egress: "unlimited",
    },
    usage: {
      storageBytes,
      classA: byClass.A,
      classB: byClass.B,
      freeOps: byClass.free,
      otherOps: byClass.other,
    },
    byAction,
    byBucket,
    liveByBucket,
    billableUsage: {
      ok: Boolean(billing.json.success),
      status: billing.status,
      error: billing.json.errors?.[0]?.message ?? null,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("R2 usage vs Standard free tier");
  console.log(`Account ${accountId}`);
  console.log(
    `Window  ${startDate} → ${endDate} (ops are UTC calendar month unless overridden)\n`,
  );

  printTable(
    ["Metric", "Used", "Free limit", "Of limit"],
    [
      [
        "Storage now",
        formatBytes(storageBytes),
        "10 GB-month",
        formatPct(storageBytes, FREE.storageBytes),
      ],
      [
        "Class A ops",
        formatCount(byClass.A),
        formatCount(FREE.classA),
        formatPct(byClass.A, FREE.classA),
      ],
      [
        "Class B ops",
        formatCount(byClass.B),
        formatCount(FREE.classB),
        formatPct(byClass.B, FREE.classB),
      ],
      ["Egress", "not metered", "unlimited", "always free"],
    ],
  );

  const names = [
    ...new Set([...bucketNames, ...Object.keys(byBucket)]),
  ].sort();
  if (names.length) {
    console.log("");
    printTable(
      ["Bucket", "Objects", "Stored", "Class A", "Class B"],
      names.map((name) => {
        const storage = liveByBucket[name];
        const ops = byBucket[name] || { A: 0, B: 0 };
        return [
          name,
          storage ? formatCount(storage.objectCount) : "—",
          storage ? formatBytes(storage.payloadSize || 0) : "—",
          formatCount(ops.A),
          formatCount(ops.B),
        ];
      }),
    );
  }

  const actions = Object.entries(byAction).sort((a, b) => b[1] - a[1]);
  if (actions.length) {
    console.log("");
    printTable(
      ["Action", "Class", "Requests"],
      actions.map(([action, n]) => [action, classify(action), formatCount(n)]),
    );
  }

  console.log("");
  console.log(
    "Object counts are a live R2 listing, not delayed GraphQL storage metrics.",
  );
  if (report.billableUsage.ok) {
    console.log(
      "Billable Usage API: available (invoice-accurate remaining allowance).",
    );
  } else {
    console.log(
      "Billable Usage API: unavailable (token needs Billing Read). Storage is bytes on disk, not GB-month.",
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
