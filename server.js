require("dotenv").config();
const express = require("express");
const twilio  = require("twilio");
const axios   = require("axios");
const cors    = require("cors");

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());


const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  HUBSPOT_ACCESS_TOKEN,
  STAFF_PHONE,
  APPROVED_STAFF_NUMBERS = "",
  PORT = 3000,
  COMPANY_NAME = "Our Team",
} = process.env;

const approvedStaffNumbers = new Set(
  APPROVED_STAFF_NUMBERS.split(",").map((n) => n.trim()).filter(Boolean)
);

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const hubspot = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// ─── In-memory message store (phone-based) ────────────────────────────────────
const messageStore = new Map();

function storeMessage(phone, direction, text) {
  const p = normalizePhone(phone);
  if (!messageStore.has(p)) messageStore.set(p, []);
  const msg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction,
    text,
    timestamp: Date.now(),
  };
  messageStore.get(p).push(msg);
  return msg;
}

function getMessages(phone) {
  const p = normalizePhone(phone);
  return (messageStore.get(p) || []).slice().sort((a, b) => a.timestamp - b.timestamp);
}


const chatSessions = new Map();

const chatIdMap = new Map();
const usedIds   = new Set();

function generateChatId() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let id, attempts = 0;
  do {
    const l1 = letters[Math.floor(Math.random() * letters.length)];
    const d  = String(Math.floor(Math.random() * 10));
    const l2 = letters[Math.floor(Math.random() * letters.length)];
    id = l1 + d + l2;
    if (++attempts > 500) id = "X" + Math.floor(Math.random() * 90 + 10) + "Z"; // fallback
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function getOrCreateChatId(phone) {
  const p = normalizePhone(phone);
  if (!chatIdMap.has(p)) chatIdMap.set(p, generateChatId());
  return chatIdMap.get(p);
}

function getPhoneByChatId(id) {
  for (const [phone, cid] of chatIdMap.entries()) {
    if (cid === id.toUpperCase()) return phone;
  }
  return null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const stripped = raw.replace(/[^\d+]/g, "");
  if (stripped.startsWith("+")) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  if (stripped.length === 11 && stripped.startsWith("1")) return `+${stripped}`;
  return stripped;
}

function log(level, message, meta = {}) {
  const safeMeta = JSON.stringify(meta).replace(
    /(token|sid|auth)[^"]*":\s*"[^"]{4}[^"]*/gi,
    (m) => m.slice(0, m.indexOf(":") + 4) + "***"
  );
  console[level === "error" ? "error" : "log"](
    `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`,
    safeMeta !== "{}" ? safeMeta : ""
  );
}

async function createOrUpdateContact({ firstName, lastName, phone, email, shortId }) {
  const normalizedPhone = normalizePhone(phone);
  const properties = {
    firstname: firstName,
    lastname:  lastName,
    phone:     normalizedPhone,
    ...(email   && { email }),
    sms_consent: "true",
    ...(shortId && { sms_chat_id: shortId }),
  };

  let existingId = null;

  if (email) {
    try {
      const res = await hubspot.post("/crm/v3/objects/contacts/search", {
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        limit: 1,
      });
      existingId = res.data.results?.[0]?.id || null;
    } catch (err) { log("warn", "HubSpot search by email failed", { error: err.message }); }
  }

  if (!existingId && normalizedPhone) {
    try {
      const res = await hubspot.post("/crm/v3/objects/contacts/search", {
        filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: normalizedPhone }] }],
        limit: 1,
      });
      existingId = res.data.results?.[0]?.id || null;
    } catch (err) { log("warn", "HubSpot search by phone failed", { error: err.message }); }
  }

  if (existingId) {
    await hubspot.patch(`/crm/v3/objects/contacts/${existingId}`, { properties });
    log("info", "HubSpot contact updated", { contactId: existingId });
    return existingId;
  } else {
    const res = await hubspot.post("/crm/v3/objects/contacts", { properties });
    log("info", "HubSpot contact created", { contactId: res.data.id });
    return res.data.id;
  }
}

async function getContactByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const phoneVariants = [
    normalizedPhone,
    normalizedPhone.replace(/^\+1/, ""),
    normalizedPhone.replace(/^\+/, ""),
  ];

  try {
    let res = await hubspot.post("/crm/v3/objects/contacts/search", {
      filterGroups: phoneVariants.map((v) => ({
        filters: [{ propertyName: "phone", operator: "EQ", value: v }],
      })),
      properties: ["firstname", "lastname", "phone", "mobilephone", "sms_chat_id"],
      limit: 1,
    });

    if (!res.data.results?.length) {
      res = await hubspot.post("/crm/v3/objects/contacts/search", {
        filterGroups: phoneVariants.map((v) => ({
          filters: [{ propertyName: "mobilephone", operator: "EQ", value: v }],
        })),
        properties: ["firstname", "lastname", "phone", "mobilephone", "sms_chat_id"],
        limit: 1,
      });
    }

    const contact = res.data.results?.[0];
    if (!contact) return null;

    return {
      id:        contact.id,
      firstName: contact.properties.firstname  || "",
      lastName:  contact.properties.lastname   || "",
      phone:     contact.properties.phone || contact.properties.mobilephone || normalizedPhone,
      chatId:    contact.properties.sms_chat_id || null,
    };
  } catch (err) {
    log("error", "HubSpot getContactByPhone failed", { error: err.message });
    return null;
  }
}

