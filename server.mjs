#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_JSON = path.join(HOME, '.claude.json');

const PORT = Number(process.env.PORT || 4178);

const COLORS = ['purple', 'teal', 'info', 'pink', 'success', 'warning'];
const colorFor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const initialFor = (name) => {
  const parts = name.split(/[-_:@/.]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const readJSON = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};
const readText = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
};
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const listDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

// Parse YAML-ish frontmatter from a markdown file
function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = text.slice(3, end).trim();
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function countMarkdownIn(dir) {
  return listDir(dir).filter(f => f.endsWith('.md')).length;
}

function pluginContents(installPath) {
  if (!installPath || !exists(installPath)) {
    return { commands: 0, agents: 0, hooks: 0, mcp: 0 };
  }
  const manifest =
    readJSON(path.join(installPath, 'plugin.json')) ||
    readJSON(path.join(installPath, '.claude-plugin', 'plugin.json')) ||
    {};
  // Manifest commands/agents can be a directory path (string) or an explicit
  // list of files (array) — e.g. the vercel plugin lists each .md file.
  const commandsDir =
    (typeof manifest.commands === 'string' && path.join(installPath, manifest.commands)) ||
    path.join(installPath, 'commands');
  const agentsDir =
    (typeof manifest.agents === 'string' && path.join(installPath, manifest.agents)) ||
    path.join(installPath, 'agents');
  const skillsDir = path.join(installPath, 'skills');

  // commands: count .md in commands dir (recursive 1 level)
  let commands;
  if (Array.isArray(manifest.commands)) {
    commands = manifest.commands.length;
  } else {
    commands = countMarkdownIn(commandsDir);
    for (const d of listDir(commandsDir)) {
      const sub = path.join(commandsDir, d);
      try {
        if (fs.statSync(sub).isDirectory()) commands += countMarkdownIn(sub);
      } catch {}
    }
  }
  const agents = Array.isArray(manifest.agents) ? manifest.agents.length : countMarkdownIn(agentsDir);

  // hooks
  let hooks = 0;
  const hooksJson =
    readJSON(path.join(installPath, 'hooks', 'hooks.json')) ||
    readJSON(path.join(installPath, '.claude-plugin', 'hooks.json'));
  if (hooksJson && typeof hooksJson === 'object') {
    for (const arr of Object.values(hooksJson)) if (Array.isArray(arr)) hooks += arr.length;
  }

  // mcp
  let mcp = 0;
  const mcpJson =
    readJSON(path.join(installPath, '.mcp.json')) ||
    readJSON(path.join(installPath, 'mcp.json'));
  if (mcpJson?.mcpServers) mcp = Object.keys(mcpJson.mcpServers).length;

  // skills
  const skills = listDir(skillsDir).filter(s => exists(path.join(skillsDir, s, 'SKILL.md'))).length;

  return { commands, agents, hooks, mcp, skills, manifest };
}

