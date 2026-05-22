export interface ResearchConfig {
  searchProvider: string;
  searchApiKey: string;
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

      // Add modifiers based on preferences
      if (config.fetchInfographics && !finalQuery.toLowerCase().includes('infographic')) {
         finalQuery += ' infographic data';
      }

      if (config.searchProvider === 'Local MCP Server') {
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
        
      } else if (config.searchProvider === 'Tavily API') {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: config.searchApiKey,
            query: finalQuery,
            include_images: config.fetchImages || config.fetchInfographics
          })
        });
        
        if (!response.ok) throw new Error(`Tavily Error: ${response.statusText}`);
        const data = await response.json();
        
        textResults = data.results?.map((r: any) => `Title: ${r.title}\nContent: ${r.content}\nURL: ${r.url}`).join('\n\n') || '';
        if (data.images) {
           images = data.images;
        }
      } else if (config.searchProvider === 'Serper API') {
         const response = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 
            'X-API-KEY': config.searchApiKey,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ q: finalQuery })
        });
        if (!response.ok) throw new Error(`Serper Error: ${response.statusText}`);
        const data = await response.json();
        textResults = data.organic?.map((r: any) => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`).join('\n\n') || '';
      } else {
         textResults = `[Search executed via ${config.searchProvider} for: ${finalQuery} - Manual implementation required]`;
      }

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
