import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Dev Container Configuration (Issue #727)', () => {
  const rootDir = process.cwd();
  const devcontainerJsonPath = path.join(rootDir, '.devcontainer/devcontainer.json');
  const devcontainerDockerfilePath = path.join(rootDir, '.devcontainer/Dockerfile');
  const devcontainerComposePath = path.join(rootDir, '.devcontainer/docker-compose.yml');
  const rootComposePath = path.join(rootDir, 'docker-compose.yml');
  const envExamplePath = path.join(rootDir, '.env.example');
  const contributingPath = path.join(rootDir, 'CONTRIBUTING.md');
  const localDevDocPath = path.join(rootDir, 'docs/LOCAL_DEV.md');
  const rustToolchainPath = path.join(rootDir, 'contracts/rust-toolchain.toml');

  it('provides a valid .devcontainer/devcontainer.json configuration', () => {
    expect(fs.existsSync(devcontainerJsonPath)).toBe(true);
    const content = fs.readFileSync(devcontainerJsonPath, 'utf8');
    const json = JSON.parse(content);

    expect(json.name).toBe('OphirPay');
    expect(json.service).toBe('app');
    expect(json.workspaceFolder).toBe('/workspaces/OphirPay');
    expect(json.remoteUser).toBe('node');
    expect(json.dockerComposeFile).toEqual(['../docker-compose.yml', 'docker-compose.yml']);
    expect(json.forwardPorts).toContain(3000);
    expect(json.forwardPorts).toContain(5432);
    expect(json.forwardPorts).toContain(6379);

    const extensions = json.customizations?.vscode?.extensions || [];
    expect(extensions).toContain('dbaeumer.vscode-eslint');
    expect(extensions).toContain('esbenp.prettier-vscode');
    expect(extensions).toContain('rust-lang.rust-analyzer');
    expect(extensions).toContain('prisma.prisma');
  });

  it('provides .devcontainer/Dockerfile matching node version and rust toolchain', () => {
    expect(fs.existsSync(devcontainerDockerfilePath)).toBe(true);
    const dockerfile = fs.readFileSync(devcontainerDockerfilePath, 'utf8');

    // Matches Node 20
    expect(dockerfile).toMatch(/20/);

    // Reads rust-toolchain.toml channel
    const rustToolchain = fs.readFileSync(rustToolchainPath, 'utf8');
    const channelMatch = rustToolchain.match(/channel\s*=\s*"([^"]+)"/);
    expect(channelMatch).not.toBeNull();
    const pinnedChannel = channelMatch![1];

    expect(dockerfile).toContain(`--default-toolchain ${pinnedChannel}`);
    expect(dockerfile).toContain('wasm32v1-none');
    expect(dockerfile).toContain('wasm32-unknown-unknown');
    expect(dockerfile).toContain('socat');
  });

  it('provides .devcontainer/docker-compose.yml override', () => {
    expect(fs.existsSync(devcontainerComposePath)).toBe(true);
    const composeContent = fs.readFileSync(devcontainerComposePath, 'utf8');
    expect(composeContent).toContain('app:');
    expect(composeContent).toContain('/workspaces/OphirPay');
  });

  it('configures docker-compose.yml with postgres authentication compatibility', () => {
    expect(fs.existsSync(rootComposePath)).toBe(true);
    const compose = fs.readFileSync(rootComposePath, 'utf8');
    expect(compose).toContain('POSTGRES_HOST_AUTH_METHOD: trust');
    expect(compose).toContain('POSTGRES_USER: ophirpay');
  });

  it('configures .env.example with matching database connection defaults', () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
    const envExample = fs.readFileSync(envExamplePath, 'utf8');
    expect(envExample).toMatch(/DATABASE_URL=postgresql:\/\/ophirpay:ophirpay@localhost:5432\/ophirpay/);
  });

  it('points at the devcontainer as the fastest path in CONTRIBUTING.md', () => {
    expect(fs.existsSync(contributingPath)).toBe(true);
    const contributing = fs.readFileSync(contributingPath, 'utf8');
    expect(contributing).toMatch(/Fastest Path: Dev Container \/ GitHub Codespaces/i);
    expect(contributing).toMatch(/cargo test/i);
  });

  it('documents Dev Container / Codespaces in docs/LOCAL_DEV.md', () => {
    expect(fs.existsSync(localDevDocPath)).toBe(true);
    const localDev = fs.readFileSync(localDevDocPath, 'utf8');
    expect(localDev).toMatch(/Fastest Path — Dev Container/i);
    expect(localDev).toMatch(/\.devcontainer/i);
    expect(localDev).toMatch(/Codespaces/i);
  });
});