// Merged enabledPlugins map across settings scopes (later scopes win).
// A plugin absent from the map is enabled by default; explicit false disables.
function loadEnabledPlugins() {
  const merged = {};
  const sources = [
    path.join(CLAUDE_DIR, 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json')
  ];
  for (const p of sources) Object.assign(merged, readJSON(p)?.enabledPlugins || {});
  return merged;
}

function loadPlugins() {
  const installed = readJSON(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'));
  if (!installed?.plugins) return [];
  const enabledMap = loadEnabledPlugins();
  const out = [];
  for (const [key, entries] of Object.entries(installed.plugins)) {
    for (const e of (Array.isArray(entries) ? entries : [entries])) {
      const [pluginName, marketplace] = key.split('@');
      const contents = pluginContents(e.installPath);
      const desc = contents.manifest?.description || `${marketplace ? marketplace + ' / ' : ''}${pluginName}`;
      out.push({
        id: key,
        name: pluginName,
        source: marketplace || 'local',
        desc,
        version: e.version,
        scope: e.scope,
        installPath: e.installPath,
        enabled: enabledMap[key] !== false,
        manifest: contents.manifest || null,
        commands: contents.commands,
        agents: contents.agents,
        hooks: contents.hooks,
        mcp: contents.mcp,
        skills: contents.skills,
        color: colorFor(pluginName),
        initial: initialFor(pluginName)
      });
    }
  }
  return out;
}

function loadCommands(plugins) {
  const out = [];
  // user-level commands
  const userCmdDir = path.join(CLAUDE_DIR, 'commands');
  for (const f of listDir(userCmdDir)) {
    if (!f.endsWith('.md')) continue;
    const fm = parseFrontmatter(readText(path.join(userCmdDir, f)) || '');
    out.push({
      name: '/' + f.replace(/\.md$/, ''),
      plugin: 'user',
      desc: fm.description || '(no description)',
      invokes: 'built-in',
      source: path.join(userCmdDir, f)
    });
  }
  // plugin commands
  for (const p of plugins) {
    const dir = path.join(p.installPath || '', 'commands');
    for (const f of listDir(dir)) {
      const full = path.join(dir, f);
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        for (const f2 of listDir(full)) {
          if (!f2.endsWith('.md')) continue;
          const fm = parseFrontmatter(readText(path.join(full, f2)) || '');
          out.push({
            name: `/${p.name}:${f}:${f2.replace(/\.md$/, '')}`,
            plugin: p.name,
            desc: fm.description || '(no description)',
            invokes: 'agent',
            source: path.join(full, f2)
          });
        }
      } else if (f.endsWith('.md')) {
        const fm = parseFrontmatter(readText(full) || '');
        out.push({
          name: `/${p.name}:${f.replace(/\.md$/, '')}`,
          plugin: p.name,
          desc: fm.description || '(no description)',
          invokes: 'agent',
          source: full
        });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function loadAgents(plugins) {
  const out = [];
  const collect = (dir, pluginName) => {
    for (const f of listDir(dir)) {
      if (!f.endsWith('.md')) continue;
      const fm = parseFrontmatter(readText(path.join(dir, f)) || '');
      const tools = (fm.tools || '').split(',').map(s => s.trim()).filter(Boolean);
      out.push({
        name: f.replace(/\.md$/, ''),
        plugin: pluginName,
        desc: fm.description || '(no description)',
        model: fm.model || 'sonnet',
        tools,
        denied: []
      });
    }
  };
  collect(path.join(CLAUDE_DIR, 'agents'), 'user');
  for (const p of plugins) {
    collect(path.join(p.installPath || '', 'agents'), p.name);
  }
  return out;
}

function loadSkills(plugins) {
  const out = [];
  const collect = (dir, pluginName) => {
    for (const name of listDir(dir)) {
      const skillFile = path.join(dir, name, 'SKILL.md');
      if (!exists(skillFile)) continue;
      const fm = parseFrontmatter(readText(skillFile) || '');
      out.push({
        name,
        plugin: pluginName,
        desc: fm.description || '(no description)',
        autoInvoke: true
      });
    }
  };
  collect(path.join(CLAUDE_DIR, 'skills'), 'user');
  for (const p of plugins) {
    collect(path.join(p.installPath || '', 'skills'), p.name);
  }
  return out;
}

function flattenHooks(hooksObj, sourceLabel) {
  const out = [];
  if (!hooksObj) return out;
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const matcher = g.matcher || '*';
      for (const h of (g.hooks || [])) {
        out.push({
          event,
          matcher,
          type: h.type || 'command',
          cmd: h.command || h.prompt || '',
          source: sourceLabel,
          desc: h.description || ''
        });
      }
    }
  }
  return out;
}

function loadHooks(plugins) {
  const out = [];
  const settings = readJSON(path.join(CLAUDE_DIR, 'settings.json'));
  out.push(...flattenHooks(settings?.hooks, 'user settings.json'));
  for (const p of plugins) {
    const j =
      readJSON(path.join(p.installPath || '', 'hooks', 'hooks.json')) ||
      readJSON(path.join(p.installPath || '', '.claude-plugin', 'hooks.json'));
    out.push(...flattenHooks(j, `${p.name} plugin`));
  }
  return out;
}

function loadMcp() {
  const cfg = readJSON(CLAUDE_JSON);
  const out = [];
  const seen = new Set();
  const consume = (servers, scope) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, s] of Object.entries(servers)) {
      const key = scope + ':' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      const transport = s.type || (s.url ? 'http' : 'stdio');
      const url = s.url || s.command || transport;
      out.push({
        name,
        url: typeof url === 'string' ? url : JSON.stringify(url),
        scope,
        transport,
        tools: 0,
        status: 'configured',
        desc: s.description || ''
      });
    }
  };
  consume(cfg?.mcpServers, 'user');
  if (cfg?.projects) {
    for (const [proj, p] of Object.entries(cfg.projects)) {
      consume(p.mcpServers, `project:${path.basename(proj)}`);
    }
  }
  return out;
}

