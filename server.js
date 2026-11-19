const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const path = require("path");
const webpush = require("web-push");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "rsu.sid",
  secret: process.env.SESSION_SECRET || "local-only-secret-change-me",
  resave: false,
  saveUninitialized: false,
  store: process.env.MONGODB_URI
    ? MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: "sessions"
      })
    : undefined,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// Gmail/Nodemailer configuration
let mailTransporter = null;

function getMailTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER.trim(),
        pass: process.env.EMAIL_PASS.replace(/\s+/g, "")
      }
    });
  }

  return mailTransporter;
}

async function mail(to, subject, html) {
  const transporter = getMailTransporter();

  if (!transporter) {
    console.error("EMAIL NOT SENT: EMAIL_USER or EMAIL_PASS is missing in .env");
    return false;
  }

  if (!to || !String(to).includes("@")) {
    console.error("EMAIL NOT SENT: recipient email is missing or invalid.");
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: String(to).trim(),
      subject,
      html
    });

    console.log("EMAIL SENT:", info.messageId, "TO:", to);
    return true;
  } catch (error) {
    console.error("EMAIL SEND FAILED:", error.code || "", error.message);
    return false;
  }
}

const User = mongoose.model("User", new mongoose.Schema({
  name: { type: String, required: true },
  studentId: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  course: String,
  yearLevel: String,
  role: { type: String, enum: ["student", "organizer"], default: "student" },
  active: { type: Boolean, default: true }
}, { timestamps: true }));

const Event = mongoose.model("Event", new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  date: { type: String, required: true },
  time: String,
  venue: { type: String, required: true },
  capacity: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["upcoming", "ongoing", "completed", "cancelled"],
    default: "upcoming"
  }
}, { timestamps: true }));

const Registration = mongoose.model("Registration", new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "attended"],
    default: "pending"
  }
}, { timestamps: true }));

Registration.schema.index({ event: 1, student: 1 }, { unique: true });

const Announcement = mongoose.model("Announcement", new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null }
}, { timestamps: true }));

const Notification = mongoose.model("Notification", new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: String,
  message: String,
  isRead: { type: Boolean, default: false }
}, { timestamps: true }));

const PushSubscription = mongoose.model("PushSubscription", new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  subscription: { type: Object, required: true }
}, { timestamps: true }));

let pushReady = false;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  pushReady = true;
} else {
  console.warn("WEB PUSH is not configured. Add VAPID keys to .env to enable mobile push notifications.");
}

async function sendPushToUser(userId, title, message, url = "/notifications.html") {
  if (!pushReady) return 0;
  const rows = await PushSubscription.find({ user: userId });
  let sent = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body: message, url }));
      sent++;
    } catch (error) {
      console.error("PUSH SEND FAILED:", error.statusCode || "", error.message);
      if (error.statusCode === 404 || error.statusCode === 410) await PushSubscription.deleteOne({ _id: row._id });
    }
  }
  return sent;
}

async function sendPushToStudents(title, message, url = "/announcements.html") {
  if (!pushReady) return 0;
  const rows = await PushSubscription.find().populate({ path: "user", match: { role: "student", active: true } });
  let sent = 0;
  for (const row of rows) {
    if (!row.user) continue;
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body: message, url }));
      sent++;
    } catch (error) {
      console.error("PUSH SEND FAILED:", error.statusCode || "", error.message);
      if (error.statusCode === 404 || error.statusCode === 410) await PushSubscription.deleteOne({ _id: row._id });
    }
  }
  return sent;
}

const safe = u => ({
  id: u._id,
  name: u.name,
  email: u.email,
  studentId: u.studentId || "",
  course: u.course || "",
  yearLevel: u.yearLevel || "",
  role: u.role
});

const login = (q, s, n) =>
  q.session.user ? n() : s.status(401).json({ message: "Please sign in first." });

const organizer = (q, s, n) =>
  q.session.user?.role === "organizer"
    ? n()
    : s.status(403).json({ message: "Organizer access only." });

const esc = x => String(x || "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[c]));

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (q, s) => s.json({
  status: "ok",
  database: mongoose.connection.readyState === 1 ? "connected" : "connecting",
  emailConfigured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  pushConfigured: pushReady
}));

app.get("/api/auth/me", (q, s) => s.json({ user: q.session.user || null }));

app.get("/api/push/public-key", (q, s) => {
  s.json({ enabled: pushReady, publicKey: pushReady ? process.env.VAPID_PUBLIC_KEY : "" });
});

