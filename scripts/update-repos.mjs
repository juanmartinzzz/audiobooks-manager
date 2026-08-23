#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reposDir = path.join(rootDir, "repos");
const { repos } = JSON.parse(
  readFileSync(path.join(rootDir, "reference-repos.json"), "utf8"),
);

mkdirSync(reposDir, { recursive: true });

for (const { name, url, alias } of repos) {
  const dest = path.join(reposDir, name);
  const label = alias ? `${name} (${alias})` : name;
  if (existsSync(path.join(dest, ".git"))) {
    console.log(`Updating ${label}...`);
    execSync("git pull --ff-only", { cwd: dest, stdio: "inherit" });
  } else {
    console.log(`Cloning ${label}...`);
    execSync(`git clone "${url}" "${dest}"`, { cwd: rootDir, stdio: "inherit" });
  }
}