async function logSmsToHubSpot({ contactId, direction, fromPhone, toPhone, body, staffPhone }) {
  if (!contactId) return;
  const label    = direction === "inbound" ? "📥 Inbound SMS" : "📤 Outbound SMS";
  const noteBody = [
    label,
    `From: ${fromPhone}`,
    `To: ${toPhone}`,
    ...(staffPhone ? [`Staff: ${staffPhone}`] : []),
    `Message: ${body}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await hubspot.post("/crm/v3/objects/notes", {
      properties: { hs_note_body: noteBody, hs_timestamp: Date.now().toString() },
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
      }],
    });
    log("info", "HubSpot SMS note logged", { contactId, direction });
  } catch (err) {
    log("error", "logSmsToHubSpot failed", { error: err.message });
  }
}

async function logConsentToHubSpot({ contactId, consentText, consentTimestamp, phone }) {
  if (!contactId) return;
  const noteBody = [
    " SMS Consent Recorded",
    `Phone: ${phone}`,
    `Consent: ${consentText}`,
    `Timestamp: ${consentTimestamp}`,
  ].join("\n");

  try {
    await hubspot.post("/crm/v3/objects/notes", {
      properties: { hs_note_body: noteBody, hs_timestamp: new Date(consentTimestamp).getTime().toString() },
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
      }],
    });
    log("info", "HubSpot consent note logged", { contactId });
  } catch (err) {
    log("error", "logConsentToHubSpot failed", { error: err.message });
  }
}

// ─── Twilio helper ────────────────────────────────────────────────────────────
async function sendSms({ to, body, from = TWILIO_NUMBER }) {
  const message = await twilioClient.messages.create({ to, from, body });
  log("info", "SMS sent", { sid: message.sid, to, from });
  return message;
}


app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.post("/consent", async (req, res) => {
  const { firstName, lastName, phone, email, consentText, consentTimestamp } = req.body;

  const missing = ["firstName", "lastName", "phone", "consentText", "consentTimestamp"].filter(f => !req.body[f]);
  if (missing.length) return res.status(400).json({ error: "Missing required fields", missing });

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone number format" });

  log("info", "Consent form received", { firstName, lastName, phone: normalizedPhone });

  try {
    const shortId   = getOrCreateChatId(normalizedPhone);
    const contactId = await createOrUpdateContact({ firstName, lastName, phone: normalizedPhone, email, shortId });

    await logConsentToHubSpot({ contactId, consentText, consentTimestamp, phone: normalizedPhone });

    const welcomeBody = `Hi ${firstName}, this is ${COMPANY_NAME}. Thanks for consenting to SMS communications. Reply here anytime for support. Your chat ID is: ${shortId}`;
    await sendSms({ to: normalizedPhone, body: welcomeBody });

    storeMessage(normalizedPhone, "outbound", welcomeBody);

    await logSmsToHubSpot({
      contactId, direction: "outbound",
      fromPhone: TWILIO_NUMBER, toPhone: normalizedPhone, body: welcomeBody,
    });

    return res.status(200).json({ success: true, message: "Consent recorded and welcome SMS sent", contactId, chatId: shortId });
  } catch (err) {
    log("error", "POST /consent failed", { error: err.message });
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

app.post("/webhook/sms", async (req, res) => {
  const { From: from, Body: body } = req.body;
  if (!from || !body) return res.status(400).send("Missing From or Body");

  const normalizedFrom = normalizePhone(from);
  log("info", "Webhook /sms received", { from: normalizedFrom, bodyPreview: body.slice(0, 40) });

  if (approvedStaffNumbers.has(normalizedFrom)) {
    return handleStaffReply({ from: normalizedFrom, body, res });
  }
  return handleClientInbound({ from: normalizedFrom, body, res });
});

async function handleClientInbound({ from, body, res }) {
  try {
    const contact = await getContactByPhone(from);

    const clientName = contact && (contact.firstName || contact.lastName)
      ? `${contact.firstName} ${contact.lastName}`.trim()
      : "Unknown Client";

    if (contact?.chatId && !chatIdMap.has(from)) {
      chatIdMap.set(from, contact.chatId);
      usedIds.add(contact.chatId);
    }

    const shortId = getOrCreateChatId(from);
    const forwardedMessage = `[${shortId}] ${clientName}:\n${body}\n\nReply: ${shortId}: your message here`;
    await sendSms({ to: STAFF_PHONE, body: forwardedMessage });

    storeMessage(from, "inbound", body);

    if (contact?.id) {
      await logSmsToHubSpot({
        contactId: contact.id, direction: "inbound",
        fromPhone: from, toPhone: TWILIO_NUMBER, body,
      });
    } else {
      log("warn", "No HubSpot contact found for inbound sender", { from });
    }

    res.set("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  } catch (err) {
    log("error", "handleClientInbound failed", { error: err.message });
    return res.status(500).send("Internal server error");
  }
}

async function handleStaffReply({ from, body, res }) {
  const match = body.match(/^([A-Z0-9]{3,10}):\s*([\s\S]+)$/i);

  if (!match) {
    log("warn", "Staff reply invalid format", { from });
    return res.status(400).send("Invalid format. Use: ID: Your reply here");
  }

  const replyId   = match[1].toUpperCase();
  const replyText = match[2].trim();

  const webSession = chatSessions.get(replyId);
  if (webSession) {
    webSession.messages.push({
      id:        "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      direction: "outbound",
      text:      replyText,
      timestamp: Date.now(),
    });
    log("info", "Staff reply added to web chat session", { replyId });
    res.set("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  }

  const clientNumber = getPhoneByChatId(replyId);
  if (!clientNumber) {
    log("warn", "Unknown ID in staff reply", { replyId, from });
    return res.status(400).send(`Unknown ID [${replyId}]. Ask the client to message again.`);
  }

  log("info", "Staff SMS reply", { replyId, clientNumber, from });

  try {
    await sendSms({ to: clientNumber, body: replyText });
    storeMessage(clientNumber, "outbound", replyText);

    const contact = await getContactByPhone(clientNumber);
    if (contact?.id) {
      await logSmsToHubSpot({
        contactId: contact.id, direction: "outbound",
        fromPhone: TWILIO_NUMBER, toPhone: clientNumber,
        body: replyText, staffPhone: from,
      });
    }

    res.set("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  } catch (err) {
    log("error", "handleStaffReply failed", { error: err.message });
    return res.status(500).send("Internal server error");
  }
}

app.get("/messages", async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: "Missing phone parameter" });

  const contact = await getContactByPhone(phone);
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  if (contact.chatId && !chatIdMap.has(phone)) {
    chatIdMap.set(phone, contact.chatId);
    usedIds.add(contact.chatId);
  }
  const shortId = getOrCreateChatId(phone);

  return res.json({
    contact: {
      name:   `${contact.firstName} ${contact.lastName}`.trim(),
      phone:  contact.phone,
      chatId: shortId,
    },
    messages: getMessages(phone),
  });
});

app.post("/messages", async (req, res) => {
  const { phone, body } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || !body?.trim()) return res.status(400).json({ error: "Missing phone or body" });

  try {
    const contact    = await getContactByPhone(normalizedPhone);
    const clientName = contact && (contact.firstName || contact.lastName)
      ? `${contact.firstName} ${contact.lastName}`.trim()
      : "Unknown Client";

    if (contact?.chatId && !chatIdMap.has(normalizedPhone)) {
      chatIdMap.set(normalizedPhone, contact.chatId);
      usedIds.add(contact.chatId);
    }

    const shortId          = getOrCreateChatId(normalizedPhone);
    const forwardedMessage = `[${shortId}] ${clientName}:\n${body.trim()}\n\nReply: ${shortId}: your message here`;
    await sendSms({ to: STAFF_PHONE, body: forwardedMessage });

    storeMessage(normalizedPhone, "inbound", body.trim());

    if (contact?.id) {
      await logSmsToHubSpot({
        contactId: contact.id, direction: "inbound",
        fromPhone: normalizedPhone, toPhone: TWILIO_NUMBER, body: body.trim(),
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    log("error", "POST /messages failed", { error: err.message });
    return res.status(500).json({ error: "Failed to send message" });
  }
});

app.post("/chat/start", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing name" });

  const sessionId = generateChatId();
  chatSessions.set(sessionId, { name, messages: [] });

  log("info", "Chat session started", { sessionId, name });
  return res.json({ success: true, sessionId });
});

app.get("/chat/messages", (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

  const session = chatSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  return res.json({ messages: session.messages });
});

app.post("/chat/send", async (req, res) => {
  const { sessionId, name, body } = req.body;
  if (!sessionId || !body?.trim()) return res.status(400).json({ error: "Missing sessionId or body" });

  const session = chatSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const msg = {
    id:        "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    direction: "inbound",
    text:      body.trim(),
    timestamp: Date.now(),
  };
  session.messages.push(msg);

  const forwardedMessage = `[${sessionId}] ${name || session.name}:\n${body.trim()}\n\nReply: ${sessionId}: your message here`;
  try {
    await sendSms({ to: STAFF_PHONE, body: forwardedMessage });
    log("info", "Web chat message forwarded to staff", { sessionId });
  } catch (err) {
    log("error", "Failed to forward web chat message", { error: err.message });
  }

  return res.json({ success: true, message: msg });
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.listen(PORT, () => {
  log("info", `Server running on port ${PORT}`);
  log("info", `Approved staff numbers loaded: ${approvedStaffNumbers.size}`);
});