const PERMISSION_LISTS = ['allow', 'deny', 'ask'];
const PERMISSION_SCOPES = ['user', 'project', 'local'];

function permissionSources() {
  return [
    { scope: 'user', path: path.join(CLAUDE_DIR, 'settings.json') },
    { scope: 'project', path: path.join(process.cwd(), '.claude', 'settings.json') },
    { scope: 'local', path: path.join(process.cwd(), '.claude', 'settings.local.json') }
  ];
}

function loadPermissions() {
  const sources = permissionSources().map(s => {
    const p = readJSON(s.path)?.permissions || {};
    return {
      scope: s.scope,
      path: s.path,
      exists: exists(s.path),
      allow: Array.isArray(p.allow) ? p.allow : [],
      deny: Array.isArray(p.deny) ? p.deny : [],
      ask: Array.isArray(p.ask) ? p.ask : []
    };
  });
  const merged = { allow: [], deny: [], ask: [] };
  for (const s of sources) for (const list of PERMISSION_LISTS) merged[list].push(...s[list]);
  return { ...merged, sources };
}

function validPermissionRule(rule) {
  return typeof rule === 'string' && rule.length >= 1 && rule.length <= 500 && !/[\r\n\x00-\x1f]/.test(rule);
}

// Apply fn to the parsed settings file for a scope, then write it back.
// Refuses to touch a file that exists but doesn't parse — never clobber.
function editSettingsFile(scope, fn) {
  const src = permissionSources().find(s => s.scope === scope);
  if (!src) throw new Error('invalid scope');
  let json = {};
  if (exists(src.path)) {
    json = readJSON(src.path);
    if (json === null) throw new Error(`${src.path} exists but is not valid JSON — fix it by hand first`);
  }
  fn(json);
  fs.mkdirSync(path.dirname(src.path), { recursive: true });
  fs.writeFileSync(src.path, JSON.stringify(json, null, 2) + '\n');
}

function permissionAdd(json, list, rule) {
  json.permissions = json.permissions || {};
  const arr = (json.permissions[list] = json.permissions[list] || []);
  if (arr.includes(rule)) throw new Error(`rule already in ${list}`);
  arr.push(rule);
}

function permissionRemove(json, list, rule) {
  const arr = json.permissions?.[list];
  const i = Array.isArray(arr) ? arr.indexOf(rule) : -1;
  if (i === -1) throw new Error(`rule not found in ${list}`);
  arr.splice(i, 1);
  // Leave no empty husks behind — removing the last rule removes the key
  if (arr.length === 0) delete json.permissions[list];
  if (Object.keys(json.permissions).length === 0) delete json.permissions;
}

