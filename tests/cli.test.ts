import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Stub out original execution in modules by mocking them
vi.mock('../src/index.js', () => ({
  startServer: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../src/dashboard.js', () => ({
  startDashboard: vi.fn()
}));

describe('cli arguments routing dispatcher', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    exitCode = undefined;
    (process as any).exit = (code?: number) => {
      exitCode = code;
    };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('routes to dashboard command', async () => {
    process.argv = ['node', 'cli.js', 'dashboard', '--config', 'custom.json'];
    // Re-import cli to run script body
    await import('../src/cli.js');
    const { startDashboard } = await import('../src/dashboard.js');
    expect(startDashboard).toHaveBeenCalledWith('custom.json');
  });

  it('routes to start server command', async () => {
    process.argv = ['node', 'cli.js', 'start', '--config', 'server-config.json'];
    await import('../src/cli.js');
    const { startServer } = await import('../src/index.js');
    expect(startServer).toHaveBeenCalledWith('server-config.json');
  });

  it('routes to start server by default if no subcommand is passed', async () => {
    process.argv = ['node', 'cli.js', '--config', 'default-config.json'];
    await import('../src/cli.js');
    const { startServer } = await import('../src/index.js');
    expect(startServer).toHaveBeenCalledWith('default-config.json');
  });

  it('routes to help output and exits', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'cli.js', 'help'];
    await import('../src/cli.js');
    expect(exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();

    const { startServer } = await import('../src/index.js');
    const { startDashboard } = await import('../src/dashboard.js');
    expect(startServer).not.toHaveBeenCalled();
    expect(startDashboard).not.toHaveBeenCalled();
  });

  it('shows error and exits on invalid subcommand', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'cli.js', 'invalid-command-name'];
    await import('../src/cli.js');
    expect(exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
    consoleErrorSpy.mockRestore();
    consoleSpy.mockRestore();

    const { startServer } = await import('../src/index.js');
    const { startDashboard } = await import('../src/dashboard.js');
    expect(startServer).not.toHaveBeenCalled();
    expect(startDashboard).not.toHaveBeenCalled();
  });
});
