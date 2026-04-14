import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const app = express();

// ВАЖНО: НЕ используем express.json() глобально!
// MCP сам обработает тело запроса

const server = new McpServer({
  name: "website-reader",
  version: "1.0.0",
});

// Инструмент для чтения сайта
server.tool(
  "read_website",
  "Прочитать содержимое страницы сайта sait.prosaiti.ru",
  {
    url: z.string().describe("URL страницы, например / или /services"),
  },
  async ({ url }) => {
    const fullUrl = url.startsWith("http") ? url : `https://sait.prosaiti.ru${url}`;
    
    try {
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      const html = await response.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 8000);
      
      return {
        content: [{ type: "text", text: text || "Страница не содержит текста" }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Ошибка при чтении страницы: ${error.message}` }]
      };
    }
  }
);

// Хранилище активных SSE транспортов
const transports = {};

// SSE эндпоинт
app.get("/sse", async (req, res) => {
  console.log("🔌 Новое SSE подключение");
  
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    console.log(`🔌 SSE подключение ${transport.sessionId} закрыто`);
    delete transports[transport.sessionId];
  });
  
  await server.connect(transport);
});

// Эндпоинт для POST сообщений (БЕЗ express.json())
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Сессия не найдена");
  }
});

// Health check (только здесь используем json)
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "mcp-website-reader", connections: Object.keys(transports).length });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 MCP SSE сервер запущен на порту ${PORT}`);
  console.log(`📡 SSE endpoint: /sse`);
  console.log(`📡 Messages endpoint: /messages`);
});
