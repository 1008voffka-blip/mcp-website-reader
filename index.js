import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json());

// ========== 1. НАСТРОЙКА MCP-СЕРВЕРА ДЛЯ ЧТЕНИЯ САЙТА ==========

const SITE_URL = "https://sait.prosaiti.ru";

const mcpServer = new McpServer({
  name: "website-reader-mcp",
  version: "1.0.0",
});

// Инструмент для чтения сайта
mcpServer.tool(
  "read_website",
  "Прочитать содержимое страницы сайта sait.prosaiti.ru",
  {
    url: z.string().describe("URL страницы, например / или /services"),
  },
  async ({ url }) => {
    const fullUrl = url.startsWith("http") ? url : `${SITE_URL}${url}`;
    
    try {
      const response = await fetch(fullUrl);
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

// Хранилище SSE транспортов
const transports = {};

// SSE эндпоинт для MCP
app.get("/sse", async (req, res) => {
  console.log("🔌 Новое SSE подключение");
  
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    console.log(`🔌 SSE подключение ${transport.sessionId} закрыто`);
    delete transports[transport.sessionId];
  });
  
  await mcpServer.connect(transport);
});

// Эндпоинт для POST сообщений MCP
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Сессия не найдена");
  }
});

// ========== 2. НАСТРОЙКА ОТПРАВКИ ИСТОРИИ ЧАТА НА ПОЧТУ ==========

// Конфигурация почты
const MAIL_CONFIG = {
  to: "vitrag-rostov@mail.ru",
  from: process.env.EMAIL_FROM || "your-email@yandex.ru",
};

// Настройка SMTP (для Яндекс.Почты)
const transporter = nodemailer.createTransport({
  host: "smtp.yandex.ru",
  port: 465,
  secure: true,
  auth: {
    user: MAIL_CONFIG.from,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Хранилище активных диалогов
const activeDialogs = new Map();

// Функция отправки письма
async function sendEmail(history, sessionId) {
  const mailOptions = {
    from: MAIL_CONFIG.from,
    to: MAIL_CONFIG.to,
    subject: `📝 История чата с сайта от ${new Date().toLocaleString()}`,
    text: history,
    html: `
      <h2>📋 История переписки</h2>
      <p><strong>ID сессии:</strong> ${sessionId}</p>
      <p><strong>Время отправки:</strong> ${new Date().toLocaleString()}</p>
      <hr>
      <div style="font-family: monospace; white-space: pre-wrap; background: #f5f5f5; padding: 15px; border-radius: 8px;">
        ${history.replace(/\n/g, "<br>")}
      </div>
    `,
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Письмо отправлено для сессии ${sessionId}`);
  } catch (error) {
    console.error(`❌ Ошибка отправки письма для сессии ${sessionId}:`, error.message);
  }
}

// Эндпоинт для получения истории чата с сайта
app.post("/api/chat-history", async (req, res) => {
  const { sessionId, history, lastActivity } = req.body;
  
  if (!sessionId || !history) {
    return res.status(400).json({ error: "sessionId и history обязательны" });
  }
  
  console.log(`📥 Получена история для сессии ${sessionId}`);
  
  // Если уже есть диалог с таким sessionId — удаляем старый таймер
  if (activeDialogs.has(sessionId)) {
    const existing = activeDialogs.get(sessionId);
    if (existing.timeoutId) clearTimeout(existing.timeoutId);
    console.log(`🔄 Обновлён таймер для сессии ${sessionId}`);
  }
  
  // Устанавливаем таймер на 60 минут
  const timeoutId = setTimeout(async () => {
    const dialog = activeDialogs.get(sessionId);
    if (dialog) {
      console.log(`⏰ Истекает таймер для сессии ${sessionId}, отправляем письмо`);
      await sendEmail(dialog.history, sessionId);
      activeDialogs.delete(sessionId);
    }
  }, 60 * 60 * 1000);
  
  // Сохраняем диалог
  activeDialogs.set(sessionId, {
    history,
    lastActivity: lastActivity || Date.now(),
    timeoutId,
  });
  
  res.json({ status: "ok", message: "История принята" });
});

// Эндпоинт для ручной отправки (по желанию)
app.post("/api/send-now", async (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId || !activeDialogs.has(sessionId)) {
    return res.status(404).json({ error: "Сессия не найдена" });
  }
  
  const dialog = activeDialogs.get(sessionId);
  if (dialog.timeoutId) clearTimeout(dialog.timeoutId);
  
  await sendEmail(dialog.history, sessionId);
  activeDialogs.delete(sessionId);
  
  res.json({ status: "ok", message: "Письмо отправлено" });
});

// ========== 3. HEALTH CHECK ==========

app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "mcp-website-reader",
    version: "2.0",
    activeDialogs: activeDialogs.size,
    uptime: process.uptime()
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    activeDialogs: activeDialogs.size 
  });
});

// ========== 4. ЗАПУСК СЕРВЕРА ==========

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 MCP SSE endpoint: /sse`);
  console.log(`📡 MCP POST endpoint: /messages`);
  console.log(`📧 Email endpoint: /api/chat-history`);
  console.log(`📧 Получатель: ${MAIL_CONFIG.to}\n`);
});
