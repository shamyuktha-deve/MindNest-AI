import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import OpenAI from "openai";

import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import { authenticateToken } from "./middleware/auth.js";
import { analyzeMessageRisk, getCountrySupportCard } from "./utils/riskAnalyzer.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/mental_health_assistant";
const JWT_SECRET = process.env.JWT_SECRET || "mental_health_assistant_secret_key_2026";
const HF_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-72B-Instruct";

// Initialize OpenAI client pointing to Hugging Face Serverless Router
const openai = new OpenAI({
  baseURL: process.env.HF_BASE_URL || "https://router.huggingface.co/v1",
  apiKey: process.env.HF_API_KEY,
});

// Connect to MongoDB
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MindNest AI MongoDB database successfully 🍃"))
  .catch((err) => console.error("MongoDB connection error ❌:", err));

// Dynamic System prompt helper for MindNest AI
const getSystemPrompt = (user, riskLevel) => {
  let locationContext = "";
  if (user && (user.country || user.phone)) {
    locationContext = `\nUSER PROFILE CONTEXT:
- Phone: ${user.phone || "Not provided"}
- Country: ${user.country || "Not specified"}`;
  }

  let safetyGuidance = "";
  if (riskLevel === "HIGH") {
    safetyGuidance = `\nCRITICAL SAFETY DIRECTIVE (LEVEL 3 - HIGH RISK):
- The user has expressed high-risk or self-harm statements.
- PRIORITY IS USER SAFETY.
- Do NOT give a long, generic wellness response.
- Acknowledge their pain gently and non-judgmentally.
- Encourage them to stay safe, move away from anything harmful, and stay with someone they trust.
- Encourage contacting crisis/emergency services immediately.`;
  } else if (riskLevel === "MODERATE") {
    safetyGuidance = `\nEMOTIONAL GUIDANCE (LEVEL 2 - MODERATE DISTRESS):
- The user is experiencing emotional exhaustion or feeling overwhelmed.
- Be deeply empathetic and provide simple, actionable coping techniques (e.g. 4-7-8 breathing, grounding).
- Gently remind them that talking with a trusted person or mental-health professional can help.`;
  } else {
    safetyGuidance = `\nNORMAL CONVERSATION GUIDANCE (LEVEL 1 - NORMAL / LOW DISTRESS):
- The user is sharing everyday stress, exam worries, or normal thoughts.
- Provide warm, supportive conversation and practical coping tips.
- Do NOT show crisis helpline numbers or tell them to call someone unless asked.`;
  }

  return {
    role: "system",
    content: `You are MindNest AI, a compassionate, empathetic, and supportive AI Mental Health & Wellness Assistant.${locationContext}${safetyGuidance}

STRICT SAFETY RULES:
1. NEVER diagnose mental health disorders. Do NOT say "You have depression", "You have anxiety disorder", or "You are suicidal". Use "It sounds like you're going through a very difficult time" or "I'm concerned about your safety based on what you shared."
2. Keep responses warm, non-judgmental, structured, concise, and easy to read.`
  };
};

// Fallback response generator tailored to risk level and country when API is offline/rate-limited
function generateMindNestFallback(message, user, riskLevel) {
  const country = (user && user.country) ? user.country.trim() : "";
  const lowerCountry = country.toLowerCase();
  const isIndia = lowerCountry.includes("india") || lowerCountry === "in";
  const isUS = lowerCountry.includes("united states") || lowerCountry.includes("usa") || lowerCountry.includes("us");

  if (riskLevel === "HIGH") {
    let countryMsg = "";
    if (isIndia) {
      countryMsg = "\n\nYou can connect with Tele-MANAS (Govt. of India) 24x7 at 14416 or 1800-89-14416, or contact 112 for emergency help.";
    } else if (isUS) {
      countryMsg = "\n\nYou can call or text the 988 Suicide & Crisis Lifeline at 988, or call 911 in an emergency.";
    } else {
      countryMsg = "\n\nPlease reach out to your local emergency service or a trusted mental health professional in your area.";
    }

    return `I'm really sorry you're going through this. You don't have to face this alone.

If you might hurt yourself right now, please move away from anything you could use to harm yourself and stay with someone you trust.${countryMsg}`;
  }

  if (riskLevel === "MODERATE") {
    return `It sounds like you have a lot on your mind and are feeling overwhelmed right now. You don't have to handle everything alone.

Here are a few gentle steps we can try right now:
1. **Pause & Take a Deep Breath**: Inhale for 4 seconds, hold for 4, and exhale slowly for 6.
2. **Focus on One Small Thing**: Try tackling just the very next step, rather than the whole picture.

If this feeling is becoming difficult to manage, talking with someone you trust or a mental health professional could really help.`;
  }

  // LOW RISK FALLBACK
  return `I understand. It sounds like you have a lot on your mind right now. Everyday challenges and stress can feel heavy, but taking things one step at a time can make a big difference.

What is currently taking up the most energy for you today? I'm here to listen and help you talk through it.`;
}

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================

// SIGNUP
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, phone, country } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Please fill in all required fields (name, email, password)." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "An account with this email address already exists." });
    }

    // Secure Password Hashing
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: phone || "",
      country: country || "",
    });

    await user.save();

    // Create JWT Token
    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error during registration. Please try again." });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Please provide email and password." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    // Validate password using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    // Create JWT Token
    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        country: user.country || "",
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login. Please try again." });
  }
});