app.post("/api/push/subscribe", login, async (q, s) => {
  try {
    if (!pushReady) return s.status(503).json({ message: "Push notifications are not configured on the server yet." });
    const sub = q.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return s.status(400).json({ message: "Invalid browser subscription." });
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { user: q.session.user.id, endpoint: sub.endpoint, subscription: sub },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    s.json({ message: "Mobile push notifications enabled on this device." });
  } catch (error) {
    console.error("PUSH SUBSCRIBE ERROR:", error);
    s.status(500).json({ message: "Could not save this device subscription." });
  }
});

app.post("/api/push/unsubscribe", login, async (q, s) => {
  const endpoint = q.body.endpoint;
  if (endpoint) await PushSubscription.deleteOne({ user: q.session.user.id, endpoint });
  s.json({ message: "Push notifications disabled for this device." });
});

// Student registration: sends welcome email to the student's own email address.
app.post("/api/auth/register", async (q, s) => {
  try {
    const { name, studentId, email, password, course, yearLevel } = q.body;

    if (!name || !studentId || !email || !password) {
      return s.status(400).json({ message: "Complete all required fields." });
    }

    if (String(password).length < 8) {
      return s.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const em = String(email).trim().toLowerCase();
    if (await User.findOne({ $or: [{ email: em }, { studentId: String(studentId).trim() }] })) {
      return s.status(409).json({ message: "Email or student ID is already registered." });
    }

    const u = await User.create({
      name,
      studentId: String(studentId).trim(),
      email: em,
      password: await bcrypt.hash(password, 12),
      course,
      yearLevel,
      role: "student"
    });

    q.session.user = safe(u);

    const emailSent = await mail(
      u.email,
      "Welcome to RSU-Cajidiocan",
      `<h2>Welcome ${esc(u.name)}!</h2><p>Your account is ready.</p><a href="${process.env.BASE_URL || ""}/events.html">View events</a>`
    );

    s.status(201).json({
      message: emailSent ? "Account created. Welcome email sent." : "Account created, but welcome email could not be sent. Check the server terminal and email settings.",
      user: q.session.user,
      emailSent
    });
  } catch (e) {
    console.error("STUDENT REGISTRATION ERROR:", e);
    s.status(500).json({ message: "Unable to register." });
  }
});

// Login: sends sign-in email to the account owner's email.
app.post("/api/auth/login", async (q, s) => {
  try {
    const u = await User.findOne({
      email: String(q.body.email || "").toLowerCase().trim(),
      active: true
    });

    if (!u || !await bcrypt.compare(q.body.password || "", u.password)) {
      return s.status(401).json({ message: "Incorrect email or password." });
    }

    q.session.user = safe(u);
    await Notification.create({
      user: u._id,
      title: "New sign-in",
      message: "You signed in to your RSU event account."
    });

    const emailSent = await mail(
      u.email,
      "RSU account sign-in",
      `<p>Hello ${esc(u.name)}, your RSU event account was signed in to.</p>`
    );

    s.json({
      message: emailSent ? "Signed in. Email notification sent." : "Signed in, but email notification could not be sent.",
      user: q.session.user,
      emailSent
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    s.status(500).json({ message: "Unable to sign in." });
  }
});

app.post("/api/auth/logout", (q, s) =>
  q.session.destroy(() => s.json({ message: "Signed out." }))
);

app.get("/api/events", async (q, s) => {
  try {
    s.json({ events: await Event.find().sort({ date: 1 }) });
  } catch (e) {
    console.error("GET EVENTS ERROR:", e);
    s.status(500).json({ message: "Unable to load events." });
  }
});

app.get("/api/events/:id", async (q, s) => {
  try {
    const e = await Event.findById(q.params.id);
    e ? s.json({ event: e }) : s.status(404).json({ message: "Event not found." });
  } catch (error) {
    s.status(400).json({ message: "Invalid event ID." });
  }
});

app.post("/api/events", login, organizer, async (q, s) => {
  try {
    const e = await Event.create(q.body);
    const pushSent = await sendPushToStudents("New campus event", `${e.title} · ${e.date} · ${e.venue}`, "/events.html");
    s.status(201).json({ message: `Event created. ${pushSent} mobile push notification(s) sent.`, event: e, pushSent });
  } catch (e) {
    console.error("CREATE EVENT ERROR:", e);
    s.status(400).json({ message: "Check required event fields." });
  }
});

app.put("/api/events/:id", login, organizer, async (q, s) => {
  try {
    const e = await Event.findByIdAndUpdate(q.params.id, q.body, {
      new: true,
      runValidators: true
    });
    e ? s.json({ message: "Event updated.", event: e }) : s.status(404).json({ message: "Event not found." });
  } catch (error) {
    s.status(400).json({ message: "Unable to update event. Check the event details." });
  }
});

app.delete("/api/events/:id", login, organizer, async (q, s) => {
  try {
    const e = await Event.findByIdAndDelete(q.params.id);
    if (!e) return s.status(404).json({ message: "Event not found." });
    await Registration.deleteMany({ event: e._id });
    s.json({ message: "Event and registrations deleted." });
  } catch (error) {
    s.status(400).json({ message: "Unable to delete event." });
  }
});

// Student event registration: confirmation email goes to the logged-in student's email.
app.post("/api/registrations", login, async (q, s) => {
  try {
    if (q.session.user.role !== "student") {
      return s.status(403).json({ message: "Student accounts only." });
    }

    const e = await Event.findById(q.body.eventId);
    if (!e || ["completed", "cancelled"].includes(e.status)) {
      return s.status(404).json({ message: "Event is unavailable." });
    }

    if (e.capacity && await Registration.countDocuments({
      event: e._id,
      status: { $ne: "rejected" }
    }) >= e.capacity) {
      return s.status(400).json({ message: "Event is full." });
    }

    const r = await Registration.create({
      event: e._id,
      student: q.session.user.id
    });

    await Notification.create({
      user: q.session.user.id,
      title: "Registration submitted",
      message: `Your registration for ${e.title} is pending.`
    });

    const emailSent = await mail(
      q.session.user.email,
      "Event registration received",
      `<p>Your registration for <b>${esc(e.title)}</b> has been received.</p>`
    );

    s.status(201).json({
      message: emailSent ? "Registration submitted. Confirmation email sent." : "Registration submitted, but email could not be sent. Check the server terminal.",
      registration: r,
      emailSent
    });
  } catch (e) {
    console.error("EVENT REGISTRATION ERROR:", e);
    s.status(e.code === 11000 ? 409 : 500).json({
      message: e.code === 11000 ? "Already registered." : "Unable to register."
    });
  }
});

app.get("/api/my-registrations", login, async (q, s) => {
  s.json({
    registrations: await Registration.find({ student: q.session.user.id })
      .populate("event")
      .sort({ createdAt: -1 })
  });
});

app.get("/api/organizer/registrations", login, organizer, async (q, s) => {
  s.json({
    registrations: await Registration.find()
      .populate("event")
      .populate("student", "name email studentId")
      .sort({ createdAt: -1 })
  });
});

// When organizer changes a student's registration status, send an email too.
app.patch("/api/organizer/registrations/:id", login, organizer, async (q, s) => {
  try {
    if (!["pending", "approved", "rejected", "attended"].includes(q.body.status)) {
      return s.status(400).json({ message: "Invalid status." });
    }

    const r = await Registration.findByIdAndUpdate(
      q.params.id,
      { status: q.body.status },
      { new: true }
    ).populate("student", "name email").populate("event", "title");

    if (!r) return s.status(404).json({ message: "Registration not found." });

    const message = `Your registration status is now ${r.status}.`;
    await Notification.create({
      user: r.student._id,
      title: "Registration updated",
      message
    });

    const emailSent = await mail(
      r.student.email,
      "RSU event registration status updated",
      `<p>Hello ${esc(r.student.name)},</p><p>Your registration for <b>${esc(r.event?.title || "the event")}</b> is now <b>${esc(r.status)}</b>.</p>`
    );
    const pushSent = await sendPushToUser(r.student._id, "Registration updated", message, "/my-registrations.html");

    s.json({
      message: emailSent ? "Status updated and student email sent." : "Status updated, but email could not be sent.",
      emailSent,
      pushSent
    });
  } catch (e) {
    console.error("UPDATE REGISTRATION STATUS ERROR:", e);
    s.status(500).json({ message: "Unable to update registration status." });
  }
});

app.delete("/api/organizer/registrations/:id", login, organizer, async (q, s) => {
  try {
    const r = await Registration.findByIdAndDelete(q.params.id);
    r ? s.json({ message: "Registration deleted." }) : s.status(404).json({ message: "Not found." });
  } catch (e) {
    s.status(400).json({ message: "Unable to delete registration." });
  }
});

app.get("/api/announcements", async (q, s) => {
  s.json({
    announcements: await Announcement.find()
      .populate("event", "title date")
      .sort({ createdAt: -1 })
  });
});

// Organizer can choose sendEmail=true to email all active students.
app.post("/api/announcements", login, organizer, async (q, s) => {
  try {
    const a = await Announcement.create({
      title: q.body.title,
      message: q.body.message,
      event: q.body.eventId || null
    });

    let sent = 0;
    let failed = 0;

    if (q.body.sendEmail === true || q.body.sendEmail === "true" || q.body.sendEmail === "on") {
      const users = await User.find({ role: "student", active: true }).select("email name");

      for (const u of users) {
        const ok = await mail(
          u.email,
          `RSU Announcement: ${a.title}`,
          `<h2>${esc(a.title)}</h2><p>${esc(a.message)}</p><a href="${process.env.BASE_URL || ""}/events.html">View events</a>`
        );
        if (ok) sent++;
        else failed++;
      }
    }

    const pushSent = await sendPushToStudents(`RSU Announcement: ${a.title}`, a.message, "/announcements.html");

    s.status(201).json({
      message: `Announcement published. ${sent} email(s) sent${failed ? `; ${failed} failed` : ""}. ${pushSent} mobile push notification(s) sent.`,
      announcement: a,
      emailsSent: sent,
      emailsFailed: failed,
      pushSent
    });
  } catch (e) {
    console.error("CREATE ANNOUNCEMENT ERROR:", e);
    s.status(400).json({ message: "Unable to publish announcement." });
  }
});

app.put("/api/announcements/:id", login, organizer, async (q, s) => {
  try {
    const a = await Announcement.findByIdAndUpdate(
      q.params.id,
      {
        title: q.body.title,
        message: q.body.message,
        event: q.body.eventId || null
      },
      { new: true, runValidators: true }
    );
    a ? s.json({ message: "Announcement updated." }) : s.status(404).json({ message: "Not found." });
  } catch (e) {
    s.status(400).json({ message: "Unable to update announcement." });
  }
});

app.delete("/api/announcements/:id", login, organizer, async (q, s) => {
  try {
    const a = await Announcement.findByIdAndDelete(q.params.id);
    a ? s.json({ message: "Announcement deleted." }) : s.status(404).json({ message: "Not found." });
  } catch (e) {
    s.status(400).json({ message: "Unable to delete announcement." });
  }
});

app.get("/api/notifications", login, async (q, s) => {
  s.json({
    notifications: await Notification.find({ user: q.session.user.id }).sort({ createdAt: -1 })
  });
});

app.patch("/api/notifications/:id/read", login, async (q, s) => {
  const n = await Notification.findOneAndUpdate(
    { _id: q.params.id, user: q.session.user.id },
    { isRead: true }
  );
  n ? s.json({ message: "Read" }) : s.status(404).json({ message: "Not found." });
});

app.get("/api/organizer/students", login, organizer, async (q, s) => {
  s.json({
    students: await User.find({ role: "student" }).select("-password").sort({ createdAt: -1 })
  });
});

app.patch("/api/organizer/students/:id", login, organizer, async (q, s) => {
  try {
    const u = await User.findOneAndUpdate(
      { _id: q.params.id, role: "student" },
      { active: !!q.body.active },
      { new: true }
    ).select("-password");

    u ? s.json({ message: "Student account updated." }) : s.status(404).json({ message: "Not found." });
  } catch (e) {
    s.status(400).json({ message: "Unable to update student." });
  }
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing. Create .env from .env.example.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected.");

  // Verify Gmail settings on startup without stopping the website if email is unavailable.
  const transporter = getMailTransporter();
  if (!transporter) {
    console.warn("Email is NOT configured. Add EMAIL_USER and EMAIL_PASS to .env.");
  } else {
    try {
      await transporter.verify();
      console.log("Gmail SMTP connection verified.");
    } catch (error) {
      console.error("GMAIL CONFIGURATION ERROR:", error.code || "", error.message);
    }
  }

  if (process.env.ORGANIZER_EMAIL && process.env.ORGANIZER_PASSWORD) {
    const email = process.env.ORGANIZER_EMAIL.toLowerCase().trim();
    let u = await User.findOne({ email });

    if (!u) {
      await User.create({
        name: process.env.ORGANIZER_NAME || "RSU Organizer",
        email,
        password: await bcrypt.hash(process.env.ORGANIZER_PASSWORD, 12),
        role: "organizer"
      });
      console.log("Organizer account created.");
    } else if (u.role !== "organizer") {
      u.role = "organizer";
      await u.save();
      console.log("Existing account role changed to organizer.");
    }
  }

  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
    console.log(`Website link: http://localhost:${PORT}`);
  });
}

start().catch(e => {
  console.error("SERVER START ERROR:", e);
  process.exit(1);
});
