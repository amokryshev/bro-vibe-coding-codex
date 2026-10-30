import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

const PHASE_BUDGET_MS = 10_000;
const OVERALL_BUDGET_MS = 60_000;
const TARGET_ID_PATTERN = /^target:sha256:[0-9a-f]{64}$/u;

class ProbeFailure extends Error {
  constructor(reasonCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
  }
}

function plainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

export function emailEndpointKey(host, port) {
  const normalized = host.toLowerCase();
  return net.isIP(normalized) === 6
    ? `[${normalized}]:${port}`
    : `${normalized}:${port}`;
}

function validPrivateEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint !== endpoint.toLowerCase()) return false;
  const match = /^(?:([^\s:[\]]+)|\[([0-9a-f:]+)\]):(\d{1,5})$/u.exec(endpoint);
  if (match === null) return false;
  const port = Number(match[3]);
  return port >= 1 && port <= 65_535 && (match[2] === undefined || net.isIP(match[2]) === 6);
}

function ipv4Bytes(address) {
  if (net.isIP(address) !== 4) return undefined;
  return address.split(".").map(Number);
}

function ipv6Bytes(address) {
  if (net.isIP(address) !== 6) return undefined;
  let normalized = address.toLowerCase();
  const zone = normalized.indexOf("%");
  if (zone >= 0) normalized = normalized.slice(0, zone);
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half) => half === "" ? [] : half.split(":").flatMap((part) => {
    if (part.includes(".")) {
      const bytes = ipv4Bytes(part);
      if (bytes === undefined) return [];
      return [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
    }
    return [Number.parseInt(part, 16)];
  });
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array(fill).fill(0), ...right];
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word))) return undefined;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

export function classifyEmailAddress(address) {
  const v4 = ipv4Bytes(address);
  if (v4 !== undefined) {
    const [a, b] = v4;
    if (v4.every((byte) => byte === 0)) return "forbidden";
    if (a === 127 || (a === 169 && b === 254) || a >= 224) return "forbidden";
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) return "private";
    return "public";
  }
  const v6 = ipv6Bytes(address);
  if (v6 === undefined) return "invalid";
  if (v6.every((byte) => byte === 0)) return "forbidden";
  if (v6.slice(0, 15).every((byte) => byte === 0) && v6[15] === 1) return "forbidden";
  if (v6[0] === 0xff || (v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80)) return "forbidden";
  if (v6[0] === 0xfc || v6[0] === 0xfd) return "private";
  if (v6.slice(0, 10).every((byte) => byte === 0) && v6[10] === 0xff && v6[11] === 0xff) {
    return classifyEmailAddress(v6.slice(12).join("."));
  }
  return "public";
}

function validateRequest(request) {
  if (
    !plainObject(request) ||
    !plainObject(request.configuration) ||
    !plainObject(request.destination_policy) ||
    !plainObject(request.runtime) ||
    typeof request.runtime.start !== "function" ||
    !TARGET_ID_PATTERN.test(request.target_id ?? "") ||
    !Array.isArray(request.destination_policy.private_endpoints) ||
    request.destination_policy.private_endpoints.some((entry) => !validPrivateEndpoint(entry))
  ) {
    throw new TypeError("invalid Email connection probe request");
  }
  const configuration = request.configuration;
  for (const key of [
    "MCP_EMAIL_ADDRESS",
    "MCP_EMAIL_PASSWORD",
    "MCP_EMAIL_IMAP_HOST",
    "MCP_EMAIL_IMAP_PORT",
    "MCP_EMAIL_SMTP_HOST",
    "MCP_EMAIL_SMTP_PORT",
  ]) {
    if (typeof configuration[key] !== "string" || configuration[key] === "") {
      throw new TypeError("invalid Email connection probe configuration");
    }
  }
}

export function normalizeEmailDestinationPolicy(policy) {
  if (
    !plainObject(policy) ||
    Object.keys(policy).length !== 1 ||
    !Array.isArray(policy.private_endpoints) ||
    policy.private_endpoints.some((entry) => !validPrivateEndpoint(entry)) ||
    new Set(policy.private_endpoints).size !== policy.private_endpoints.length
  ) {
    throw new TypeError("invalid Email destination policy");
  }
  return Object.freeze({
    private_endpoints: Object.freeze([...policy.private_endpoints].sort()),
  });
}