// GET CURRENT USER PROFILE
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User profile not found." });
    }
    res.json({ user });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ error: "Failed to fetch user profile." });
  }
});

// UPDATE USER PROFILE (NAME, PHONE & COUNTRY)
app.put("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    const { name, phone, country } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: "User profile not found." });
    }

    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (country !== undefined) user.country = country;

    await user.save();

    res.json({
      message: "Profile updated successfully ✅",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile." });
  }
});

// ==========================================
// 2. CONVERSATION MANAGEMENT ROUTES (PROTECTED)
// ==========================================

// LIST ALL CONVERSATIONS FOR CURRENT USER
app.get("/api/conversations", authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.userId })
      .select("_id title createdAt updatedAt messages")
      .sort({ updatedAt: -1 });

    const formatted = conversations.map((c) => ({
      _id: c._id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages ? c.messages.length : 0,
      lastMessage: c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1].content : "",
    }));

    res.json({ conversations: formatted });
  } catch (err) {
    console.error("Fetch conversations error:", err);
    res.status(500).json({ error: "Failed to fetch conversations." });
  }
});

// CREATE NEW CONVERSATION
app.post("/api/conversations", authenticateToken, async (req, res) => {
  try {
    const conversation = new Conversation({
      userId: req.user.userId,
      title: "New Conversation",
      messages: [],
    });

    await conversation.save();

    res.status(201).json({ conversation });
  } catch (err) {
    console.error("Create conversation error:", err);
    res.status(500).json({ error: "Failed to create conversation." });
  }
});

// GET SINGLE CONVERSATION BY ID (WITH USER ISOLATION CHECK)
app.get("/api/conversations/:id", authenticateToken, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    // STRICT USER ISOLATION CHECK
    if (conversation.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Access denied. You do not own this conversation." });
    }

    res.json({ conversation });
  } catch (err) {
    console.error("Get conversation error:", err);
    res.status(500).json({ error: "Failed to retrieve conversation." });
  }
});

// DELETE CONVERSATION BY ID (WITH USER ISOLATION CHECK)
app.delete("/api/conversations/:id", authenticateToken, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    // STRICT USER ISOLATION CHECK
    if (conversation.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Access denied. You do not own this conversation." });
    }

    await Conversation.findByIdAndDelete(req.params.id);

    res.json({ message: "Conversation deleted successfully.", id: req.params.id });
  } catch (err) {
    console.error("Delete conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation." });
  }
});

// ==========================================
// 3. AI CHAT ROUTE (WITH SELECTIVE RISK CLASSIFIER & SUPPORT CARDS)
// ==========================================

app.post("/api/chat", authenticateToken, async (req, res) => {
  try {
    const { conversationId, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message content cannot be empty." });
    }

    // Fetch User details for MindNest AI country context
    const user = await User.findById(req.user.userId);

    // 1. SELECTIVE RISK DETECTION LAYER
    const riskAssessment = analyzeMessageRisk(message);
    const supportCard = getCountrySupportCard(user ? user.country : "", riskAssessment.level);

    let conversation;

    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found." });
      }
      // USER ISOLATION CHECK
      if (conversation.userId.toString() !== req.user.userId) {
        return res.status(403).json({ error: "Access denied. You do not own this conversation." });
      }
    } else {
      // Create a new conversation if none specified
      conversation = new Conversation({
        userId: req.user.userId,
        title: message.trim().slice(0, 30) + (message.length > 30 ? "..." : ""),
        messages: [],
      });
    }

    // Append user message
    conversation.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    // Auto-update conversation title if generic
    if (conversation.title === "New Conversation" && conversation.messages.length > 0) {
      conversation.title = message.trim().slice(0, 30) + (message.length > 30 ? "..." : "");
    }

    // CHAT MEMORY: Extract the last 10 messages from THIS conversation only
    const recentHistory = conversation.messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Construct prompt: Dynamic MindNest AI System Prompt + current conversation context
    const systemPrompt = getSystemPrompt(user, riskAssessment.level);
    const apiMessages = [systemPrompt, ...recentHistory];

    let botReply = "";

    try {
      // AI CALL via Hugging Face Serverless Router
      const completion = await openai.chat.completions.create({
        model: HF_MODEL,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 600,
      });

      botReply = completion.choices[0]?.message?.content || "";
    } catch (aiError) {
      console.warn("AI API Quota / Connection error, using MindNest fallback:", aiError.message);
      botReply = generateMindNestFallback(message, user, riskAssessment.level);
    }

    if (!botReply) {
      botReply = generateMindNestFallback(message, user, riskAssessment.level);
    }

    // Append bot response
    conversation.messages.push({
      role: "assistant",
      content: botReply,
      timestamp: new Date(),
    });

    // Update conversation timestamp
    conversation.updatedAt = new Date();
    await conversation.save();

    res.json({
      reply: botReply,
      conversationId: conversation._id,
      title: conversation.title,
      messages: conversation.messages,
      riskLevel: riskAssessment.level,
      supportCard: supportCard,
    });
  } catch (err) {
    console.error("Chat Error:", err);
    res.status(500).json({
      reply: "MindNest AI is having trouble connecting right now. Please try again shortly.",
      error: err.message,
    });
  }
});

// STATUS / HEALTH CHECK
app.get("/", (req, res) => {
  res.send("MindNest AI Selective Safety Application API is running ✅");
});

app.listen(PORT, () => {
  console.log(`MindNest AI Server running on port ${PORT} 🚀 [Model: ${HF_MODEL}]`);
});