// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #727 — add a devcontainer so Codespaces and local development match CI.
 *
 * This test suite guards the devcontainer configuration against drift from
 * repository toolchains (.nvmrc, contracts/rust-toolchain.toml, docker-compose.yml).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("devcontainer configuration (#727)", () => {
  it("provides .devcontainer/devcontainer.json with valid structure and extensions", () => {
    const filePath = path.join(ROOT, ".devcontainer", "devcontainer.json");
    expect(existsSync(filePath)).toBe(true);

    const config = JSON.parse(readFileSync(filePath, "utf8"));
    expect(config.name).toBe("OphirPay");
    expect(config.service).toBe("app");
    expect(config.workspaceFolder).toBe("/workspaces/OphirPay");
    expect(config.remoteUser).toBe("node");
    expect(config.dockerComposeFile).toEqual(["../docker-compose.yml", "docker-compose.yml"]);

    expect(config.forwardPorts).toContain(3000);
    expect(config.forwardPorts).toContain(5432);
    expect(config.forwardPorts).toContain(6379);

    const extensions: string[] = config.customizations?.vscode?.extensions ?? [];
    expect(extensions).toContain("dbaeumer.vscode-eslint");
    expect(extensions).toContain("esbenp.prettier-vscode");
    expect(extensions).toContain("rust-lang.rust-analyzer");
    expect(extensions).toContain("prisma.prisma");
    expect(extensions).toContain("tamasfe.even-better-toml");
    expect(extensions).toContain("bradlc.vscode-tailwindcss");

    expect(config.remoteEnv?.PATH).toContain("/home/node/.cargo/bin");
    expect(config.postCreateCommand).toContain("npm ci");
    expect(config.postCreateCommand).toContain(".env.example");
    expect(config.postStartCommand).toContain("prisma db push");
  });

  it("provides .devcontainer/Dockerfile matching .nvmrc and contracts/rust-toolchain.toml", () => {
    const dockerfilePath = path.join(ROOT, ".devcontainer", "Dockerfile");
    expect(existsSync(dockerfilePath)).toBe(true);
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    const nvmrcMajor = read(".nvmrc").trim();
    expect(dockerfile).toContain(`javascript-node:1-${nvmrcMajor}-bookworm`);

    const rustToolchain = read("contracts/rust-toolchain.toml");
    const channelMatch = rustToolchain.match(/channel\s*=\s*"([^"]+)"/);
    const expectedChannel = channelMatch ? channelMatch[1] : "1.91.0";

    expect(dockerfile).toContain(`--default-toolchain ${expectedChannel}`);
    expect(dockerfile).toContain("rustfmt");
    expect(dockerfile).toContain("clippy");
    expect(dockerfile).toContain("wasm32v1-none");
    expect(dockerfile).toContain("wasm32-unknown-unknown");

    expect(dockerfile).toContain("socat");
    expect(dockerfile).toContain("postgresql-client");
    expect(dockerfile).toContain("redis-tools");
    expect(dockerfile).toContain("build-essential");
  });

  it("provides .devcontainer/docker-compose.yml overriding app service", () => {
    const composePath = path.join(ROOT, ".devcontainer", "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);
    const compose = readFileSync(composePath, "utf8");

    expect(compose).toContain("app:");
    expect(compose).toContain("/workspaces/OphirPay");
    expect(compose).toContain("user: node");
    expect(compose).toContain("TCP-LISTEN:5432");
    expect(compose).toContain("TCP-LISTEN:6379");
  });

  it("ensures root docker-compose.yml configures database with trust auth method", () => {
    const rootCompose = read("docker-compose.yml");
    expect(rootCompose).toContain("POSTGRES_USER: ophirpay");
    expect(rootCompose).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
  });

  it("ensures .env.example contains matching local postgres credentials", () => {
    const envExample = read(".env.example");
    expect(envExample).toContain("DATABASE_URL=postgresql://ophirpay:ophirpay@localhost:5432/ophirpay");
  });

  it("documents devcontainer in CONTRIBUTING.md and docs/LOCAL_DEV.md", () => {
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toContain("Fastest Path: Dev Container / GitHub Codespaces");
    expect(contributing).toContain(".devcontainer");
    expect(contributing).toContain("cargo test");

    const localDev = read("docs/LOCAL_DEV.md");
    expect(localDev).toContain("Fastest Path — Dev Container / GitHub Codespaces");
    expect(localDev).toContain(".devcontainer");
    expect(localDev).toContain("cargo test");
  });
});
