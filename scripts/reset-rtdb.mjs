const databaseUrl = "https://studio-2428193126-b3db0-default-rtdb.firebaseio.com";

console.log("Clearing Firebase Realtime Database root...");
const response = await fetch(`${databaseUrl}/.json`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: "null",
  signal: AbortSignal.timeout(30000),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`RTDB reset failed: ${response.status} ${response.statusText} ${body}`);
}

console.log("RTDB reset complete. Register new doctor and patient accounts from the app.");