function applyPermissionOp(body) {
  const { op, rule } = body || {};
  if (!validPermissionRule(rule)) throw new Error('invalid rule');
  const check = (scope, list) => {
    if (!PERMISSION_SCOPES.includes(scope)) throw new Error('invalid scope');
    if (!PERMISSION_LISTS.includes(list)) throw new Error('invalid list');
  };
  if (op === 'add') {
    check(body.scope, body.list);
    takeSnapshot(`perm-add-${body.list}`);
    editSettingsFile(body.scope, j => permissionAdd(j, body.list, rule));
  } else if (op === 'remove') {
    check(body.scope, body.list);
    takeSnapshot(`perm-remove-${body.list}`);
    editSettingsFile(body.scope, j => permissionRemove(j, body.list, rule));
  } else if (op === 'move') {
    const { from, to } = body;
    check(from?.scope, from?.list);
    check(to?.scope, to?.list);
    if (from.scope === to.scope && from.list === to.list) throw new Error('source and destination are the same');
    takeSnapshot(`perm-move-${from.list}-to-${to.list}`);
    if (from.scope === to.scope) {
      editSettingsFile(from.scope, j => { permissionRemove(j, from.list, rule); permissionAdd(j, to.list, rule); });
    } else {
      // Add to destination first so a failure never loses the rule
      editSettingsFile(to.scope, j => permissionAdd(j, to.list, rule));
      editSettingsFile(from.scope, j => permissionRemove(j, from.list, rule));
    }
  } else {
    throw new Error('op must be add, remove, or move');
  }
}

function loadMemory() {
  const candidates = [
    { scope: 'project', path: path.join(process.cwd(), 'CLAUDE.md') },
    { scope: 'user', path: path.join(CLAUDE_DIR, 'CLAUDE.md') }
  ];
  const sources = candidates.map(c => ({
    ...c,
    exists: exists(c.path),
    content: readText(c.path)
  }));
  return { sources };
}

function loadSettings() {
  const userPath = path.join(CLAUDE_DIR, 'settings.json');
  const projectPath = path.join(process.cwd(), '.claude', 'settings.json');
  const projectLocalPath = path.join(process.cwd(), '.claude', 'settings.local.json');
  return {
    sources: [
      { scope: 'user', path: userPath, exists: exists(userPath), content: readJSON(userPath) },
      { scope: 'project', path: projectPath, exists: exists(projectPath), content: readJSON(projectPath) },
      { scope: 'project-local', path: projectLocalPath, exists: exists(projectLocalPath), content: readJSON(projectLocalPath) }
    ],
    user: readJSON(userPath) || {},
    project: readJSON(projectPath) || null,
    projectLocal: readJSON(projectLocalPath) || null
  };
}

// ---------- Ring 1 + Ring 2 additions ----------

function loadMarketplaces(installedPlugins) {
  const installedKeys = new Set(installedPlugins.map(p => p.id));
  const root = path.join(CLAUDE_DIR, 'plugins', 'marketplaces');
  const out = [];
  for (const name of listDir(root)) {
    const manifest =
      readJSON(path.join(root, name, '.claude-plugin', 'marketplace.json')) ||
      readJSON(path.join(root, name, 'marketplace.json'));
    if (!manifest) continue;
    const plugins = (manifest.plugins || []).map(pl => ({
      name: pl.name,
      description: pl.description || '',
      author: pl.author?.name || manifest.owner?.name || '',
      category: pl.category || '',
      source: pl.source?.url || pl.source?.source || '',
      homepage: pl.homepage || '',
      installed: installedKeys.has(`${pl.name}@${name}`)
    }));
    out.push({
      name,
      description: manifest.description || '',
      owner: manifest.owner?.name || '',
      pluginCount: plugins.length,
      installedCount: plugins.filter(p => p.installed).length,
      plugins
    });
  }
  return out;
}

