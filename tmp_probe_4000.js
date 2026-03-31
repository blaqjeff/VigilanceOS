
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/agents',
  method: 'GET'
};

const req = http.request(options, res => {
  console.log(`STATUS: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('BODY:', data);
    try {
      const agents = JSON.parse(data).agents;
      if (agents && agents.length > 0) {
        const agent = agents[0];
        console.log(`\nTesting Message for Agent: ${agent.name} (${agent.id})`);
        
        const postData = JSON.stringify({
          text: 'Hello',
          userId: 'user',
          userName: 'User'
        });

        const postOptions = {
          hostname: 'localhost',
          port: 4000,
          path: `/${agent.id}/message`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const postReq = http.request(postOptions, postRes => {
          console.log(`POST STATUS: ${postRes.statusCode}`);
          let postBody = '';
          postRes.on('data', chunk => postBody += chunk);
          postRes.on('end', () => console.log('POST BODY:', postBody.substring(0, 500)));
        });
        postReq.write(postData);
        postReq.end();
      }
    } catch (e) {
      console.log('Error parsing agents JSON:', e.message);
    }
  });
});

req.on('error', e => console.log('REQ ERROR:', e.message));
req.end();
