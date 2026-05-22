import express from 'express';
import cors from 'cors';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const app = express();
app.use(cors());
app.use(express.json());

// Configure the transport to run the MCP server
const transport = new StdioClientTransport({
  command: "node",
  args: ["/Users/shanky/Documents/web-search-mcp-main/dist/index.js"]
});

const client = new Client({
  name: "doc-forge-bridge",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

async function startBridge() {
  console.log("Starting MCP Bridge...");
  try {
    await client.connect(transport);
    console.log("Connected to local MCP Server successfully via stdio.");

    app.post("/tools/call", async (req, res) => {
      try {
        const { name, arguments: args } = req.body;
        console.log(`Received tool call request: ${name} with args:`, args);
        
        const result = await client.callTool({
          name,
          arguments: args
        });
        
        res.json(result);
      } catch (error) {
        console.error(`Tool call ${req.body?.name} failed:`, error);
        res.status(500).json({ error: String(error) });
      }
    });

    const PORT = 3000;
    app.listen(PORT, () => {
      console.log(`MCP HTTP Bridge is listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start MCP bridge:", error);
    process.exit(1);
  }
}

startBridge();
