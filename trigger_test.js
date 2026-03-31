import fetch from 'node-fetch';
async function run() {
  const paths = [
    '/api/agents/56be36a0-f890-0c60-b8bb-745f74ef5ed6/message',
    '/api/56be36a0-f890-0c60-b8bb-745f74ef5ed6/message',
    '/56be36a0-f890-0c60-b8bb-745f74ef5ed6/message',
    '/agents/56be36a0-f890-0c60-b8bb-745f74ef5ed6/message'
  ];
  for (const p of paths) {
    console.log(`Trying ${p}...`);
    const res = await fetch(`http://localhost:3000${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: "Analyze target: https://github.com/elizaos/eliza",
        userId: "user",
        userName: "User"
      })
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    if (res.ok) break;
  }
}
run();