async function authorizeDestinations(request, resolve, signal) {
  const [imapAnswers, smtpAnswers] = await Promise.all([
    resolve(request.configuration.MCP_EMAIL_IMAP_HOST, signal),
    resolve(request.configuration.MCP_EMAIL_SMTP_HOST, signal),
  ]);
  const privateEndpoints = new Set(request.destination_policy.private_endpoints);
  const endpoints = [
    {
      answers: imapAnswers,
      host: request.configuration.MCP_EMAIL_IMAP_HOST,
      port: Number(request.configuration.MCP_EMAIL_IMAP_PORT),
    },
    {
      answers: smtpAnswers,
      host: request.configuration.MCP_EMAIL_SMTP_HOST,
      port: Number(request.configuration.MCP_EMAIL_SMTP_PORT),
    },
  ];
  for (const endpoint of endpoints) {
    if (!Array.isArray(endpoint.answers) || endpoint.answers.length === 0) {
      throw new ProbeFailure("email-destination-policy-failed");
    }
    for (const answer of endpoint.answers) {
      const classification = classifyEmailAddress(answer?.address);
      if (
        classification === "invalid" ||
        classification === "forbidden" ||
        (classification === "private" &&
          !privateEndpoints.has(emailEndpointKey(endpoint.host, endpoint.port)))
      ) {
        throw new ProbeFailure("email-destination-policy-failed");
      }
    }
    endpoint.address = endpoint.answers[0].address;
  }
  return endpoints;
}

function failure(reasonCode, phase) {
  return Object.freeze({
    ok: false,
    reason_code: reasonCode,
    diagnostic: Object.freeze({
      phase,
      next_action: "check-email-settings-and-retry",
    }),
  });
}

async function boundedPhase(reasonCode, operation, overallSignal, schedule, cancel) {
  const controller = new AbortController();
  const abort = () => controller.abort(overallSignal.reason);
  overallSignal.addEventListener("abort", abort, { once: true });
  const timer = schedule(
    () => controller.abort(new ProbeFailure(reasonCode)),
    PHASE_BUDGET_MS,
  );
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true },
    );
  });
  try {
    if (overallSignal.aborted) throw overallSignal.reason;
    const pending = Promise.resolve(operation(controller.signal)).then(value => {
      if (controller.signal.aborted) closeSession(value);
      return value;
    });
    return await Promise.race([pending, aborted]);
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    if (controller.signal.aborted && controller.signal.reason instanceof ProbeFailure) {
      throw controller.signal.reason;
    }
    throw new ProbeFailure(reasonCode);
  } finally {
    cancel(timer);
    overallSignal.removeEventListener("abort", abort);
  }
}

function connectSocket(connect, options, signal, event) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Email connection cancelled")); return; }
    const socket = connect(options);
    const failed = () => {
      socket.destroy();
      reject(new Error("Email socket failed"));
    };
    const aborted = () => failed();
    signal.addEventListener("abort", aborted, { once: true });
    socket.once("close", () => signal.removeEventListener("abort", aborted));
    socket.once("error", failed);
    socket.once(event, () => {
      socket.removeListener("error", failed);
      resolve(socket);
    });
  });
}

class LineChannel {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.lines = [];
    this.waiters = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      while (this.buffer.includes("\n")) {
        const index = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, index + 1);
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter === undefined) this.lines.push(line);
        else waiter.resolve(line);
      }
    });
    socket.on("error", () => this.rejectWaiters());
    socket.on("close", () => this.rejectWaiters());
  }

  rejectWaiters() {
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("Email socket closed"));
  }

  readLine(signal) {
    if (signal.aborted) return Promise.reject(new Error("Email phase aborted"));
    const existing = this.lines.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const aborted = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Email phase aborted"));
      };
      waiter.resolve = (line) => {
        signal.removeEventListener("abort", aborted);
        resolve(line);
      };
      waiter.reject = (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      };
      signal.addEventListener("abort", aborted, { once: true });
      this.waiters.push(waiter);
    });
  }

  write(line) {
    this.socket.write(`${line}\r\n`);
  }

  close() {
    this.socket.destroy();
  }
}

