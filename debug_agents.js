import fetch from 'node-fetch';
async function run() {
  const res = await fetch('http://localhost:3001/api/agents');
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
