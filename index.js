import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { 
  InitializeRequestSchema, 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const server = new Server(
  { name: "website-reader-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Инициализация (обязательно!)
server.setRequestHandler(InitializeRequestSchema, async () => {
  return {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "website-reader-mcp", version: "1.0.0" },
  };
});

// Список инструментов
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_website",
        description: "Прочитать содержимое страницы сайта sait.prosaiti.ru",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL страницы" },
          },
          required: ["url"],
        },
      },
    ],
  };
});

// Вызов инструмента
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "read_website") {
    const url = args?.url || "/";
    const fullUrl = url.startsWith("http") ? url : `https://sait.prosaiti.ru${url}`;
    
    try {
      const response = await fetch(fullUrl);
      const html = await response.text();
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 8000);
      return { content: [{ type: "text", text: text || "Страница пуста" }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Ошибка: ${error.message}` }] };
    }
  }
  
  throw new Error(`Неизвестный инструмент: ${name}`);
});

// SSE транспорт
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) await transport.handlePostMessage(req, res);
  else res.status(404).send("Сессия не найдена");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`MCP сервер на порту ${PORT}`));