function loadSessions() {
  const root = path.join(CLAUDE_DIR, 'projects');
  const projects = [];
  let totalSessions = 0;
  let totalMessages = 0;
  const recent = [];
  for (const dir of listDir(root)) {
    const idx = readJSON(path.join(root, dir, 'sessions-index.json'));
    if (!idx?.entries) continue;
    const entries = idx.entries;
    const messages = entries.reduce((s, e) => s + (e.messageCount || 0), 0);
    const lastModified = entries.reduce((m, e) => Math.max(m, e.fileMtime || 0), 0);
    projects.push({
      key: dir,
      projectPath: idx.originalPath || dir,
      sessionCount: entries.length,
      messageCount: messages,
      lastModified
    });
    totalSessions += entries.length;
    totalMessages += messages;
    for (const e of entries) {
      recent.push({
        sessionId: e.sessionId,
        projectPath: idx.originalPath || dir,
        summary: e.summary || e.firstPrompt || '(no summary)',
        messageCount: e.messageCount || 0,
        modified: e.modified || (e.fileMtime ? new Date(e.fileMtime).toISOString() : null),
        gitBranch: e.gitBranch || ''
      });
    }
  }
  recent.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  projects.sort((a, b) => b.lastModified - a.lastModified);
  return {
    totalSessions,
    totalMessages,
    projectCount: projects.length,
    projects: projects.slice(0, 50),
    recent: recent.slice(0, 25)
  };
}

