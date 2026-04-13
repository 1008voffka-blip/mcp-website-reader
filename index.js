import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

// Хранилище сессий
const sessions = new Map();

// SSE endpoint для подключения
app.get("/sse", (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  
  console.log(`[SSE] Новое подключение: ${sessionId}`);
  
  // Устанавливаем заголовки для SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  
  // Отправляем endpoint для последующих POST запросов
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
  
  // Сохраняем сессию
  sessions.set(sessionId, res);
  
  // Keep-alive каждые 30 секунд
  const keepAlive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepAlive);
      return;
    }
    res.write(": keepalive\n\n");
  }, 30000);
  
  // Обработка закрытия
  req.on("close", () => {
    console.log(`[SSE] Подключение закрыто: ${sessionId}`);
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

// POST endpoint для получения сообщений от клиента
app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const message = req.body;
  
  console.log(`[POST] Получено сообщение для сессии ${sessionId}:`, JSON.stringify(message));
  
  const clientRes = sessions.get(sessionId);
  if (!clientRes || clientRes.writableEnded) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  // Обрабатываем запрос в зависимости от метода
  if (message.method === "tools/list") {
    // Отправляем список доступных инструментов
    const response = {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "read_website",
            description: "Прочитать содержимое страницы сайта sait.prosaiti.ru",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL страницы (например, / или /services)"
                }
              },
              required: ["url"]
            }
          }
        ]
      }
    };
    
    clientRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return res.json({ ok: true });
  }
  
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    
    if (name === "read_website") {
      const urlPath = args?.url || "/";
      const fullUrl = urlPath.startsWith("http") ? urlPath : `https://sait.prosaiti.ru${urlPath}`;
      
      try {
        const response = await fetch(fullUrl);
        const html = await response.text();
        
        // Простое извлечение текста
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 8000);
        
        const result = {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: text || "Страница не содержит текста" }]
          }
        };
        
        clientRes.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      } catch (error) {
        const errorResult = {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: `Ошибка: ${error.message}`
          }
        };
        clientRes.write(`event: message\ndata: ${JSON.stringify(errorResult)}\n\n`);
      }
    }
    
    return res.json({ ok: true });
  }
  
  // Неизвестный метод
  const errorResponse = {
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: `Method not found: ${message.method}`
    }
  };
  clientRes.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
  res.json({ ok: true });
});

// Health check
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "mcp-website-reader",
    sessions: sessions.size,
    version: "2.0"
  });
});

app.listen(PORT, () => {
  console.log(`MCP SSE сервер (ручной) запущен на порту ${PORT}`);
  console.log(`SSE endpoint: /sse`);
  console.log(`Messages endpoint: /messages`);
});
