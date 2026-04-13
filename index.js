import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const SITE_URL = "https://sait.prosaiti.ru";

const server = new Server(
  {
    name: "website-reader-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_website",
        description: "Прочитать содержимое страницы сайта sait.prosaiti.ru",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL страницы (например, / или /services или /contacts)",
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "read_website") {
    const urlPath = args?.url || "/";
    const fullUrl = urlPath.startsWith("http") ? urlPath : `${SITE_URL}${urlPath}`;
    
    try {
      const response = await axios.get(fullUrl, {
        headers: { "User-Agent": "MCP-Bot/1.0" },
        timeout: 10000,
      });
      
      const text = response.data
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 8000);
      
      return {
        content: [{ type: "text", text: text || "Страница не содержит текста" }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Не удалось прочитать страницу: ${error.message}` }],
      };
    }
  }

  throw new Error(`Неизвестный инструмент: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP сервер website-reader запущен");
}

main().catch(console.error);
