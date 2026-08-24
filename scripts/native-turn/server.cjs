const os = require("node:os");
const Turn = require("node-turn");

// node-turn's Data slices are plain Buffers on current Node releases. The
// server only needs readBit on those attribute views (notably EVEN-PORT).
if (typeof Buffer.prototype.readBit !== "function") {
  Object.defineProperty(Buffer.prototype, "readBit", {
    configurable: true,
    value(index) {
      const byte = index >> 3;
      const bit = index & 7;
      return Boolean(this[byte] & (128 >> bit));
    },
  });
}

const USERNAME = "motionmirror-dev";
const CREDENTIAL = "mm-local-turn-8f3ce74a";

function findLanAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  return addresses.find((address) => address.startsWith("192.168."))
    || addresses.find((address) => address.startsWith("10."))
    || addresses.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address))
    || addresses[0]
    || null;
}

const lanAddress = process.env.MOTIONMIRROR_TURN_LAN_ADDRESS || findLanAddress();
if (!lanAddress) {
  throw new Error("No private LAN IPv4 address was found for the TURN relay.");
}

function createServer(listeningPort, minPort, maxPort) {
  return new Turn({
    listeningPort,
    listeningIps: [lanAddress],
    relayIps: [lanAddress],
    externalIps: lanAddress,
    minPort,
    maxPort,
    authMech: "long-term",
    credentials: { [USERNAME]: CREDENTIAL },
    realm: "motionmirror.local",
    debugLevel: "INFO",
    log: (message) => console.log(`[TURN:${listeningPort}] ${message}`),
  });
}

const servers = [
  createServer(443, 49160, 49204),
  createServer(3478, 49205, 49250),
];

servers.forEach((server) => server.start());
console.log(`[TURN] MotionMirror LAN relay starting on ${lanAddress} (UDP 443 and 3478).`);

function shutdown() {
  servers.forEach((server) => server.stop());
  setTimeout(() => process.exit(0), 50);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