async function smtpResponse(channel, signal, expected) {
  let line = await channel.readLine(signal);
  if (!line.startsWith(expected)) throw new Error("unexpected SMTP response");
  while (line[3] === "-") {
    line = await channel.readLine(signal);
    if (!line.startsWith(expected)) throw new Error("unexpected SMTP continuation");
  }
}

async function defaultOpenImap(endpoint, signal) {
  const socket = await connectSocket(
    (options) => tls.connect(options),
    {
      host: endpoint.address,
      port: endpoint.port,
      rejectUnauthorized: true,
      servername: endpoint.host,
    },
    signal,
    "secureConnect",
  );
  return new LineChannel(socket);
}

function imapQuoted(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function defaultAuthenticateImap(session, credentials, signal) {
  const greeting = await session.readLine(signal);
  if (!/^\* OK /u.test(greeting)) throw new Error("invalid IMAP greeting");
  session.write(`a1 LOGIN ${imapQuoted(credentials.address)} ${imapQuoted(credentials.password)}`);
  const response = await session.readLine(signal);
  if (!/^a1 OK /iu.test(response)) throw new Error("IMAP authentication failed");
  session.write("a2 LOGOUT");
}

async function defaultOpenSmtp(endpoint, signal) {
  let channel;
  try {
    if (endpoint.implicitTls) {
      const socket = await connectSocket(
        (options) => tls.connect(options),
        {
          host: endpoint.address,
          port: endpoint.port,
          rejectUnauthorized: endpoint.verifySsl,
          servername: endpoint.host,
        },
        signal,
        "secureConnect",
      );
      const secure = channel = new LineChannel(socket);
      await smtpResponse(secure, signal, "220");
      return secure;
    }
    const socket = await connectSocket(
      (options) => net.connect(options),
      { host: endpoint.address, port: endpoint.port },
      signal,
      "connect",
    );
    const plaintext = channel = new LineChannel(socket);
    await smtpResponse(plaintext, signal, "220");
    plaintext.write("EHLO bro-vibe-coding.invalid");
    await smtpResponse(plaintext, signal, "250");
    plaintext.write("STARTTLS");
    await smtpResponse(plaintext, signal, "220");
    const secure = await connectSocket(
      (options) => tls.connect(options),
      { rejectUnauthorized: endpoint.verifySsl, servername: endpoint.host, socket },
      signal,
      "secureConnect",
    );
    return new LineChannel(secure);
  } catch (error) { closeSession(channel); throw error; }
}

async function defaultAuthenticateSmtp(session, credentials, signal) {
  session.write("EHLO bro-vibe-coding.invalid");
  await smtpResponse(session, signal, "250");
  const token = Buffer.from(`\0${credentials.address}\0${credentials.password}`, "utf8").toString("base64");
  session.write(`AUTH PLAIN ${token}`);
  await smtpResponse(session, signal, "235");
  session.write("QUIT");
}

export function createDefaultEmailProtocolAdapters() {
  return Object.freeze({
    authenticateImap: defaultAuthenticateImap,
    authenticateSmtp: defaultAuthenticateSmtp,
    openImap: defaultOpenImap,
    openSmtp: defaultOpenSmtp,
    resolve: defaultResolve,
  });
}

function defaultResolve(host) {
  return dns.lookup(host, { all: true, verbatim: true });
}

function closeSession(session) {
  try {
    session?.close?.();
  } catch {
    // Connection cleanup cannot turn a completed phase into another attempt.
  }
}

export function createEmailConnectionProbe(options = {}) {
  const adapters = {
    authenticateImap: options.authenticateImap ?? defaultAuthenticateImap,
    authenticateSmtp: options.authenticateSmtp ?? defaultAuthenticateSmtp,
    openImap: options.openImap ?? defaultOpenImap,
    openSmtp: options.openSmtp ?? defaultOpenSmtp,
    resolve: options.resolve ?? defaultResolve,
  };
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  if (
    Object.values(adapters).some((adapter) => typeof adapter !== "function") ||
    typeof schedule !== "function" ||
    typeof cancel !== "function"
  ) {
    throw new TypeError("invalid Email connection probe adapter");
  }

  return Object.freeze({
    async authorize(request) {
      validateRequest(request);
      const controller = new AbortController();
      const timer = schedule(
        () => controller.abort(new ProbeFailure("email-destination-policy-failed")),
        PHASE_BUDGET_MS,
      );
      try {
        await authorizeDestinations(request, adapters.resolve, controller.signal);
        return Object.freeze({ ok: true, reason_code: "email-destination-authorized" });
      } catch {
        return failure("email-destination-policy-failed", "destination-policy");
      } finally {
        cancel(timer);
      }
    },
    async test(request, { signal } = {}) {
      validateRequest(request);
      const overall = new AbortController();
      const abort = () => overall.abort(new ProbeFailure("email-connection-cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const overallTimer = schedule(
        () => overall.abort(new ProbeFailure("email-connection-deadline-exceeded")),
        OVERALL_BUDGET_MS,
      );
      let imapSession;
      let smtpSession;
      let runtimeCompletion;
      try {
        await boundedPhase(
          "email-parser-runtime-failed",
          (signal) => (runtimeCompletion = Promise.resolve(request.runtime.start(signal))),
          overall.signal,
          schedule,
          cancel,
        );
        const [imapEndpoint, smtpEndpoint] = await boundedPhase(
          "email-dns-failed",
          (signal) => authorizeDestinations(request, adapters.resolve, signal),
          overall.signal,
          schedule,
          cancel,
        );
        imapSession = await boundedPhase(
          "email-imap-tls-failed",
          (signal) => adapters.openImap(imapEndpoint, signal),
          overall.signal,
          schedule,
          cancel,
        );
        await boundedPhase(
          "email-imap-auth-failed",
          (signal) => adapters.authenticateImap(imapSession, {
            address: request.configuration.MCP_EMAIL_ADDRESS,
            password: request.configuration.MCP_EMAIL_PASSWORD,
          }, signal),
          overall.signal,
          schedule,
          cancel,
        );
        smtpSession = await boundedPhase(
          "email-smtp-tls-failed",
          (signal) => adapters.openSmtp({
            ...smtpEndpoint,
            implicitTls: request.configuration.MCP_EMAIL_SMTP_TLS === "true",
            verifySsl: request.configuration.MCP_EMAIL_SMTP_VERIFY_SSL === "true",
          }, signal),
          overall.signal,
          schedule,
          cancel,
        );
        await boundedPhase(
          "email-smtp-auth-failed",
          (signal) => adapters.authenticateSmtp(smtpSession, {
            address: request.configuration.MCP_EMAIL_ADDRESS,
            password: request.configuration.MCP_EMAIL_PASSWORD,
          }, signal),
          overall.signal,
          schedule,
          cancel,
        );
        return Object.freeze({
          ok: true,
          reason_code: "email-connection-verified",
          evidence: Object.freeze({
            attempts: Object.freeze({ dns: 1, imap: 1, smtp: 1 }),
            overall_budget_ms: OVERALL_BUDGET_MS,
            phase_budget_ms: Object.freeze(Array(6).fill(PHASE_BUDGET_MS)),
            schema: "bro.email-connection-evidence/v1",
          }),
        });
      } catch (error) {
        const reasonCode = error instanceof ProbeFailure
          ? error.reasonCode
          : "email-connection-deadline-exceeded";
        const phase = reasonCode.replace(/^email-/u, "").replace(/-failed$/u, "");
        return failure(reasonCode, phase);
      } finally {
        signal?.removeEventListener("abort", abort);
        cancel(overallTimer);
        closeSession(imapSession);
        closeSession(smtpSession);
        // The runtime adapter completes only after its child exits, also on abort.
        await runtimeCompletion?.catch(() => {});
      }
    },
  });
}
