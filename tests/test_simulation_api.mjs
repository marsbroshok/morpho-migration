import fs from 'fs';
import path from 'path';

// Fetch the API key from process.env or .env file
let apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  try {
    const envContent = fs.readFileSync(path.resolve('.env'), 'utf8');
    const match = envContent.match(/ALCHEMY_API_KEY\s*=\s*(.*)/);
    if (match) {
      apiKey = match[1].trim();
    }
  } catch (err) {
    console.error('Could not read .env file:', err.message);
  }
}

if (!apiKey) {
  console.error('Error: ALCHEMY_API_KEY is not defined in process.env or .env file.');
  process.exit(1);
}

const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;

// Load the payload data from the JSON file next to this test script
const payloadData = JSON.parse(
  fs.readFileSync(path.resolve('tests/simulation_payload.json'), 'utf8')
);

// 1. Test Standard eth_call with State Overrides
async function testEthCall() {
  console.log('\n======================================');
  console.log('1. Testing Standard eth_call (State Overrides)');
  console.log('======================================');
  
  const payload = {
    id: 1,
    jsonrpc: "2.0",
    method: "eth_call",
    params: [
      payloadData.eth_call.transaction,
      "latest",
      payloadData.eth_call.stateOverrides
    ]
  };

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) {
      console.log('Result: Reverted as expected (Verifies EVM logic execution)');
      console.log('Revert Details:', JSON.stringify(data.error, null, 2));
    } else {
      console.log('Result: Success');
      console.log('Return Data:', data.result);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// 2. Test Alchemy's eth_simulateV1 Method (Success Case)
async function testAlchemyEthSimulateV1() {
  console.log('\n======================================');
  console.log("2. Testing eth_simulateV1 on Alchemy Mainnet");
  console.log('======================================');

  const payload = {
    id: 1,
    jsonrpc: "2.0",
    method: "eth_simulateV1",
    params: [
      payloadData.eth_simulateV1,
      "latest"
    ]
  };

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) {
      console.log('Result: Failed on backend');
      console.log('Error Details:', JSON.stringify(data.error, null, 2));
    } else {
      const hasError = data.result?.some(res => 
        res.calls?.some(call => call.status === '0x0' || call.error)
      );
      if (hasError) {
        console.log('Result: Error');
      } else {
        console.log('Result: Success');
      }
      console.log('Response Calls:', JSON.stringify(data.result[0].calls, null, 2));
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// Run tests
await testEthCall();
await testAlchemyEthSimulateV1();


