#!/usr/bin/env node

const ESC = '\x1b';
const RGB = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;

const COLORS = {
  blue: RGB(137, 180, 250),
  green: RGB(166, 227, 161),
  gray: RGB(127, 132, 156),
  text: RGB(205, 214, 244)
};

function showHelp(): void {
  console.log(`
${COLORS.blue}${BOLD}⚡ FREE AI API ROUTER CLI${RESET}

${BOLD}Usage:${RESET}
  ${COLORS.green}free-ai-router${RESET} <command> [options]

${BOLD}Commands:${RESET}
  ${COLORS.green}start${RESET}          Run the API Router server (Default command)
  ${COLORS.green}dashboard${RESET}      Open the TUI control panel dashboard
  ${COLORS.green}help${RESET}           Show this help information

${BOLD}Options:${RESET}
  ${COLORS.green}--config${RESET} <path>  Specify a custom configuration JSON file (Default: config.json)

${BOLD}Examples:${RESET}
  free-ai-router start --config custom.json
  free-ai-router dashboard
`);
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHelp();
    process.exit(0);
  }

  if (subcommand === 'dashboard') {
    // Strip subcommand and pass config path if specified
    const configIdx = args.indexOf('--config');
    const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined;
    const { startDashboard } = await import('./dashboard.js');
    startDashboard(configPath);
    return;
  }

  // Treat 'start' or anything else (or empty) as API server startup
  let configPath: string | undefined;
  const configIdx = args.indexOf('--config');
  if (configIdx !== -1) {
    configPath = args[configIdx + 1];
  }

  const { startServer } = await import('./index.js');
  startServer(configPath).catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

runCli().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