function checkHookHealth(hooks) {
  return hooks.map(h => {
    const cmd = h.cmd || '';
    // Try to extract a referenced file path from common patterns
    let scriptPath = null;
    let kind = 'inline';
    const m =
      cmd.match(/(?:node|bash|sh|python3?|deno|ruby)\s+["']?([^"'\s]+)["']?/) ||
      cmd.match(/^["']?(\/[^"'\s]+\.(?:sh|js|mjs|ts|py|rb))/);
    if (m) {
      scriptPath = m[1];
      kind = 'script';
    }
    let scriptExists = null;
    let executable = null;
    if (scriptPath) {
      scriptExists = exists(scriptPath);
      if (scriptExists) {
        try {
          const st = fs.statSync(scriptPath);
          executable = !!(st.mode & 0o111);
        } catch { executable = null; }
      }
    }
    let status = 'ok';
    if (scriptPath && !scriptExists) status = 'broken';
    return { ...h, scriptPath, scriptKind: kind, scriptExists, executable, health: status };
  });
}

function detectConflicts(state) {
  const conflicts = [];

  // Duplicate slash command names
  const cmdByName = {};
  for (const c of state.commands) {
    (cmdByName[c.name] = cmdByName[c.name] || []).push(c.plugin);
  }
  for (const [name, owners] of Object.entries(cmdByName)) {
    if (owners.length > 1) {
      conflicts.push({
        kind: 'duplicate-command',
        severity: 'warning',
        title: `Slash command \`${name}\` is defined in ${owners.length} places`,
        detail: `Defined by: ${owners.join(', ')}`
      });
    }
  }

  // Duplicate agent names
  const agentByName = {};
  for (const a of state.agents) {
    (agentByName[a.name] = agentByName[a.name] || []).push(a.plugin);
  }
  for (const [name, owners] of Object.entries(agentByName)) {
    if (owners.length > 1) {
      conflicts.push({
        kind: 'duplicate-agent',
        severity: 'warning',
        title: `Subagent \`${name}\` is defined in ${owners.length} places`,
        detail: `Defined by: ${owners.join(', ')}`
      });
    }
  }

  // Broken hooks
  const broken = state.hooks.filter(h => h.health === 'broken');
  for (const h of broken) {
    conflicts.push({
      kind: 'broken-hook',
      severity: 'error',
      title: `Hook references missing file`,
      detail: `${h.event} hook can't find ${h.scriptPath} (${h.source})`
    });
  }

  // Disconnected MCP
  for (const m of state.mcp) {
    if (m.status === 'disconnected') {
      conflicts.push({
        kind: 'mcp-disconnected',
        severity: 'warning',
        title: `MCP server \`${m.name}\` not connected`,
        detail: m.url
      });
    }
  }

  return conflicts;
}

function buildCommandAgentLinks(commands, agents) {
  const agentNames = new Set(agents.map(a => a.name));
  for (const c of commands) {
    if (!c.source || !exists(c.source)) { c.invokesAgents = []; continue; }
    const text = readText(c.source) || '';
    const mentioned = [];
    for (const name of agentNames) {
      if (text.includes(name)) mentioned.push(name);
    }
    c.invokesAgents = mentioned;
  }
}

function readScriptPreview(scriptPath, maxBytes = 4000) {
  if (!scriptPath || !exists(scriptPath)) return null;
  try {
    const buf = fs.readFileSync(scriptPath, 'utf8');
    if (buf.length <= maxBytes) return buf;
    return buf.slice(0, maxBytes) + `\n\n... (truncated, ${buf.length - maxBytes} more bytes)`;
  } catch { return null; }
}

function lifecycleFromHooks(hooks) {
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'SubagentStop', 'Stop'];
  return events.map(name => ({
    name,
    desc: name,
    count: hooks.filter(h => h.event === name).length
  }));
}

// ---------- Context budget ----------
// Estimate what a fresh session pays in tokens before the first prompt:
// CLAUDE.md contents, the memory index, and the name+description lines that
// advertise every skill, slash command, and subagent. Heuristic: 1 token ≈ 4 chars.

const estTokens = (s) => Math.ceil(String(s || '').length / 4);

function loadContextBudget(plugins, commands, agents, skills, memory) {
  const groups = [];

  // CLAUDE.md + memory index — injected verbatim
  const mdItems = [];
  for (const src of memory.sources) {
    if (src.exists && src.content) {
      mdItems.push({ name: `CLAUDE.md (${src.scope})`, owner: src.scope, tokens: estTokens(src.content), source: src.path });
    }
  }
  const memoryIndex = path.join(CLAUDE_DIR, 'projects', process.cwd().replace(/[\/.]/g, '-'), 'memory', 'MEMORY.md');
  if (exists(memoryIndex)) {
    mdItems.push({ name: 'Memory index (MEMORY.md)', owner: 'user', tokens: estTokens(readText(memoryIndex)), source: memoryIndex });
  }
  groups.push({ key: 'claude-md', label: 'CLAUDE.md & memory', desc: 'Injected verbatim into every session', items: mdItems });

  // Descriptions advertised to the model each session
  groups.push({
    key: 'skills', label: 'Skill descriptions', desc: 'Every available skill is announced by name + description',
    items: skills.map(s => ({ name: s.name, owner: s.plugin, tokens: estTokens(s.name + ': ' + s.desc) + 2 }))
  });
  groups.push({
    key: 'commands', label: 'Slash command descriptions', desc: 'Every command is announced by name + description',
    items: commands.map(c => ({ name: c.name, owner: c.plugin, tokens: estTokens(c.name + ': ' + c.desc) + 2 }))
  });
  groups.push({
    key: 'agents', label: 'Subagent descriptions', desc: 'Every agent type is announced by name + description + tool list',
    items: agents.map(a => ({ name: a.name, owner: a.plugin, tokens: estTokens(a.name + ': ' + a.desc + ' ' + (a.tools || []).join(', ')) + 2 }))
  });

  for (const g of groups) {
    g.items.sort((a, b) => b.tokens - a.tokens);
    g.tokens = g.items.reduce((s, i) => s + i.tokens, 0);
  }

  // Per-owner aggregation: what disabling a plugin would save
  const perOwner = {};
  for (const g of groups) {
    for (const i of g.items) {
      perOwner[i.owner] = (perOwner[i.owner] || 0) + i.tokens;
    }
  }
  const enabledById = Object.fromEntries(plugins.map(p => [p.name, p.enabled]));
  const perPlugin = Object.entries(perOwner)
    .map(([owner, tokens]) => ({
      owner,
      tokens,
      kind: plugins.some(p => p.name === owner) ? 'plugin' : 'config',
      enabled: owner in enabledById ? enabledById[owner] : true
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    total: groups.reduce((s, g) => s + g.tokens, 0),
    note: 'Estimates use ~4 characters per token. MCP tool schemas are not included — they depend on which servers connect and whether their tools are deferred.',
    groups,
    perPlugin
  };
}

// ---------- Mutations: snapshots + plugin actions ----------

const SNAPSHOT_ROOT = path.join(CLAUDE_DIR, 'cc-manager', 'snapshots');
const SNAPSHOT_KEEP = 40;

// Files a plugin mutation can touch. Snapshot all of them before any write.
function mutationTargets() {
  return [
    path.join(CLAUDE_DIR, 'settings.json'),
    path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'),
    path.join(CLAUDE_DIR, 'plugins', 'config.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json')
  ];
}

function takeSnapshot(action, files = mutationTargets()) {
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '__' + action.replace(/[^A-Za-z0-9_-]/g, '_');
  const dir = path.join(SNAPSHOT_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { id, action, createdAt: new Date().toISOString(), files: [] };
  files.forEach((original, i) => {
    const existed = exists(original);
    const stored = `${i}__${path.basename(original)}`;
    if (existed) fs.copyFileSync(original, path.join(dir, stored));
    manifest.files.push({ original, stored, existed });
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  pruneSnapshots();
  return manifest;
}

function pruneSnapshots() {
  const dirs = listDir(SNAPSHOT_ROOT).sort().reverse();
  for (const d of dirs.slice(SNAPSHOT_KEEP)) {
    try { fs.rmSync(path.join(SNAPSHOT_ROOT, d), { recursive: true, force: true }); } catch {}
  }
}

function listSnapshots() {
  return listDir(SNAPSHOT_ROOT)
    .sort().reverse()
    .map(d => readJSON(path.join(SNAPSHOT_ROOT, d, 'manifest.json')))
    .filter(Boolean)
    .map(m => ({
      id: m.id,
      action: m.action,
      createdAt: m.createdAt,
      fileCount: m.files.filter(f => f.existed).length
    }));
}

function restoreSnapshot(id) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('invalid snapshot id');
  const dir = path.join(SNAPSHOT_ROOT, id);
  const manifest = readJSON(path.join(dir, 'manifest.json'));
  if (!manifest) throw new Error('snapshot not found');
  // Snapshot the current state first so a restore is itself undoable
  takeSnapshot('pre-restore', manifest.files.map(f => f.original));
  const restored = [];
  const skipped = [];
  for (const f of manifest.files) {
    if (f.existed) {
      fs.mkdirSync(path.dirname(f.original), { recursive: true });
      fs.copyFileSync(path.join(dir, f.stored), f.original);
      restored.push(f.original);
    } else if (exists(f.original)) {
      // File didn't exist at snapshot time but does now — leave it, just report
      skipped.push(f.original);
    }
  }
  return { restored, skipped };
}

const PLUGIN_ACTIONS = new Set(['enable', 'disable', 'install', 'uninstall', 'update']);

function runClaudePlugin(action, plugin, scope) {
  return import('node:child_process').then(({ spawn }) => new Promise((resolve) => {
    const args = ['plugin', action, plugin];
    if (scope && action !== 'update') args.push('--scope', scope);
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, error: `timed out after 120s`, stdout, stderr });
    }, 120000);
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', e => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.code === 'ENOENT' ? 'claude CLI not found on PATH' : String(e), stdout, stderr });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', d => {
      buf += d;
      if (buf.length > 65536) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function buildState() {
  const plugins = loadPlugins();
  const rawHooks = loadHooks(plugins);
  const hooks = checkHookHealth(rawHooks);
  const commands = loadCommands(plugins);
  const agents = loadAgents(plugins);
  buildCommandAgentLinks(commands, agents);
  const mcp = loadMcp();
  const skills = loadSkills(plugins);
  const memory = loadMemory();
  const state = {
    plugins,
    commands,
    agents,
    skills,
    hooks,
    mcp,
    permissions: loadPermissions(),
    memory,
    contextBudget: loadContextBudget(plugins, commands, agents, skills, memory),
    settings: loadSettings(),
    marketplaces: loadMarketplaces(plugins),
    sessions: loadSessions(),
    snapshots: listSnapshots(),
    lifecycleEvents: lifecycleFromHooks(hooks),
    meta: {
      generatedAt: new Date().toISOString(),
      claudeDir: CLAUDE_DIR,
      cwd: process.cwd()
    }
  };
  state.conflicts = detectConflicts(state);
  return state;
}

const HTML_PATH = path.join(__dirname, 'cc-manager.html');

// Allow file reads only inside these roots (safety boundary for /api/script)
const ALLOWED_ROOTS = [CLAUDE_DIR, process.cwd()];
function isPathSafe(p) {
  const abs = path.resolve(p);
  return ALLOWED_ROOTS.some(r => abs === r || abs.startsWith(r + path.sep));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/state') {
    try {
      const state = buildState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  if (u.pathname === '/api/plugin' && req.method === 'POST') {
    readBody(req).then(async body => {
      const { action, plugin, scope } = body || {};
      if (!PLUGIN_ACTIONS.has(action)) throw new Error(`action must be one of: ${[...PLUGIN_ACTIONS].join(', ')}`);
      if (typeof plugin !== 'string' || !/^[A-Za-z0-9@._\/-]{1,200}$/.test(plugin)) throw new Error('invalid plugin name');
      if (scope !== undefined && !['user', 'project', 'local'].includes(scope)) throw new Error('invalid scope');
      const snapshot = takeSnapshot(`${action}-${plugin}`);
      const result = await runClaudePlugin(action, plugin, scope);
      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, error: result.ok ? undefined : (result.error || result.stderr || result.stdout || `exit code ${result.code}`), snapshotId: snapshot.id }));
    }).catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    });
    return;
  }
  if (u.pathname === '/api/permissions' && req.method === 'POST') {
    readBody(req).then(body => {
      applyPermissionOp(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, permissions: loadPermissions() }));
    }).catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    });
    return;
  }
  if (u.pathname === '/api/snapshots' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ snapshots: listSnapshots() }));
    return;
  }
  if (u.pathname === '/api/snapshots/restore' && req.method === 'POST') {
    readBody(req).then(body => {
      const result = restoreSnapshot(String(body?.id || ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    }).catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    });
    return;
  }
  if (u.pathname === '/api/script') {
    const p = u.searchParams.get('path');
    if (!p || !isPathSafe(p)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'path missing or outside allowed roots' }));
      return;
    }
    const content = readScriptPreview(p, 16000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: p, exists: exists(p), content }));
    return;
  }
  if (u.pathname === '/api/open') {
    const p = u.searchParams.get('path');
    const action = u.searchParams.get('action') || 'open'; // 'open' | 'reveal'
    if (!p || !isPathSafe(p) || !exists(p)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'path missing, outside allowed roots, or does not exist' }));
      return;
    }
    import('node:child_process').then(({ spawn }) => {
      let cmd, args;
      if (process.platform === 'darwin') {
        cmd = 'open';
        args = action === 'reveal' ? ['-R', p] : [p];
      } else if (process.platform === 'win32') {
        cmd = 'explorer';
        args = action === 'reveal' ? ['/select,', p] : [p];
      } else {
        cmd = 'xdg-open';
        args = [action === 'reveal' ? path.dirname(p) : p];
      }
      try {
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(HTML_PATH));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const PIDFILE = '/tmp/cc-manager.pid';

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`cc-manager running at ${url}`);
  try { fs.writeFileSync(PIDFILE, String(process.pid)); } catch {}
  if (!process.env.NO_OPEN) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ spawn }) => spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref());
  }
});

const cleanup = () => {
  try { if (fs.readFileSync(PIDFILE, 'utf8') == String(process.pid)) fs.unlinkSync(PIDFILE); } catch {}
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
