import http from 'http';

const data = JSON.stringify({
  url: 'https://example.com',
  actions: [
    {
      action: 'wait',
      target: { type: 'window', value: '' }
    }
  ]
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/execute-puppeteer',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk.substring(0, 100)}...`);
  });
  res.on('end', () => {
    console.log('No more data in response.');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
