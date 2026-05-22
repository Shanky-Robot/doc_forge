export async function executeMcpSearch(query: string, mcpUrl: string): Promise<string> {
  try {
    const response = await fetch(`${mcpUrl.replace(/\/$/, '')}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'web-search',
        arguments: { query }
      })
    });

    if (!response.ok) {
      console.warn(`MCP search failed with status: ${response.status}`);
      return '';
    }

    const data = await response.json();
    
    if (data && data.content && Array.isArray(data.content)) {
      return data.content.map((c: any) => c.text || JSON.stringify(c)).join('\n\n');
    }

    return JSON.stringify(data);
  } catch (error) {
    console.warn("Failed to connect to local MCP web-search server:", error);
    return '';
  }
}
