import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

const sessions = new Map();

app.get("/sse", (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  
  console.log(`[SSE] Новое подключение: ${sessionId}`);
  
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
  
  sessions.set(sessionId, res);
  
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keepalive\n\n");
    } else {
      clearInterval(keepAlive);
    }
  }, 30000);
  
  req.on("close", () => {
    console.log(`[SSE] Закрыто: ${sessionId}`);
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const message = req.body;
  
  console.log(`[POST] ${sessionId}: ${message.method}`);
  
  const clientRes = sessions.get(sessionId);
  if (!clientRes || clientRes.writableEnded) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  let response;
  
  switch (message.method) {
    case "initialize":
      response = {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "website-reader-mcp", version: "1.0.0" }
        }
      };
      break;
      
    case "tools/list":
      response = {
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
                  url: { type: "string", description: "URL страницы (например, / или /services)" }
                },
                required: ["url"]
              }
            }
          ]
        }
      };
      break;
      
    case "tools/call":
      const { name, arguments: args } = message.params;
      
      if (name === "read_website") {
        const urlPath = args?.url || "/";
        const fullUrl = urlPath.startsWith("http") ? urlPath : `https://sait.prosaiti.ru${urlPath}`;
        
        try {
          const fetchRes = await fetch(fullUrl);
          const html = await fetchRes.text();
          
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 8000);
          
          response = {
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: text || "Страница не содержит текста" }] }
          };
        } catch (error) {
          response = {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: `Ошибка: ${error.message}` }
          };
        }
      } else {
        response = {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not found: ${name}` }
        };
      }
      break;
      
    default:
      response = {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` }
      };
  }
  
  clientRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "mcp-website-reader", sessions: sessions.size, version: "3.1" });
});

app.listen(PORT, () => {
  console.log(`MCP сервер версии 3.1 запущен на порту ${PORT}`);
  console.log(`SSE: /sse`);
  console.log(`POST: /messages`);
});
