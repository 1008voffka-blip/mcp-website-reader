import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const SITE_URL = "https://sait.prosaiti.ru";
const app = express();
app.use(express.json());

// Создаём MCP сервер
const mcpServer = new Server(
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

// Регистрируем инструменты
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
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
              description: "URL страницы (например, / или /services)",
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

// Обработчик вызова инструментов
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
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

// HTTP эндпоинт для MCP
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  
  res.on("close", () => transport.close());
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "mcp-website-reader" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`MCP HTTP сервер запущен на порту ${PORT}`);
});
