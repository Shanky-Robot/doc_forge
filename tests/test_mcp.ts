import { executeMcpSearch } from '../src/lib/mcpSearch';

async function testMcp() {
  console.log('Testing MCP Search connection...');
  try {
    const result = await executeMcpSearch('What is the capital of France?', 'http://localhost:3000');
    console.log('--- Search Results ---');
    console.log(result.substring(0, 500) + '...');
    if (result.includes('Paris')) {
      console.log('✅ Connection and search validated successfully!');
    } else {
      console.log('❌ Unexpected result format.');
    }
  } catch (error) {
    console.error('❌ E2E test failed:', error);
  }
}

testMcp();
