import { join, resolve } from 'node:path';

// agentHome is the host's directory; Claude's default user JSON lives beside it.
// Callers that isolate HOME must pass their chosen agentHome so an inherited
// environment cannot select a profile outside that isolated home.
export function resolveProfile({ agent, home, agentHome, explicitProfile }, environment = process.env) {
  if (!['codex', 'claude'].includes(agent)) throw Error('Unknown agent profile');
  if (typeof home !== 'string' || !home) throw Error('Profile home is required');
  if (explicitProfile !== undefined && typeof explicitProfile !== 'boolean') throw Error('Invalid explicit profile flag');
  const userHome = resolve(home), defaultHome = join(userHome, `.${agent}`);
  const variable = agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const configured = environment[variable];
  const environmentHome = typeof configured === 'string' && configured ? resolve(configured) : undefined;
  const selectedHome = resolve(agentHome ?? (explicitProfile === false ? defaultHome : environmentHome ?? defaultHome));
  const explicit = explicitProfile ?? (selectedHome !== defaultHome || environmentHome === selectedHome);
  if (!explicit && selectedHome !== defaultHome) throw Error('A nondefault profile directory must be explicit');
  return {
    agentHome: selectedHome,
    mcpConfigPath: agent === 'codex' ? join(selectedHome, 'config.toml') : join(explicit ? selectedHome : userHome, '.claude.json'),
    explicitProfile: explicit,
  };
}

export function nativeEnvironment(input, base = process.env) {
  const profile = resolveProfile(input, base);
  const environment = { ...base, HOME: resolve(input.home) };
  if (input.agent === 'codex') environment.CODEX_HOME = profile.agentHome;
  else if (profile.explicitProfile) environment.CLAUDE_CONFIG_DIR = profile.agentHome;
  else delete environment.CLAUDE_CONFIG_DIR;
  return environment;
}
