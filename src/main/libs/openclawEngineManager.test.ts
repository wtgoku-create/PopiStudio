import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAppState = vi.hoisted(() => ({
  userData: '',
  appPath: process.cwd(),
  isPackaged: false,
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockAppState.userData;
      if (name === 'home') return os.homedir();
      return os.tmpdir();
    },
    getAppPath: () => mockAppState.appPath,
    isPackaged: mockAppState.isPackaged,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('OpenClawEngineManager gateway auth config repair', () => {
  let tmpDir: string;
  let stateDir: string;
  let configPath: string;
  let gatewayTokenPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-engine-manager-'));
    stateDir = path.join(tmpDir, 'openclaw', 'state');
    configPath = path.join(stateDir, 'openclaw.json');
    gatewayTokenPath = path.join(stateDir, 'gateway-token');
    fs.mkdirSync(stateDir, { recursive: true });
    mockAppState.userData = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('repairs placeholder gateway auth token in config and tightens file modes', async () => {
    fs.writeFileSync(gatewayTokenPath, 'real-gateway-token', 'utf8');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        gateway: {
          mode: 'local',
          auth: {
            mode: 'token',
            token: '${OPENCLAW_GATEWAY_TOKEN}',
          },
        },
      }, null, 2) + '\n',
      'utf8',
    );
    fs.chmodSync(gatewayTokenPath, 0o644);
    fs.chmodSync(configPath, 0o644);

    const { OpenClawEngineManager } = await import('./openclawEngineManager');
    const manager = new OpenClawEngineManager();

    manager.repairGatewayAuthTokenInConfig();

    const repairedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(repairedConfig.gateway.auth).toEqual({
      mode: 'token',
      token: 'real-gateway-token',
    });

    if (process.platform !== 'win32') {
      expect(fs.statSync(gatewayTokenPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    }
  });
});
