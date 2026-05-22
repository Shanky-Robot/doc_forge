export interface ResearchConfig {
  searchServerUrl: string;
  fetchImages: boolean;
  fetchInfographics: boolean;
}

export interface ResearchResult {
  query: string;
  results: string;
  images: string[];
}

export async function executeWebSearch(queries: string[], config: ResearchConfig): Promise<ResearchResult[]> {
  const allResults: ResearchResult[] = [];

  for (const query of queries) {
    try {
      let finalQuery = query;
      let textResults = '';
      let images: string[] = [];

      if (config.fetchInfographics && !finalQuery.toLowerCase().includes('infographic')) {
         finalQuery += ' infographic data';
      }

      const url = config.searchServerUrl.endsWith('/tools/call') ? config.searchServerUrl : `${config.searchServerUrl.replace(/\/$/, '')}/tools/call`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: 'full-web-search', 
          arguments: { 
            query: finalQuery,
            limit: 3,
            includeContent: true
          } 
        })
      });
      
      if (!response.ok) throw new Error(`MCP Error: ${response.statusText}`);
      const data = await response.json();
      
      textResults = data.content?.[0]?.text || JSON.stringify(data);
      images = [];

      allResults.push({
        query: finalQuery,
        results: textResults,
        images
      });

    } catch (e: any) {
      console.error('Web Search Failed for query:', query, e);
      allResults.push({
        query,
        results: `[Search failed: ${e.message}]`,
        images: []
      });
    }
  }

  return allResults;
}
