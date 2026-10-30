const REQUIRED_KEYS = Object.freeze([
  "MCP_EMAIL_ADDRESS",
  "MCP_EMAIL_PASSWORD",
  "MCP_EMAIL_IMAP_HOST",
  "MCP_EMAIL_IMAP_PORT",
  "MCP_EMAIL_IMAP_TLS",
  "MCP_EMAIL_SMTP_HOST",
  "MCP_EMAIL_SMTP_PORT",
  "MCP_EMAIL_SMTP_TLS",
  "MCP_EMAIL_SMTP_STARTTLS",
  "MCP_EMAIL_SMTP_VERIFY_SSL",
]);

const COMMENTED_DEFAULTS = Object.freeze([
  ["MCP_EMAIL_SMTP_POOL_ENABLED", "true"],
  ["MCP_EMAIL_SMTP_POOL_MAX_CONNECTIONS", "1"],
  ["MCP_EMAIL_SMTP_POOL_MAX_MESSAGES", "100"],
  ["MCP_EMAIL_RATE_LIMIT", "10"],
]);
const OPTIONAL_KEYS = Object.freeze(COMMENTED_DEFAULTS.map(([key]) => key));
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
function plainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function validValue(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function validateConfiguration(configuration) {
  if (!plainObject(configuration)) {
    throw new TypeError("invalid Email configuration");
  }
  const keys = Object.keys(configuration).sort();
  if (
    keys.some((key) => !ALLOWED_KEYS.has(key) || !validValue(configuration[key])) ||
    REQUIRED_KEYS.some((key) => !Object.hasOwn(configuration, key)) ||
    REQUIRED_KEYS.some((key) => !validValue(configuration[key]))
  ) {
    throw new TypeError("invalid Email configuration");
  }
  if (
    !/^[^\s@]+@[^\s@]+$/u.test(configuration.MCP_EMAIL_ADDRESS) ||
    /\s/u.test(configuration.MCP_EMAIL_IMAP_HOST) ||
    /\s/u.test(configuration.MCP_EMAIL_SMTP_HOST)
  ) {
    throw new TypeError("invalid Email endpoint");
  }
  if (
    configuration.MCP_EMAIL_IMAP_PORT !== "993" ||
    configuration.MCP_EMAIL_IMAP_TLS !== "true" ||
    configuration.MCP_EMAIL_SMTP_VERIFY_SSL !== "true" ||
    ![
      ["465", "true", "false"],
      ["587", "false", "true"],
    ].some(([port, tls, starttls]) =>
      configuration.MCP_EMAIL_SMTP_PORT === port &&
      configuration.MCP_EMAIL_SMTP_TLS === tls &&
      configuration.MCP_EMAIL_SMTP_STARTTLS === starttls
    )
  ) {
    throw new TypeError("invalid Email transport");
  }
  for (const key of [
    "MCP_EMAIL_SMTP_POOL_MAX_CONNECTIONS",
    "MCP_EMAIL_SMTP_POOL_MAX_MESSAGES",
    "MCP_EMAIL_RATE_LIMIT",
  ]) {
    if (configuration[key] !== undefined && !/^[1-9][0-9]*$/u.test(configuration[key])) {
      throw new TypeError("invalid Email tuning");
    }
  }
  if (
    configuration.MCP_EMAIL_SMTP_POOL_ENABLED !== undefined &&
    !["true", "false"].includes(configuration.MCP_EMAIL_SMTP_POOL_ENABLED)
  ) {
    throw new TypeError("invalid Email tuning");
  }
}


export { validateConfiguration, REQUIRED_KEYS, OPTIONAL_KEYS };
