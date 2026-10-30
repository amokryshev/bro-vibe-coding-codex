import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const raw = process.env.BRO_EMAIL_RUNTIME_POLICY;
delete process.env.BRO_EMAIL_RUNTIME_POLICY;
let policy;
try { policy = JSON.parse(raw); } catch { throw new Error("invalid Email runtime policy"); }
if (!Array.isArray(policy?.endpoints) || !Array.isArray(policy?.private_endpoints)) {
  throw new Error("invalid Email runtime policy");
}
const endpointKey = (host, port) => net.isIP(String(host).toLowerCase()) === 6
  ? "[" + String(host).toLowerCase() + "]:" + port
  : String(host).toLowerCase() + ":" + port;
const allowedEndpoints = new Set(policy.endpoints.map(({ host, port }) => endpointKey(host, port)));
const privateEndpoints = new Set(policy.private_endpoints);
const authorizedAddresses = new Map();
const ipv4 = (address) => net.isIP(address) === 4 ? address.split(".").map(Number) : undefined;
const ipv6 = (address) => {
  if (net.isIP(address) !== 6) return undefined;
  const halves = address.toLowerCase().split("::");
  const parse = (half) => half === "" ? [] : half.split(":").flatMap((part) => {
    if (part.includes(".")) {
      const bytes = ipv4(part);
      return bytes === undefined ? [] : [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
    }
    return [Number.parseInt(part, 16)];
  });
  const left = parse(halves[0]);
  const right = parse(halves[1] ?? "");
  const words = [...left, ...Array(halves.length === 2 ? 8 - left.length - right.length : 0).fill(0), ...right];
  return words.length === 8 ? words.flatMap((word) => [word >> 8, word & 255]) : undefined;
};
const classify = (address) => {
  const v4 = ipv4(address);
  if (v4 !== undefined) {
    const [a, b] = v4;
    if (v4.every((byte) => byte === 0) || a === 127 || (a === 169 && b === 254) || a >= 224) return "forbidden";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
    return "public";
  }
  const v6 = ipv6(address);
  if (v6 === undefined) return "invalid";
  if (v6.every((byte) => byte === 0) || (v6.slice(0, 15).every((byte) => byte === 0) && v6[15] === 1)) return "forbidden";
  if (v6[0] === 255 || (v6[0] === 254 && (v6[1] & 192) === 128)) return "forbidden";
  if (v6[0] === 252 || v6[0] === 253) return "private";
  if (v6.slice(0, 10).every((byte) => byte === 0) && v6[10] === 255 && v6[11] === 255) return classify(v6.slice(12).join("."));
  return "public";
};
const authorizeAddress = (host, port, address) => {
  const kind = classify(address);
  const key = endpointKey(host, port);
  if (!allowedEndpoints.has(key) || kind === "invalid" || kind === "forbidden" || (kind === "private" && !privateEndpoints.has(key))) {
    throw new Error("Email runtime destination policy rejected connection");
  }
  const ports = authorizedAddresses.get(address) ?? new Set();
  ports.add(Number(port));
  authorizedAddresses.set(address, ports);
};
const originalLookup = dns.lookup.bind(dns);
dns.lookup = (host, options, callback) => {
  if (typeof options === "function") { callback = options; options = {}; }
  if (typeof options === "number") options = { family: options };
  options ??= {};
  const endpoints = policy.endpoints.filter((endpoint) => String(endpoint.host).toLowerCase() === String(host).toLowerCase());
  if (endpoints.length === 0) return queueMicrotask(() => callback(new Error("Email runtime destination is not configured")));
  originalLookup(host, { ...options, all: true, verbatim: true }, (error, answers) => {
    if (error) return callback(error);
    try { for (const answer of answers) for (const endpoint of endpoints) authorizeAddress(host, endpoint.port, answer.address); }
    catch (policyError) { return callback(policyError); }
    return options.all ? callback(null, answers) : callback(null, answers[0].address, answers[0].family);
  });
};
for (const method of ["resolve4", "resolve6"]) {
  const originalResolve = dns.Resolver.prototype[method];
  dns.Resolver.prototype[method] = function (host, ...args) {
    const callback = args.pop();
    const endpoints = policy.endpoints.filter((endpoint) => String(endpoint.host).toLowerCase() === String(host).toLowerCase());
    if (endpoints.length === 0) return queueMicrotask(() => callback(new Error("Email runtime destination is not configured")));
    return originalResolve.call(this, host, ...args, (error, answers) => {
      if (error) return callback(error);
      try {
        for (const answer of answers) {
          const address = typeof answer === "string" ? answer : answer.address;
          for (const endpoint of endpoints) authorizeAddress(host, endpoint.port, address);
        }
      } catch (policyError) { return callback(policyError); }
      return callback(null, answers);
    });
  };
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.createConnection passes Node's normalized [options, callback] tuple;
  // tls.connect passes the options object directly.
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (options === null || typeof options !== "object" || options.path !== undefined) {
    throw new Error("Email runtime destination is not configured");
  }
  const host = options.host ?? "localhost";
  const port = Number(options.port);
  const key = endpointKey(host, port);
  const resolvedPorts = net.isIP(host) !== 0 ? authorizedAddresses.get(host) : undefined;
  if (
    !allowedEndpoints.has(key) &&
    !resolvedPorts?.has(port)
  ) throw new Error("Email runtime destination is not configured");
  if (net.isIP(host) !== 0 && allowedEndpoints.has(key)) authorizeAddress(host, port, host);
  if (!allowedEndpoints.has(key) && resolvedPorts?.has(port)) {
    resolvedPorts.delete(port);
    if (resolvedPorts.size === 0) authorizedAddresses.delete(host);
  }
  return originalConnect.apply(this, args);
};
syncBuiltinESMExports();
