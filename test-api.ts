import fetch from 'node-fetch';

async function test() {
  try {
    console.log('Sending request...');
    const response = await fetch('http://localhost:3000/api/execute-puppeteer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        actions: [
          {
            action: 'wait',
            target: { type: 'window', value: 'window' }
          }
        ]
      }),
    });

    console.log('Status:', response.status);
    
    if (response.body) {
      response.body.on('data', chunk => {
        console.log('Received chunk:', chunk.toString());
      });
      response.body.on('end', () => {
        console.log('Stream ended');
      });
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
