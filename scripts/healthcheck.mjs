const backendPort = Number(process.env.SERVER_PORT || 3001);
const uiPort = Number(process.env.UI_PORT || 4001);

async function check(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
}

try {
  await Promise.all([
    check(`http://127.0.0.1:${backendPort}/api/agents`),
    check(`http://127.0.0.1:${uiPort}`),
    check(`http://127.0.0.1:${uiPort}/api/vigilance/feed?status=pending%2Capproved`),
  ]);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
