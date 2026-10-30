// Unmodified upstream services, with an explicitly bounded Email-only composition.
// No startup scheduler, watcher, sampling hooks, local calendars or external commands.
import { StdioServerTransport } from './vendor/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { loadConfig } from './vendor/node_modules/@codefuturist/email-mcp/dist/config/loader.js';
import ConnectionManager from './vendor/node_modules/@codefuturist/email-mcp/dist/connections/manager.js';
import createServer from './vendor/node_modules/@codefuturist/email-mcp/dist/server.js';
import { bindServer, markInitialized } from './vendor/node_modules/@codefuturist/email-mcp/dist/logging.js';
import RateLimiter from './vendor/node_modules/@codefuturist/email-mcp/dist/safety/rate-limiter.js';
import audit from './vendor/node_modules/@codefuturist/email-mcp/dist/safety/audit.js';
import ImapService from './vendor/node_modules/@codefuturist/email-mcp/dist/services/imap.service.js';
import SmtpService from './vendor/node_modules/@codefuturist/email-mcp/dist/services/smtp.service.js';
import registerAccounts from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/accounts.tool.js';
import registerMailboxes from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/mailboxes.tool.js';
import registerEmails from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/emails.tool.js';
import registerAttachments from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/attachments.tool.js';
import registerContacts from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/contacts.tool.js';
import registerThreads from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/thread.tool.js';
import registerAnalytics from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/analytics.tool.js';
import registerHealth from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/health.tool.js';
import registerLocate from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/locate.tool.js';
import registerSend from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/send.tool.js';
import registerManage from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/manage.tool.js';
import registerLabels from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/label.tool.js';
import registerBulk from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/bulk.tool.js';
import registerDrafts from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/drafts.tool.js';
import registerFolders from './vendor/node_modules/@codefuturist/email-mcp/dist/tools/folders.tool.js';
import { REQUIRED_KEYS, OPTIONAL_KEYS, validateConfiguration } from './account.mjs';

// Reject incomplete env before upstream can consider its TOML fallback.
validateConfiguration(Object.fromEntries([...REQUIRED_KEYS, ...OPTIONAL_KEYS]
  .filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]])));
const config = await loadConfig();
const password = config.accounts[0].password;
delete process.env.MCP_EMAIL_PASSWORD;
const redact = value => {
  if (typeof value === 'string') return value.replaceAll(password, '[redacted]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
};
const log = audit.log.bind(audit);
audit.log = (operation, account, params, result, error) => log(operation, account, redact(params), result, error === undefined ? undefined : 'Email operation failed.');
const connections = new ConnectionManager(config.accounts);
const imap = new ImapService(connections);
const smtp = new SmtpService(connections, new RateLimiter(config.settings.rateLimit), imap);
const server = createServer();
const sendLog = server.sendLoggingMessage.bind(server);
server.sendLoggingMessage = message => sendLog(redact({ ...message, ...(['error', 'critical', 'alert', 'emergency'].includes(message.level) ? { data: 'Email operation failed.' } : {}) }));
const tool = server.tool.bind(server);
server.tool = (...args) => {
  const handler = args.pop();
  return tool(...args, async (...parameters) => {
    try {
      const result = await handler(...parameters);
      return result.isError ? { isError: true, content: [{ type: 'text', text: 'Email operation failed.' }] } : redact(result);
    }
    catch { return { isError: true, content: [{ type: 'text', text: 'Email operation failed.' }] }; }
  });
};
bindServer(server);
registerAccounts(server, connections);
registerMailboxes(server, imap);
registerEmails(server, imap);
registerAttachments(server, imap);
registerContacts(server, imap);
registerThreads(server, imap);
registerAnalytics(server, imap);
registerHealth(server, connections, imap);
registerLocate(server, imap);
registerSend(server, smtp);
registerManage(server, imap);
registerLabels(server, imap);
registerBulk(server, imap);
registerDrafts(server, imap, smtp);
registerFolders(server, imap);
server.server.oninitialized = () => markInitialized();
await server.connect(new StdioServerTransport());
